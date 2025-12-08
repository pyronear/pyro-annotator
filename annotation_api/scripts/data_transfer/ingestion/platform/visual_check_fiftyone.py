"""
Load exported sequences (images + YOLO labels) into FiftyOne for visual review.

Defaults to reading from outputs/seq_annotation_done/seq_*/{images,labels}.
Only deletes an existing dataset with the same name (safe by default).
"""

import argparse
from pathlib import Path
from typing import List, Tuple

import fiftyone as fo
from PIL import Image


SMOKE_CLASSES = ["wildfire", "industrial", "other"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open exported sequences in FiftyOne for visual check.")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path("outputs/seq_annotation_done"),
        help="Root directory containing seq_*/images and seq_*/labels",
    )
    parser.add_argument(
        "--dataset-name",
        default="visual_check",
        help="FiftyOne dataset name (existing dataset with the same name will be replaced)",
    )
    parser.add_argument(
        "--conf-th",
        type=float,
        default=0.0,
        help="Minimum confidence to display a box (if confidence present in label line)",
    )
    return parser.parse_args()


def ensure_black_image(path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        img = Image.new("RGB", (1280, 720), color=(0, 0, 0))
        img.save(path)
    return path


def yolo_line_to_bbox(parts: List[str]) -> Tuple[int, float, float, float, float, float]:
    """
    Parse YOLO line: cls cx cy w h [conf]
    Returns (cls_id, x, y, w, h, conf)
    """
    cls_id = int(parts[0])
    cx, cy, w, h = map(float, parts[1:5])
    conf = float(parts[5]) if len(parts) >= 6 else 1.0
    x = cx - w / 2.0
    y = cy - h / 2.0
    return cls_id, x, y, w, h, conf


def build_sample(img_path: Path, label_path: Path, conf_th: float) -> fo.Sample:
    sample = fo.Sample(filepath=str(img_path))
    detections = []

    if label_path.exists() and label_path.stat().st_size > 0:
        with label_path.open() as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                parts = raw.split()
                if len(parts) < 5:
                    continue
                cls_id, x, y, w, h, conf = yolo_line_to_bbox(parts)
                if conf < conf_th:
                    continue
                label = SMOKE_CLASSES[cls_id] if cls_id < len(SMOKE_CLASSES) else str(cls_id)
                detections.append(
                    fo.Detection(
                        label=label,
                        bounding_box=[x, y, w, h],
                        confidence=conf,
                    )
                )

    if detections:
        sample["detections"] = fo.Detections(detections=detections)
    return sample


def main() -> None:
    args = parse_args()

    # Reset only the named dataset if it exists
    if args.dataset_name in fo.list_datasets():
        fo.delete_dataset(args.dataset_name)

    seq_image_dirs = sorted((p for p in args.data_root.glob("seq_*") if (p / "images").exists()), key=lambda p: p.name)
    samples: List[fo.Sample] = []

    for seq_dir in seq_image_dirs:
        img_dir = seq_dir / "images"
        lbl_dir = seq_dir / "labels"
        alert_id = seq_dir.name.replace("seq_", "")

        for img_path in sorted(img_dir.glob("*.jpg")):
            label_path = lbl_dir / (img_path.stem + ".txt")
            samples.append(build_sample(img_path, label_path, args.conf_th))

        # visual separator between sequences
        black_path = ensure_black_image(seq_dir / f"black_seq_{alert_id}.jpg")
        samples.append(fo.Sample(filepath=str(black_path)))

    dataset = fo.Dataset(args.dataset_name)
    dataset.add_samples(samples)
    dataset.persistent = True

    session = fo.launch_app(dataset)
    session.wait()


if __name__ == "__main__":
    main()
