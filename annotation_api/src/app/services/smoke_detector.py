"""In-app YOLO11s smoke detector (ONNX).

Pure inference (originally extracted from the retired file-based
auto-annotate script) — no file/label IO and no model download (the model is
baked into the image and loaded from an explicit path).
"""

from pathlib import Path
from typing import Dict, List, Tuple

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


def group_and_merge_boxes(
    boxes: np.ndarray, iou_nms: float, threshold: float
) -> Tuple[np.ndarray, Dict[int, np.ndarray]]:
    """Cluster boxes into persistent object groups.

    Preserved verbatim from the retired file-based auto-annotate script so
    historical results stay reproducible. ``boxes`` is ``(N, >=5)`` with
    confidence in the last column. Returns the representative boxes plus, per
    group, the member boxes.
    """
    if boxes.size == 0:
        return np.empty((0, boxes.shape[1]), dtype=boxes.dtype), {}

    main_bboxes = nms(boxes.copy(), overlapThresh=iou_nms)
    if len(main_bboxes) == 0:
        return np.empty((0, boxes.shape[1]), dtype=boxes.dtype), {}

    ious = box_iou(boxes[:, :4], main_bboxes[:, :4])
    X, Y = np.where(ious > threshold)
    gp: Dict[int, List[int]] = {}
    for main_index, bbox_index in zip(X, Y):
        gp.setdefault(int(main_index), []).append(int(bbox_index))

    items = [(k, set(v)) for k, v in gp.items()]
    used = [False] * len(items)
    merged = []

    for i, (main_i, set_i) in enumerate(items):
        if used[i]:
            continue
        current_set = set(set_i)
        used[i] = True
        changed = True
        while changed:
            changed = False
            for j, (main_j, set_j) in enumerate(items):
                if used[j]:
                    continue
                if current_set & set_j:
                    current_set |= set_j
                    used[j] = True
                    changed = True
        merged.append((main_i, sorted(current_set)))

    final_main = np.stack([main_bboxes[m] for m, _ in merged], axis=0)
    groups = {i: boxes[idxs, :] for i, (_, idxs) in enumerate(merged)}
    return final_main, groups


def keep_boxes_overlapping(preds: np.ndarray, anchor_boxes: np.ndarray) -> np.ndarray:
    """Keep only ``preds`` (N, >=5) whose box overlaps (IoU > 0) at least one
    ``anchor_boxes`` (M, >=4) box. Returns the surviving rows unchanged.

    This is the FP filter / gap-fill gate: a prediction survives iff it lines up
    with an engine-confirmed persistent object somewhere in the sequence.
    """
    if preds.shape[0] == 0 or anchor_boxes.shape[0] == 0:
        return preds[:0]
    best_iou = box_iou(preds[:, :4], anchor_boxes[:, :4]).max(0)
    return preds[best_iou > 0]


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
