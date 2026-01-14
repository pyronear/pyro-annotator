"""
Apply FiftyOne visual review tags to remote annotation stages.

Rules:
- If no sample has tag "issue" for a sequence -> set sequence processing_stage to annotated
  and set all detection annotations to annotated.
- If the black separator image has tag "issue" -> set sequence processing_stage to needs_manual
  and set all detection annotations to bbox_annotation (reannotate whole sequence).
- If specific images have tag "issue" -> set sequence processing_stage to needs_manual
  and set only those detections' annotations to bbox_annotation.

Assumes exported data layout: outputs/seq_annotation_done/seq_<alert_api_id>/images/detection_<id>.jpg
"""

import argparse
import logging
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Set

import fiftyone as fo
from dotenv import load_dotenv

from app.clients import annotation_api

load_dotenv()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply FiftyOne review tags to remote annotation/detection stages."
    )
    parser.add_argument(
        "--dataset-name",
        default="visual_check",
        help="Name of the persisted FiftyOne dataset to read",
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
        help="Optional cap on number of sequences to process (0 = all)",
    )
    parser.add_argument(
        "--labels-root",
        type=Path,
        default=Path("outputs/seq_annotation_done"),
        help="Root folder containing seq_<alert_api_id>/labels/detection_<id>.txt files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without calling the API",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )
    return parser.parse_args()


def parse_alert_id(path: str) -> int | None:
    m = re.search(r"seq_(\d+)", path)
    return int(m.group(1)) if m else None


def parse_detection_id(path: str) -> int | None:
    m = re.search(r"detection_(\d+)\.jpg", path)
    return int(m.group(1)) if m else None


def group_reviews(dataset: fo.Dataset) -> Dict[int, Dict[str, Set[int]]]:
    """
    Returns per-alert_id:
    {
      "issue_frames": set(detection_ids with issue),
      "whole_issue": bool via presence of black image tagged issue,
      "all_frames": set(all detection_ids)
    }
    """
    per_seq: Dict[int, Dict[str, Set[int] | bool]] = defaultdict(lambda: {"issue_frames": set(), "whole_issue": False, "all_frames": set()})

    for sample in dataset:
        alert_id = parse_alert_id(sample.filepath)
        if alert_id is None:
            continue

        is_black = "black" in sample.filepath
        has_issue = "issue" in sample.tags

        if is_black:
            if has_issue:
                per_seq[alert_id]["whole_issue"] = True
            continue

        det_id = parse_detection_id(sample.filepath)
        if det_id is None:
            continue

        per_seq[alert_id]["all_frames"].add(det_id)
        if has_issue:
            per_seq[alert_id]["issue_frames"].add(det_id)

    return per_seq


def find_remote_sequence(remote_api: str, token: str, alert_id: int) -> Dict | None:
    """
    Find a remote sequence by alert_api_id by scanning pages to avoid relying on backend filters.
    """
    page = 1
    size = 100
    while True:
        resp = annotation_api.list_sequences(
            remote_api,
            token,
            page=page,
            size=size,
            include_annotation=True,
        )
        items = resp.get("items", [])
        for item in items:
            if item.get("alert_api_id") == alert_id:
                return item
        if page >= resp.get("pages", 1):
            break
        page += 1
    return None


def update_sequence_stage(remote_api: str, token: str, seq_id: int, stage: str, dry_run: bool) -> bool:
    ann_resp = annotation_api.list_sequence_annotations(remote_api, token, sequence_id=seq_id, page=1, size=1)
    items = ann_resp.get("items", []) if isinstance(ann_resp, dict) else ann_resp
    if not items:
        logging.warning("Sequence %s has no annotation row to update", seq_id)
        return False
    ann_id = items[0]["id"]
    if dry_run:
        logging.info("[DRY-RUN] Would set sequence_id=%s annotation_id=%s stage=%s", seq_id, ann_id, stage)
        return True
    annotation_api.update_sequence_annotation(remote_api, token, ann_id, {"processing_stage": stage})
    logging.info("Updated sequence_id=%s annotation_id=%s stage=%s", seq_id, ann_id, stage)
    return True


