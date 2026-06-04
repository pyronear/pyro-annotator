"""
Run the Pyronear engine predictor over fetched sequence folders and emit the
per-frame smoothed bounding boxes as JSONL.

This script is the box-extracting counterpart to pyro-dataset's
`predict_and_filter_sequences.py`: instead of only recording a kept/dropped
verdict per sequence, it records, for every frame, the predictor's
temporally-smoothed `output_predictions` so the orchestrator can rebuild
objects from them and POST predictor-derived detections.

It MUST run inside the pyro-engine virtualenv (which carries the heavy
`pyro_predictor` / `ncnn` / `onnxruntime` deps) and therefore imports nothing
from the annotation_api package — the orchestrator invokes it as a subprocess:

    PYTHONPATH=$PYRO_ENGINE_DIR/pyro-predictor \
    $PYRO_ENGINE_DIR/.venv/bin/python /abs/path/to/predictor_runner.py \
      --save-dir <temp> --out <temp>/predictor_boxes.jsonl \
      --n-consecutive 6 --conf-threshold 0.1 \
      --model-folder $PYRO_ENGINE_DIR/pyro-predictor/data

Output (`--out`): one JSON object per sequence, e.g.
    {"sequence_id": "16851", "n_images": 30, "max_conf": 0.42, "status": "kept",
     "frames": [{"frame_idx": 0,
                 "image_filename": "pyronear_org_cam-123_2025-03-04T10-02-55.jpg",
                 "boxes": [[0.41, 0.30, 0.55, 0.44, 0.42]]},
                {"frame_idx": 1, "image_filename": "...", "boxes": []}]}

The smoothed boxes are read from the predictor's per-camera state after each
`predict()` call: `predictor._states[cam_id]["last_predictions"][-1][2]`, which
is the `output_predictions` list ([x1, y1, x2, y2, conf], normalised, <=5 boxes).
This is a private attribute; the index is stable on both the local checkout and
origin/main of pyro-engine (predictor.py:139 / :153).
"""

import argparse
import json
import logging
import re
from pathlib import Path
from typing import List

from PIL import Image
from pyro_predictor import Predictor  # type: ignore[import-not-found]  # runs in pyro-engine venv
from tqdm import tqdm

SEQUENCE_DIR_RE = re.compile(r"_sequence-(\d+)$")


def make_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--save-dir",
        type=Path,
        required=True,
        help="Root dir containing the sequence folders (the fetch --save-dir).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Output JSONL path (one object per sequence).",
    )
    parser.add_argument(
        "--n-consecutive",
        type=int,
        default=6,
        help="Sliding-window size passed as nb_consecutive_frames to Predictor.",
    )
    parser.add_argument(
        "--conf-threshold",
        type=float,
        default=0.1,
        help="Confidence threshold; sequences with max conf strictly below are 'dropped'.",
    )
    parser.add_argument(
        "--model-folder",
        type=Path,
        required=True,
        help="Path passed as Classifier(model_folder=...).",
    )
    parser.add_argument(
        "--dropped-subdir",
        type=str,
        default="dropped",
        help="Subdir under --save-dir to exclude from scanning.",
    )
    parser.add_argument("-log", "--loglevel", default="info", help="Logging level.")
    return parser


def find_sequence_dirs(root: Path, exclude: Path) -> List[Path]:
    """Every dir under `root` named `*_sequence-<id>`, excluding `exclude`."""
    results: List[Path] = []
    exclude_abs = exclude.resolve()
    for path in root.rglob("*"):
        if not path.is_dir() or not SEQUENCE_DIR_RE.search(path.name):
            continue
        try:
            resolved = path.resolve()
            if exclude_abs in resolved.parents or resolved == exclude_abs:
                continue
        except OSError:
            continue
        results.append(path)
    return sorted(results)


def list_images(sequence_dir: Path) -> List[Path]:
    images_dir = sequence_dir / "images"
    if not images_dir.is_dir():
        return []
    return sorted(
        p for p in images_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )


