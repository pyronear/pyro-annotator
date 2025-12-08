"""
Auto-annotate exported sequences by running the YOLO11s (pyronear) classifier and replacing label files with predictions.

- Works on YOLO-style labels in each sequence directory.
- Groups existing boxes to focus predictions on known objects.
- Overwrites each label file with the new class=1 boxes that intersect grouped objects (empty if none).
- Uses the pyronear YOLO11s model (onnx by default) downloaded from Hugging Face.
"""

import argparse
import logging
import os
import platform
import tarfile
from pathlib import Path
from typing import Dict, List, Tuple
from urllib.request import urlretrieve

import cv2
import numpy as np
from PIL import Image
from tqdm import tqdm


MODEL_URL_FOLDER = "https://huggingface.co/pyronear/yolo11s_mighty-mongoose_v5.1.0/resolve/main/"
MODEL_NAME = "ncnn_cpu_yolo11s_mighty-mongoose_v5.1.0.tar.gz"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auto-annotate sequences with the pyronear YOLO11s classifier.")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path("outputs/seq_annotation_done"),
        help="Root containing seq_*/images and seq_*/labels",
    )
    parser.add_argument(
        "--conf-th",
        type=float,
        default=0.05,
        help="Confidence threshold for model predictions",
    )
    parser.add_argument(
        "--iou-nms",
        type=float,
        default=0.0,
        help="IoU threshold for NMS to build main groups",
    )
    parser.add_argument(
        "--iou-assign",
        type=float,
        default=0.0,
        help="IoU threshold to assign boxes to a group",
    )
    parser.add_argument(
        "--model-format",
        choices=["onnx", "ncnn"],
        default="onnx",
        help="Model format to use (onnx recommended; ncnn for ARM if available)",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )
    return parser.parse_args()


def xywh2xyxy(x: np.ndarray) -> np.ndarray:
    y = np.copy(x)
    y[..., 0] = x[..., 0] - x[..., 2] / 2
    y[..., 1] = x[..., 1] - x[..., 3] / 2
    y[..., 2] = x[..., 0] + x[..., 2] / 2
    y[..., 3] = x[..., 1] + x[..., 3] / 2
    return y


def letterbox(im: np.ndarray, new_shape: tuple = (1024, 1024), color: tuple = (114, 114, 114)) -> Tuple[np.ndarray, Tuple[int, int]]:
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
    inter = (np.minimum(a2, b2[:, None, :]) - np.maximum(a1, b1[:, None, :])).clip(0).prod(2)
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


class DownloadProgressBar(tqdm):
    def update_to(self, b=1, bsize=1, tsize=None):
        if tsize is not None:
            self.total = tsize
        self.update(b * bsize - self.n)


def read_file(label_path: Path, default_conf: float = 1.0) -> np.ndarray:
    """
    Read YOLO txt into [x1,y1,x2,y2,conf] array.
    Supports 'cls cx cy w h' and 'cls conf cx cy w h'.
    """
    if not label_path.exists() or label_path.stat().st_size == 0:
        return np.zeros((0, 5), dtype=np.float64)

    boxes = []
    for raw in label_path.read_text().splitlines():
        raw = raw.strip()
        if not raw:
            continue
        parts = raw.split()
        if len(parts) == 5:
            _, cx, cy, w, h = parts
            conf = default_conf
        elif len(parts) == 6:
            _, conf, cx, cy, w, h = parts
        else:
            continue
        bbox_xyxy = xywh2xyxy(np.array([float(cx), float(cy), float(w), float(h)], dtype=np.float64))
        x1, y1, x2, y2 = bbox_xyxy.tolist()
        boxes.append([x1, y1, x2, y2, float(conf)])

    return np.array(boxes, dtype=np.float64) if boxes else np.zeros((0, 5), dtype=np.float64)