def update_detection_stage(
    remote_api: str,
    token: str,
    det_id: int,
    stage: str,
    dry_run: bool,
    annotation_data: Optional[List[Dict]] = None,
) -> bool:
    ann_resp = annotation_api.list_detection_annotations(remote_api, token, detection_id=det_id, page=1, size=1)
    items = ann_resp.get("items", []) if isinstance(ann_resp, dict) else ann_resp
    if not items:
        logging.warning("Detection %s has no annotation row to update", det_id)
        return False
    ann_id = items[0]["id"]
    if dry_run:
        logging.info(
            "[DRY-RUN] Would set detection_id=%s annotation_id=%s stage=%s%s",
            det_id,
            ann_id,
            stage,
            " (and update annotation payload)" if annotation_data is not None else "",
        )
        return True
    payload: Dict = {"processing_stage": stage}
    if annotation_data is not None:
        payload["annotation"] = {"annotation": annotation_data}
    annotation_api.update_detection_annotation(remote_api, token, ann_id, payload)
    logging.debug("Updated detection_id=%s annotation_id=%s stage=%s", det_id, ann_id, stage)
    return True


def ensure_detection_annotations(
    remote_api: str,
    token: str,
    sequence_id: int,
    detection_ids: List[int],
    default_stage: str = "bbox_annotation",
    dry_run: bool = False,
    annotation_map: Optional[Dict[int, List[Dict]]] = None,
) -> List[int]:
    """
    Ensure each detection has an annotation row; create placeholder if missing.
    Returns the list of detection_ids that were missing.
    """
    # Fetch existing detection annotations for this sequence (paged)
    page = 1
    size = 100
    annotated_dets: set[int] = set()
    while True:
        ann_resp = annotation_api.list_detection_annotations(
            remote_api, token, sequence_id=sequence_id, page=page, size=size
        )
        items = ann_resp.get("items", []) if isinstance(ann_resp, dict) else ann_resp
        for item in items:
            if "detection_id" in item:
                annotated_dets.add(item["detection_id"])
        if page >= ann_resp.get("pages", 1):
            break
        page += 1

    missing: List[int] = []
    for det_id in detection_ids:
        if det_id in annotated_dets:
            continue
        missing.append(det_id)
        if dry_run:
            logging.info("[DRY-RUN] Would create detection annotation for detection_id=%s", det_id)
            continue
        try:
            ann_payload = {"annotation": annotation_map[det_id]} if annotation_map and det_id in annotation_map else {"annotation": []}
            annotation_api.create_detection_annotation(
                remote_api,
                token,
                det_id,
                ann_payload,
                default_stage,
            )
            logging.info("Created detection annotation placeholder for detection_id=%s", det_id)
        except Exception as exc:  # noqa: BLE001
            logging.error("Failed to create detection annotation for detection_id=%s: %s", det_id, exc)
    return missing


def list_all_detections(remote_api: str, token: str, sequence_id: int) -> List[Dict]:
    """Fetch all detections for a sequence with pagination (size capped at 100)."""
    page = 1
    size = 100
    results: List[Dict] = []
    while True:
        resp = annotation_api.list_detections(
            remote_api, token, sequence_id=sequence_id, page=page, size=size
        )
        items = resp.get("items", [])
        results.extend(items)
        if page >= resp.get("pages", 1):
            break
        page += 1
    return results


def delete_detection_annotations_for_sequence(
    remote_api: str, token: str, sequence_id: int, dry_run: bool
) -> int:
    """
    Delete all detection annotations linked to a sequence (via sequence_id filter).
    Returns the number of annotations deleted (or that would be deleted in dry-run).
    """
    page = 1
    size = 100
    ann_ids: List[int] = []
    while True:
        resp = annotation_api.list_detection_annotations(
            remote_api, token, sequence_id=sequence_id, page=page, size=size
        )
        items = resp.get("items", [])
        ann_ids.extend([it["id"] for it in items if "id" in it])
        if page >= resp.get("pages", 1):
            break
        page += 1

    if not ann_ids:
        return 0

    for ann_id in ann_ids:
        if dry_run:
            logging.info("[DRY-RUN] Would delete detection annotation %s", ann_id)
        else:
            try:
                annotation_api.delete_detection_annotation(remote_api, token, ann_id)
            except Exception as exc:  # noqa: BLE001
                logging.error("Failed to delete detection annotation %s: %s", ann_id, exc)
    return len(ann_ids)


SMOKE_CLASSES = ["wildfire", "industrial", "other"]