def _smoothed_boxes(predictor: Predictor, cam_id: str) -> List[List[float]]:
    """Read the just-appended frame's smoothed `output_predictions`.

    Returns [] defensively if the predictor state is missing/empty or shaped
    unexpectedly, so a single odd frame never aborts the whole run.
    """
    try:
        last_predictions = predictor._states[cam_id]["last_predictions"]
        if not last_predictions:
            return []
        output_predictions = last_predictions[-1][2]
        return [list(box) for box in output_predictions]
    except (KeyError, IndexError, TypeError) as exc:
        logging.debug(f"Could not read smoothed boxes for cam_id={cam_id}: {exc}")
        return []


def predict_sequence(
    predictor: Predictor, sequence_dir: Path, sequence_id: str
) -> tuple[List[dict], float, int]:
    """Run the predictor over a sequence; return (frame_records, max_conf, n_failed).

    A fresh `cam_id` per sequence allocates fresh sliding-window state in the
    predictor's internal `_states` dict (same convention as
    predict_and_filter_sequences.py). `n_failed` counts frames whose inference
    raised, so the caller can distinguish "no smoke" from "inference broke".
    """
    frames: List[dict] = []
    max_conf = 0.0
    n_failed = 0
    for frame_idx, image_path in enumerate(list_images(sequence_dir)):
        boxes: List[List[float]] = []
        try:
            with Image.open(image_path) as im:
                im.load()
                conf = predictor.predict(im, cam_id=sequence_id)
            boxes = _smoothed_boxes(predictor, sequence_id)
        except Exception as exc:
            logging.warning(f"Inference failed on {image_path}: {exc}")
            conf = 0.0
            n_failed += 1
        if conf > max_conf:
            max_conf = conf
        frames.append(
            {
                "frame_idx": frame_idx,
                "image_filename": image_path.name,
                "boxes": boxes,
            }
        )
    return frames, max_conf, n_failed


def main() -> int:
    args = make_cli_parser().parse_args()
    logging.basicConfig(level=args.loglevel.upper())

    save_dir: Path = args.save_dir
    if not save_dir.is_dir():
        logging.error(f"--save-dir {save_dir} does not exist or is not a directory")
        return 1

    dropped_root = save_dir / args.dropped_subdir
    sequence_dirs = find_sequence_dirs(save_dir, exclude=dropped_root)
    logging.info(
        f"Found {len(sequence_dirs)} sequence(s) under {save_dir}; "
        f"predictor: nb_consecutive_frames={args.n_consecutive}, "
        f"conf_thresh={args.conf_threshold}"
    )

    predictor = Predictor(
        conf_thresh=args.conf_threshold,
        nb_consecutive_frames=args.n_consecutive,
        verbose=False,
        model_folder=str(args.model_folder),
    )

    kept = 0
    dropped = 0
    total_frames = 0
    total_failed = 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as out_file:
        for sequence_dir in tqdm(sequence_dirs, desc="Predicting", unit="seq"):
            match = SEQUENCE_DIR_RE.search(sequence_dir.name)
            sequence_id = match.group(1) if match else sequence_dir.name
            frames, max_conf, n_failed = predict_sequence(
                predictor, sequence_dir, sequence_id
            )
            n_images = len(frames)
            total_frames += n_images
            total_failed += n_failed
            if n_images == 0:
                status = "dropped_no_images"
            elif n_failed == n_images:
                status = "error"  # every frame's inference raised
            elif max_conf < args.conf_threshold:
                status = "dropped"
            else:
                status = "kept"
            kept += status == "kept"
            dropped += status != "kept"
            out_file.write(
                json.dumps(
                    {
                        "sequence_id": sequence_id,
                        "n_images": n_images,
                        "max_conf": round(max_conf, 4),
                        "status": status,
                        "frames": frames,
                    }
                )
                + "\n"
            )

    logging.info(f"Done — kept={kept}, dropped={dropped}, out={args.out}")
    # Systemic failure (e.g. model failed to load / wrong runtime): every frame
    # raised. Exit non-zero so the orchestrator aborts instead of treating the
    # run as "nothing detected".
    if total_frames > 0 and total_failed == total_frames:
        logging.error(
            f"All {total_frames} frame(s) failed inference — aborting (exit 1)"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
