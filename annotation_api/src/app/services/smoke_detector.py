"""In-app YOLO11s smoke detector (ONNX).

Extracted from the file-based ``auto_annotate.py`` Classifier — pure inference,
no file/label IO and no model download (the model is baked into the image and
loaded from an explicit path).
"""

from pathlib import Path
from typing import Tuple

import cv2
import numpy as np
import onnxruntime
from PIL import Image


def xywh2xyxy(x: np.ndarray) -> np.ndarray:
    y = np.copy(x)
    y[..., 0] = x[..., 0] - x[..., 2] / 2
    y[..., 1] = x[..., 1] - x[..., 3] / 2
    y[..., 2] = x[..., 0] + x[..., 2] / 2
    y[..., 3] = x[..., 1] + x[..., 3] / 2
    return y


def letterbox(
    im: np.ndarray, new_shape: tuple = (1024, 1024), color: tuple = (114, 114, 114)
) -> Tuple[np.ndarray, Tuple[int, int]]:
    im = np.array(im)
    shape = im.shape[:2]
    if isinstance(new_shape, int):
        new_shape = (new_shape, new_shape)
    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    new_unpad = int(round(shape[1] * r)), int(round(shape[0] * r))
    dw, dh = new_shape[1] - new_unpad[0], new_shape[0] - new_unpad[1]
    dw /= 2
    dh /= 2
    if shape[::-1] != new_unpad:
        im = cv2.resize(im, new_unpad, interpolation=cv2.INTER_LINEAR)
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    h, w = im.shape[:2]
    im_b = np.zeros((h + top + bottom, w + left + right, 3)) + color
    im_b[top : top + h, left : left + w, :] = im
    return im_b.astype("uint8"), (left, top)


def box_iou(box1: np.ndarray, box2: np.ndarray, eps: float = 1e-7) -> np.ndarray:
    (a1, a2), (b1, b2) = np.split(box1, 2, 1), np.split(box2, 2, 1)
    inter = (
        (np.minimum(a2, b2[:, None, :]) - np.maximum(a1, b1[:, None, :]))
        .clip(0)
        .prod(2)
    )
    return inter / ((a2 - a1).prod(1) + (b2 - b1).prod(1)[:, None] - inter + eps)


def nms(boxes: np.ndarray, overlapThresh: float = 0.0):
    boxes = boxes[boxes[:, -1].argsort()]
    if len(boxes) == 0:
        return []
    indices = np.arange(len(boxes))
    rr = box_iou(boxes[:, :4], boxes[:, :4])
    for i, _ in enumerate(boxes):
        temp_indices = indices[indices != i]
        if np.any(rr[i, temp_indices] > overlapThresh):
            indices = indices[indices != i]
    return boxes[indices]


class SmokeDetector:
    """ONNX-only smoke detector. Loads the model once; ``predict`` returns
    normalized ``(N, 5)`` boxes ``[x1n, y1n, x2n, y2n, conf]``."""

    def __init__(
        self,
        model_path: str,
        conf: float = 0.01,
        iou: float = 0.0,
        imgsz: int = 1024,
        max_bbox_size: float = 0.4,
    ) -> None:
        self.imgsz = imgsz
        self.conf = conf
        self.iou = iou
        self.max_bbox_size = max_bbox_size
        onnx_file = model_path
        if not model_path.endswith(".onnx"):
            candidates = sorted(Path(model_path).rglob("*.onnx"))
            if not candidates:
                raise RuntimeError(f"No .onnx file found under {model_path}")
            onnx_file = str(candidates[0])
        self.ort_session = onnxruntime.InferenceSession(onnx_file)

    def _prep(self, pil_img: Image.Image) -> Tuple[np.ndarray, Tuple[int, int]]:
        np_img, pad = letterbox(np.array(pil_img), self.imgsz)
        np_img = np.expand_dims(np_img.astype("float32"), axis=0)
        np_img = np.ascontiguousarray(np_img.transpose((0, 3, 1, 2)))
        np_img /= 255.0
        return np_img, pad

    def _post(self, pred: np.ndarray, pad: Tuple[int, int]) -> np.ndarray:
        pred = pred[:, pred[-1, :] > self.conf]
        pred = np.transpose(pred)
        pred = xywh2xyxy(pred)
        pred = pred[pred[:, 4].argsort()]
        pred = nms(pred)
        pred = pred[::-1]

        if len(pred) > 0:
            left_pad, top_pad = pad
            pred[:, :4:2] -= left_pad
            pred[:, 1:4:2] -= top_pad
            pred[:, :4:2] /= self.imgsz - 2 * left_pad
            pred[:, 1:4:2] /= self.imgsz - 2 * top_pad
            pred = np.clip(pred, 0, 1)
        else:
            pred = np.zeros((0, 5))

        pred = pred[(pred[:, 2] - pred[:, 0]) < self.max_bbox_size, :]
        pred = np.reshape(pred, (-1, 5))
        return pred

    def predict(self, pil_img: Image.Image) -> np.ndarray:
        np_img, pad = self._prep(pil_img)
        pred = self.ort_session.run(["output0"], {"images": np_img})[0][0]
        return self._post(pred, pad)