def load_yolo_annotation(labels_root: Path, alert_id: int, det_id: int) -> Optional[List[Dict]]:
    """
    Load YOLO label file for a detection and convert to DetectionAnnotationData items.
    """
    lbl_path = labels_root / f"seq_{alert_id}" / "labels" / f"detection_{det_id}.txt"
    if not lbl_path.exists() or lbl_path.stat().st_size == 0:
        return None

    items: List[Dict] = []
    try:
        with lbl_path.open() as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                parts = raw.split()
                if len(parts) < 5:
                    continue
                cls_id = int(parts[0])
                cx, cy, w, h = map(float, parts[1:5])
                x1 = cx - w / 2.0
                y1 = cy - h / 2.0
                x2 = cx + w / 2.0
                y2 = cy + h / 2.0
                # clip to [0,1]
                xyxyn = [max(0.0, min(1.0, v)) for v in (x1, y1, x2, y2)]
                smoke_type = SMOKE_CLASSES[cls_id] if 0 <= cls_id < len(SMOKE_CLASSES) else "other"
                items.append(
                    {
                        "xyxyn": xyxyn,
                        "class_name": smoke_type,
                        "smoke_type": smoke_type,
                    }
                )
    except Exception as exc:  # noqa: BLE001
        logging.error("Failed to read label file %s: %s", lbl_path, exc)
        return None

    return items if items else None


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=args.loglevel.upper(), format="%(levelname)s - %(message)s")

    dataset = fo.load_dataset(args.dataset_name)
    reviews = group_reviews(dataset)

    token = annotation_api.get_auth_token(args.remote_api, args.username, args.password)

    processed = 0
    seq_ok = 0
    seq_whole_issue = 0
    seq_partial_issue = 0
    seq_not_found = 0

    for alert_id, info in reviews.items():
        if args.max_sequences and processed >= args.max_sequences:
            break
        processed += 1

        seq = find_remote_sequence(args.remote_api, token, alert_id)
        if not seq:
            logging.warning("No remote sequence found for alert_api_id=%s", alert_id)
            seq_not_found += 1
            continue
        seq_id = seq["id"]

        # Remove any existing detection annotations so we can recreate from labels cleanly
        deleted_count = delete_detection_annotations_for_sequence(
            args.remote_api, token, seq_id, args.dry_run
        )
        if args.dry_run and deleted_count:
            logging.info("[DRY-RUN] Would delete %s detection annotations for sequence_id=%s", deleted_count, seq_id)

        # Load detections and ensure annotations exist for them
        detections = list_all_detections(args.remote_api, token, seq_id)
        detection_ids = [d["id"] for d in detections]
        annotation_map: Dict[int, List[Dict]] = {}
        for det in detections:
            data = load_yolo_annotation(args.labels_root, alert_id, det["id"])
            if data is not None:
                annotation_map[det["id"]] = data
        missing_dets = ensure_detection_annotations(
            args.remote_api,
            token,
            seq_id,
            detection_ids,
            default_stage="bbox_annotation",
            dry_run=args.dry_run,
            annotation_map=annotation_map,
        )
        if args.dry_run and missing_dets:
            logging.info(
                "[DRY-RUN] Sequence %s would need %d detection annotations created (ids: %s)",
                seq_id,
                len(missing_dets),
                missing_dets,
            )

        issue_frames = info["issue_frames"]
        whole_issue = info["whole_issue"]
        all_frames = info["all_frames"]

        if not issue_frames and not whole_issue:
            if update_sequence_stage(args.remote_api, token, seq_id, "annotated", args.dry_run):
                seq_ok += 1
            for det_id in all_frames:
                update_detection_stage(
                    args.remote_api,
                    token,
                    det_id,
                    "annotated",
                    args.dry_run,
                    annotation_map.get(det_id),
                )
            continue

        if update_sequence_stage(args.remote_api, token, seq_id, "needs_manual", args.dry_run):
            if whole_issue:
                seq_whole_issue += 1
            else:
                seq_partial_issue += 1
        target_dets: List[int] = list(all_frames) if whole_issue else list(issue_frames)
        for det_id in target_dets:
            update_detection_stage(
                args.remote_api,
                token,
                det_id,
                "bbox_annotation",
                args.dry_run,
                annotation_map.get(det_id),
            )

        # For any remaining detections that have label data but were not staged above,
        # push the annotation payload while keeping them annotated.
        updated = set(target_dets) if target_dets else set()
        for det_id, ann_payload in annotation_map.items():
            if det_id in updated:
                continue
            update_detection_stage(
                args.remote_api,
                token,
                det_id,
                "annotated",
                args.dry_run,
                ann_payload,
            )

    logging.info(
        "Done. Processed=%s, ok=%s, whole_issue=%s, partial_issue=%s, not_found=%s",
        processed,
        seq_ok,
        seq_whole_issue,
        seq_partial_issue,
        seq_not_found,
    )


if __name__ == "__main__":
    main()