def group_and_merge_boxes(boxes: np.ndarray, iou_nms: float, threshold: float) -> Tuple[np.ndarray, Dict[int, np.ndarray]]:
    """
    Cluster boxes into persistent object groups.
    """
    if boxes.size == 0:
        return np.empty((0, 5), dtype=boxes.dtype), {}

    main_bboxes = nms(boxes.copy(), overlapThresh=iou_nms)
    if len(main_bboxes) == 0:
        return np.empty((0, 5), dtype=boxes.dtype), {}

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


def write_bboxes_to_label_file(label_file: Path, bbox_list: List[np.ndarray], class_id: int = 1) -> None:
    """
    Overwrite label file with normalized YOLO lines (cls cx cy w h conf).
    bbox_list entries are arrays (N,5) in xyxy+conf. If empty, file is truncated.
    """
    lines: List[str] = []
    for arr in bbox_list:
        if arr.size == 0:
            continue
        for b in arr:
            x1, y1, x2, y2, score = b
            x_c = (x1 + x2) / 2.0
            y_c = (y1 + y2) / 2.0
            w = x2 - x1
            h = y2 - y1
            lines.append(f"{class_id} {x_c:.6f} {y_c:.6f} {w:.6f} {h:.6f} {score:.6f}")

    label_file.parent.mkdir(parents=True, exist_ok=True)
    with label_file.open("w") as f:
        for line in lines:
            f.write(line + "\n")


class Classifier:
    """
    Minimal wrapper for the pyronear YOLO11s model (onnx by default).
    Downloads the model archive from Hugging Face if missing.
    """

    def __init__(
        self,
        model_folder: str = "data",
        imgsz: int = 1024,
        conf: float = 0.15,
        iou: float = 0.0,
        format: str = "onnx",
        model_path: str | None = None,
        max_bbox_size: float = 0.4,
    ) -> None:
        self.imgsz = imgsz
        self.conf = conf
        self.iou = iou
        self.max_bbox_size = max_bbox_size

        if model_path:
            self.format = "onnx"
            onnx_file = model_path
        else:
            if format not in {"onnx", "ncnn"}:
                raise ValueError("Unsupported format: should be 'ncnn' or 'onnx'")
            self.format = format
            model = MODEL_NAME if format == "ncnn" else MODEL_NAME.replace("ncnn", "onnx")
            onnx_file = None

            model_path = os.path.join(model_folder, model)
            model_url = MODEL_URL_FOLDER + model

            if not os.path.isfile(model_path):
                logging.info("Downloading model from %s ...", model_url)
                os.makedirs(model_folder, exist_ok=True)
                with DownloadProgressBar(unit="B", unit_scale=True, miniters=1, desc=model_path) as t:
                    urlretrieve(model_url, model_path, reporthook=t.update_to)
                logging.info("Model downloaded!")

            if model_path.endswith(".tar.gz"):
                base_name = os.path.basename(model_path).replace(".tar.gz", "")
                extract_path = os.path.join(model_folder, base_name)
                if not os.path.isdir(extract_path):
                    with tarfile.open(model_path, "r:gz") as tar:
                        tar.extractall(model_folder)
                    logging.info("Extracted model to: %s", extract_path)
                model_path = extract_path
            if format == "onnx":
                onnx_file = model_path if model_path.endswith(".onnx") else os.path.join(model_path, "best.onnx")

        if self.format == "ncnn":
            try:
                import ncnn  # type: ignore
            except ImportError as exc:  # noqa: BLE001
                raise RuntimeError("ncnn package is required for format='ncnn'") from exc
            self.model = ncnn.Net()
            self.model.load_param(os.path.join(model_path, "best_ncnn_model", "model.ncnn.param"))
            self.model.load_model(os.path.join(model_path, "best_ncnn_model", "model.ncnn.bin"))
        else:
            try:
                import onnxruntime  # type: ignore
            except ImportError as exc:  # noqa: BLE001
                raise RuntimeError("onnxruntime is required for format='onnx'") from exc
            try:
                self.ort_session = onnxruntime.InferenceSession(onnx_file)
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(f"Failed to load the ONNX model from {onnx_file}: {e!s}") from e
            logging.info("ONNX model loaded successfully from %s", onnx_file)

    def prep_process(self, pil_img: Image.Image) -> Tuple[np.ndarray, Tuple[int, int]]:
        np_img, pad = letterbox(np.array(pil_img), self.imgsz)

        if self.format == "ncnn":
            import ncnn  # type: ignore

            np_img = ncnn.Mat.from_pixels(np_img, ncnn.Mat.PixelType.PIXEL_BGR, np_img.shape[1], np_img.shape[0])
            mean = [0, 0, 0]
            std = [1 / 255, 1 / 255, 1 / 255]
            np_img.substract_mean_normalize(mean=mean, norm=std)
        else:
            np_img = np.expand_dims(np_img.astype("float32"), axis=0)
            np_img = np.ascontiguousarray(np_img.transpose((0, 3, 1, 2)))
            np_img /= 255.0

        return np_img, pad

    def post_process(self, pred: np.ndarray, pad: Tuple[int, int]) -> np.ndarray:
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

    def __call__(self, pil_img: Image.Image) -> np.ndarray:
        np_img, pad = self.prep_process(pil_img)

        if self.format == "ncnn":
            import ncnn  # type: ignore

            extractor = self.model.create_extractor()
            extractor.set_light_mode(True)
            extractor.input("in0", np_img)
            out = ncnn.Mat()
            extractor.extract("out0", out)
            pred = np.asarray(out)
        else:
            pred = self.ort_session.run(["output0"], {"images": np_img})[0][0]

        return self.post_process(pred, pad)

