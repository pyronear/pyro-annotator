"""
Load an exported YOLO dataset (images + labels) into FiftyOne for visual review.

Expects the following structure under --data-root:
    <data-root>/
        <seq-name>/
            images/  *.jpg
            labels/  *.txt  (YOLO format: cls cx cy w h [conf])

Unlike visual_check_fiftyone.py which expects seq_* folders, this script
accepts any subdirectory layout produced by export_dataset.py.

Usage (from annotation_api/):
    uv run python -m scripts.data_transfer.ingestion.platform.visual_check_exported_dataset \\
        --data-root outputs/datasets/dataset_exported_20260320_105252/wildfire \\
        --dataset-name wildfire_export_20260320
"""

import argparse
from pathlib import Path
from typing import List

import fiftyone as fo

from scripts.data_transfer.ingestion.platform.visual_check_fiftyone import build_sample


SMOKE_CLASSES = ["wildfire", "industrial", "other"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open an exported YOLO dataset in FiftyOne for visual review.")
    parser.add_argument(
        "--data-root",
        type=Path,
        required=True,
        help="Root directory containing <seq-name>/images and <seq-name>/labels",
    )
    parser.add_argument(
        "--dataset-name",
        default="exported_dataset",
        help="FiftyOne dataset name (existing dataset with the same name will be replaced)",
    )
    parser.add_argument(
        "--conf-th",
        type=float,
        default=0.0,
        help="Minimum confidence to display a box (if confidence present in label line)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.dataset_name in fo.list_datasets():
        fo.delete_dataset(args.dataset_name)

    seq_dirs = sorted(p for p in args.data_root.iterdir() if p.is_dir() and (p / "images").exists())

    if not seq_dirs:
        raise SystemExit(f"No sequence directories found under {args.data_root}")

    samples: List[fo.Sample] = []
    for seq_dir in seq_dirs:
        img_dir = seq_dir / "images"
        lbl_dir = seq_dir / "labels"

        for img_path in sorted(img_dir.glob("*.jpg")):
            label_path = lbl_dir / (img_path.stem + ".txt")
            samples.append(build_sample(img_path, label_path, args.conf_th))

    dataset = fo.Dataset(args.dataset_name)
    dataset.add_samples(samples)
    dataset.persistent = True

    print(f"Loaded {len(samples)} images from {len(seq_dirs)} sequences into '{args.dataset_name}'")

    session = fo.launch_app(dataset)
    session.wait()


if __name__ == "__main__":
    main()
