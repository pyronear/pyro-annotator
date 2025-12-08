"""
Pull sequences annotated on remote API (processing_stage=seq_annotation_done), download images/labels,
save locally, and transition remote annotations to in_review.
"""

import argparse
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

import requests
from dotenv import load_dotenv

from app.clients import annotation_api

load_dotenv()

SMOKE_CLASSES = ["wildfire", "industrial", "other"]
CLASS_ID = {name: idx for idx, name in enumerate(SMOKE_CLASSES)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download seq_annotation_done sequences from remote API and mark in_review"
    )
    parser.add_argument(
        "--remote-api",
        type=str,
        default="https://annotationapi.pyronear.org",
        help="Remote annotation API base URL",
    )
    parser.add_argument(
        "--username",
        type=str,
        default=os.getenv("MAIN_ANNOTATION_LOGIN", os.getenv("ANNOTATOR_LOGIN", "admin")),
        help="Remote API username",
    )
    parser.add_argument(
        "--password",
        type=str,
        default=os.getenv("MAIN_ANNOTATION_PASSWORD", os.getenv("ANNOTATOR_PASSWORD", "admin12345")),
        help="Remote API password",
    )
    parser.add_argument(
        "--max-sequences",
        type=int,
        default=0,
        help="Optional cap on number of sequences to pull (0 = all)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="outputs/seq_annotation_done",
        help="Directory to store images/labels",
    )
    parser.add_argument(
        "--skip-ssl-verify",
        action="store_true",
        help="Disable TLS verification (not recommended; use only if you trust the host)",
    )
    parser.add_argument(
        "--smoke-type",
        type=str,
        choices=["wildfire", "industrial", "other"],
        default=None,
        help="Only pull sequences whose annotation smoke_types includes this value",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )
    return parser.parse_args()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def to_yolo(bbox: List[float]) -> List[float]:
    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    w = x2 - x1
    h = y2 - y1
    return [cx, cy, w, h]


def write_label(label_path: Path, bbox: List[float], class_name: str) -> None:
    cid = CLASS_ID.get(class_name, 0)
    yolo = to_yolo(bbox)
    label_path.write_text(f"{cid} " + " ".join(f"{v:.6f}" for v in yolo) + "\n")


def fetch_sequences(remote_api: str, token: str, max_sequences: int) -> List[Dict]:
    page = 1
    size = 100
    results: List[Dict] = []
    while True:
        resp = annotation_api.list_sequences(
            remote_api,
            token,
            processing_stage="seq_annotation_done",
            page=page,
            size=size,
            include_annotation=True,
        )
        items = resp.get("items", [])
        results.extend(items)
        if max_sequences and len(results) >= max_sequences:
            return results[:max_sequences]
        if page >= resp.get("pages", 1):
            break
        page += 1
    return results


def get_sequence_annotation(remote_api: str, token: str, seq_id: int) -> Optional[Dict]:
    resp = annotation_api.list_sequence_annotations(
        remote_api, token, sequence_id=seq_id, page=1, size=1
    )
    items = resp.get("items", []) if isinstance(resp, dict) else resp
    return items[0] if items else None


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=args.loglevel.upper(), format="%(levelname)s - %(message)s")

    token = annotation_api.get_auth_token(args.remote_api, args.username, args.password)
    sequences = fetch_sequences(args.remote_api, token, args.max_sequences)
    logging.info(f"Found {len(sequences)} sequence(s) with stage seq_annotation_done")

    base = Path(args.output_dir)
    ensure_dir(base)

    for seq in sequences:
        seq_id = seq["id"]
        ann = get_sequence_annotation(args.remote_api, token, seq_id)
        if not ann:
            logging.warning(f"No annotation for sequence {seq_id}, skipping")
            continue

        if args.smoke_type and args.smoke_type not in ann.get("smoke_types", []):
            logging.info(
                "Skipping sequence %s (smoke_types=%s not matching %s)",
                seq_id,
                ann.get("smoke_types"),
                args.smoke_type,
            )
            continue

        det_resp = annotation_api.list_detections(
            args.remote_api, token, sequence_id=seq_id, page=1, size=100
        )
        detections = det_resp.get("items", [])

        seq_dir = base / f"seq_{seq.get('alert_api_id', seq_id)}"
        img_dir = seq_dir / "images"
        lbl_dir = seq_dir / "labels"
        ensure_dir(img_dir)
        ensure_dir(lbl_dir)

        ann_bboxes = {bbox["detection_id"]: bbox for sb in ann.get("annotation", {}).get("sequences_bbox", []) for bbox in sb.get("bboxes", [])}
        for det in detections:
            det_id = det["id"]
            image_url = annotation_api.get_detection_url(args.remote_api, token, det_id)
            img_name = f"detection_{det_id}.jpg"
            img_path = img_dir / img_name
            label_path = lbl_dir / (img_name.replace(".jpg", ".txt"))

            try:
                resp = requests.get(image_url, timeout=30, verify=not args.skip_ssl_verify)
                resp.raise_for_status()
                img_path.write_bytes(resp.content)
            except Exception as exc:
                logging.error(f"Failed to download image for detection {det_id}: {exc}")
                continue

            bbox = ann_bboxes.get(det.get("alert_api_id") or det_id)
            if bbox:
                write_label(label_path, bbox["xyxyn"], bbox.get("class_name", "wildfire"))
            else:
                label_path.write_text("")

        # update remote stage to in_review
        try:
            remote_ann = ann
            annotation_api.update_sequence_annotation(
                args.remote_api,
                token,
                remote_ann["id"],
                {"processing_stage": "in_review"},
            )
        except Exception as exc:
            logging.warning(f"Failed to set sequence {seq_id} to in_review: {exc}")


if __name__ == "__main__":
    main()