def process_sequence(seq_dir: Path, model: Classifier, conf_th: float, iou_nms: float, iou_assign: float) -> int:
    img_dir = seq_dir / "images"
    lbl_dir = seq_dir / "labels"
    if not img_dir.exists():
        return 0

    imgs = sorted(img_dir.glob("*.jpg"))
    if not imgs:
        return 0

    # aggregate boxes across sequence
    all_boxes = np.zeros((0, 5), dtype=np.float64)
    for img_path in imgs:
        label_path = lbl_dir / (img_path.stem + ".txt")
        box = read_file(label_path)
        if box.shape[0] > 0:
            all_boxes = np.concatenate([all_boxes, box])

    if all_boxes.shape[0] == 0:
        return 0

    _, grouped = group_and_merge_boxes(all_boxes, iou_nms=iou_nms, threshold=iou_assign)
    changed = 0

    for img_path in imgs:
        label_path = lbl_dir / (img_path.stem + ".txt")
        im = Image.open(img_path)
        preds = model(im)
        preds = preds[preds[:, 4] >= conf_th]

        keep_any = np.zeros(preds.shape[0], dtype=bool)
        for group_boxes in grouped.values():
            ious = box_iou(preds[:, :4], group_boxes[:, :4])
            keep_any |= (ious.max(0) > 0)

        new_bbox = preds[keep_any, :] if preds.shape[0] else np.zeros((0, 5))
        write_bboxes_to_label_file(label_path, [new_bbox], class_id=1)
        if new_bbox.shape[0]:
            changed += 1

    return changed


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=args.loglevel.upper(), format="%(levelname)s - %(message)s")

    seq_dirs = sorted([p for p in args.data_root.glob("seq_*") if (p / "images").exists()], key=lambda p: p.name)
    logging.info("Found %s sequences under %s", len(seq_dirs), args.data_root)

    model = Classifier(conf=args.conf_th, format=args.model_format)
    total_changed = 0

    for seq_dir in tqdm(seq_dirs, desc="Auto-annotating"):
        total_changed += process_sequence(seq_dir, model, args.conf_th, args.iou_nms, args.iou_assign)

    logging.info("Done. Frames updated: %s", total_changed)


if __name__ == "__main__":
    main()
