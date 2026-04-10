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
from concurrent.futures import ThreadPoolExecutor, as_completed
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
        "--max-workers",
        type=int,
        default=4,
        help="Number of worker threads for parallel processing",
    )
    parser.add_argument(
        "--fp-mode",
        action="store_true",
        help="False-positive mode: clean sequences get 'managed' stage with empty annotations instead of 'annotated'",
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


def fetch_all_sequences(remote_api: str, token: str) -> Dict[int, Dict]:
    """
    Fetch in_review sequences and return a lookup dict keyed by alert_api_id.
    """
    page = 1
    size = 100
    lookup: Dict[int, Dict] = {}
    while True:
        resp = annotation_api.list_sequences(
            remote_api,
            token,
            processing_stage="in_review",
            page=page,
            size=size,
            include_annotation=True,
        )
        items = resp.get("items", [])
        for item in items:
            aid = item.get("alert_api_id")
            if aid is not None:
                lookup[aid] = item
        if page >= resp.get("pages", 1):
            break
        page += 1
    return lookup


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

    missing = [det_id for det_id in detection_ids if det_id not in annotated_dets]
    if not missing or dry_run:
        if dry_run and missing:
            logging.info("[DRY-RUN] Would create %d detection annotations", len(missing))
        return missing

    def _create_one(det_id: int) -> None:
        try:
            ann_payload = {"annotation": annotation_map[det_id]} if annotation_map and det_id in annotation_map else {"annotation": []}
            annotation_api.create_detection_annotation(remote_api, token, det_id, ann_payload, default_stage)
        except Exception as exc:  # noqa: BLE001
            logging.error("Failed to create detection annotation for detection_id=%s: %s", det_id, exc)

    with ThreadPoolExecutor(max_workers=8) as pool:
        pool.map(_create_one, missing)
    logging.info("Created %d detection annotation placeholders", len(missing))
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

    if dry_run:
        logging.info("[DRY-RUN] Would delete %d detection annotations", len(ann_ids))
        return len(ann_ids)

    def _delete_one(ann_id: int) -> None:
        try:
            annotation_api.delete_detection_annotation(remote_api, token, ann_id)
        except Exception as exc:  # noqa: BLE001
            logging.error("Failed to delete detection annotation %s: %s", ann_id, exc)

    with ThreadPoolExecutor(max_workers=8) as pool:
        pool.map(_delete_one, ann_ids)
    logging.info("Deleted %d detection annotations", len(ann_ids))
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


def process_one_sequence(
    alert_id: int,
    info: Dict,
    seq_lookup: Dict[int, Dict],
    remote_api: str,
    token: str,
    labels_root: Path,
    dry_run: bool,
    fp_mode: bool = False,
) -> str:
    """Process a single sequence. Returns status string."""
    seq = seq_lookup.get(alert_id)
    if not seq:
        logging.warning("No remote sequence found for alert_api_id=%s", alert_id)
        return "not_found"
    seq_id = seq["id"]

    # Remove any existing detection annotations so we can recreate from labels cleanly
    deleted_count = delete_detection_annotations_for_sequence(remote_api, token, seq_id, dry_run)
    if dry_run and deleted_count:
        logging.info("[DRY-RUN] Would delete %s detection annotations for sequence_id=%s", deleted_count, seq_id)

    # Load detections and ensure annotations exist for them
    detections = list_all_detections(remote_api, token, seq_id)
    detection_ids = [d["id"] for d in detections]
    annotation_map: Dict[int, List[Dict]] = {}
    for det in detections:
        data = load_yolo_annotation(labels_root, alert_id, det["id"])
        if data is not None:
            annotation_map[det["id"]] = data
    ensure_detection_annotations(
        remote_api, token, seq_id, detection_ids,
        default_stage="bbox_annotation", dry_run=dry_run, annotation_map=annotation_map,
    )

    issue_frames = info["issue_frames"]
    whole_issue = info["whole_issue"]
    all_frames = info["all_frames"]

    if not issue_frames and not whole_issue:
        update_sequence_stage(remote_api, token, seq_id, "annotated", dry_run)
        with ThreadPoolExecutor(max_workers=8) as pool:
            # In FP mode, push empty annotations (no bboxes); otherwise push the YOLO labels
            pool.map(
                lambda det_id: update_detection_stage(
                    remote_api, token, det_id, "annotated", dry_run,
                    [] if fp_mode else annotation_map.get(det_id),
                ),
                all_frames,
            )
        return "ok"

    update_sequence_stage(remote_api, token, seq_id, "needs_manual", dry_run)
    status = "whole_issue" if whole_issue else "partial_issue"
    target_dets: List[int] = list(all_frames) if whole_issue else list(issue_frames)

    # Build list of (det_id, stage, annotation_data) for all detections
    updates: List[tuple] = [(det_id, "bbox_annotation", annotation_map.get(det_id)) for det_id in target_dets]
    updated_set = set(target_dets)
    for det_id, ann_payload in annotation_map.items():
        if det_id not in updated_set:
            updates.append((det_id, "annotated", ann_payload))

    with ThreadPoolExecutor(max_workers=8) as pool:
        pool.map(
            lambda args: update_detection_stage(remote_api, token, args[0], args[1], dry_run, args[2]),
            updates,
        )

    return status


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=args.loglevel.upper(), format="%(levelname)s - %(message)s")

    dataset = fo.load_dataset(args.dataset_name)
    reviews = group_reviews(dataset)

    token = annotation_api.get_auth_token(args.remote_api, args.username, args.password)

    # Fetch in_review sequences once upfront instead of per-alert_id
    logging.info("Fetching in_review sequences...")
    seq_lookup = fetch_all_sequences(args.remote_api, token)
    logging.info("Loaded %d remote sequences", len(seq_lookup))

    items = list(reviews.items())
    if args.max_sequences:
        items = items[: args.max_sequences]

    results: Dict[str, int] = {"ok": 0, "whole_issue": 0, "partial_issue": 0, "not_found": 0, "errors": 0}

    with ThreadPoolExecutor(max_workers=args.max_workers) as executor:
        future_map = {
            executor.submit(
                process_one_sequence,
                alert_id, info, seq_lookup,
                args.remote_api, token, args.labels_root, args.dry_run, args.fp_mode,
            ): alert_id
            for alert_id, info in items
        }
        for future in as_completed(future_map):
            alert_id = future_map[future]
            try:
                status = future.result()
                results[status] = results.get(status, 0) + 1
            except Exception as exc:  # noqa: BLE001
                results["errors"] += 1
                logging.error("Unhandled error on alert_api_id=%s: %s", alert_id, exc)

    logging.info(
        "Done. Processed=%s, ok=%s, whole_issue=%s, partial_issue=%s, not_found=%s, errors=%s",
        len(items),
        results["ok"],
        results["whole_issue"],
        results["partial_issue"],
        results["not_found"],
        results["errors"],
    )


if __name__ == "__main__":
    main()
