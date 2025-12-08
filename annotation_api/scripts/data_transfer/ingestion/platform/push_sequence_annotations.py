"""
Sync local sequence annotations to a remote annotation API.

Workflow:
1. List annotated sequences on the local API (optionally filter by alert_api_id and limit).
2. For each, find the corresponding sequence on the remote API by alert_api_id.
3. Create or update the sequence annotation on the remote API.
"""

import argparse
import logging
from typing import List, Optional, Dict, Any

from dotenv import load_dotenv

from app.clients import annotation_api
from app.models import SequenceAnnotationProcessingStage
from . import shared

# Load environment variables from .env automatically
load_dotenv()


def parse_sequence_selection(sequence_arg: str) -> List[int]:
    """Parse comma/space separated alert_api_id list."""
    tokens = [t.strip() for t in sequence_arg.replace(",", " ").split() if t.strip()]
    ids: List[int] = []
    for tok in tokens:
        try:
            ids.append(int(tok))
        except ValueError as exc:
            raise ValueError(f"Invalid sequence id '{tok}' in sequence list") from exc
    return ids


def fetch_local_annotated_sequences(
    base_url: str,
    token: str,
    sequence_filter: Optional[List[int]],
    max_sequences: Optional[int],
) -> List[Dict[str, Any]]:
    """Fetch annotated sequences from local API with optional filtering/limit."""
    page = 1
    size = 100
    results: List[Dict[str, Any]] = []
    targets = set(sequence_filter) if sequence_filter else None

    while True:
        params = {
            "page": page,
            "size": size,
            "processing_stage": "annotated",
        }
        resp = annotation_api.list_sequences(base_url, token, **params)
        items = resp.get("items", [])
        for seq in items:
            if targets and seq.get("alert_api_id") not in targets:
                continue
            results.append(seq)
            if max_sequences and len(results) >= max_sequences:
                return results
        if page >= resp.get("pages", 1):
            break
        page += 1
    return results


def get_sequence_annotation_single(
    base_url: str, token: str, sequence_id: int
) -> Optional[Dict[str, Any]]:
    """Return the first annotation for a sequence, if any."""
    resp = annotation_api.list_sequence_annotations(
        base_url, token, sequence_id=sequence_id, page=1, size=1
    )
    items = resp.get("items", []) if isinstance(resp, dict) else resp
    if items:
        return items[0]
    return None


def find_remote_sequence_by_alert_id(
    base_url: str,
    token: str,
    alert_api_id: int,
    source_api: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Lookup a remote sequence by alert_api_id (and optional source_api) via pagination."""
    page = 1
    size = 100
    target_alert = str(alert_api_id)
    while True:
        params = {"page": page, "size": size}
        if source_api:
            params["source_api"] = source_api
        resp = annotation_api.list_sequences(base_url, token, **params)
        items = resp.get("items", [])
        for seq in items:
            remote_alert = str(seq.get("alert_api_id"))
            if remote_alert == target_alert and (
                not source_api or seq.get("source_api") == source_api
            ):
                return seq
        if page >= resp.get("pages", 1):
            break
        page += 1
    return None


def build_detection_id_map(
    local_api: str,
    local_token: str,
    remote_api: str,
    remote_token: str,
    local_seq_id: int,
    remote_seq_id: int,
) -> Dict[int, int]:
    """
    Map local detection_id -> remote detection_id using alert_api_id as the stable key.
    """
    local_map: Dict[int, int] = {}
    alert_to_remote: Dict[str, int] = {}

    # Fetch remote detections
    page = 1
    size = 100
    while True:
        resp = annotation_api.list_detections(
            remote_api,
            remote_token,
            sequence_id=remote_seq_id,
            page=page,
            size=size,
        )
        for det in resp.get("items", []):
            alert = det.get("alert_api_id")
            if alert is not None:
                alert_to_remote[str(alert)] = det["id"]
        if page >= resp.get("pages", 1):
            break
        page += 1

    # Fetch local detections and build mapping
    page = 1
    while True:
        resp = annotation_api.list_detections(
            local_api,
            local_token,
            sequence_id=local_seq_id,
            page=page,
            size=size,
        )
        for det in resp.get("items", []):
            alert = det.get("alert_api_id")
            if alert is None:
                continue
            remote_id = alert_to_remote.get(str(alert))
            if remote_id:
                local_map[det["id"]] = remote_id
        if page >= resp.get("pages", 1):
            break
        page += 1

    return local_map


def remap_annotation_bboxes(annotation: Dict[str, Any], id_map: Dict[int, int]) -> Dict[str, Any]:
    """
    Replace detection_id in annotation bboxes using the provided mapping.
    Bboxes without a mapping are dropped.
    """
    remapped_sequences = []
    for seq_bbox in annotation.get("sequences_bbox", []):
        bboxes = []
        for bbox in seq_bbox.get("bboxes", []):
            local_id = bbox.get("detection_id")
            remote_id = id_map.get(local_id)
            if remote_id:
                new_bbox = dict(bbox)
                new_bbox["detection_id"] = remote_id
                bboxes.append(new_bbox)
        if bboxes:
            new_seq = dict(seq_bbox)
            new_seq["bboxes"] = bboxes
            remapped_sequences.append(new_seq)
    return {"sequences_bbox": remapped_sequences}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Push local sequence annotations to a remote annotation API"
    )
    parser.add_argument(
        "--local-api",
        type=str,
        default="http://localhost:5050",
        help="Local annotation API base URL",
    )
    parser.add_argument(
        "--remote-api",
        type=str,
        default="https://annotationapi.pyronear.org",
        help="Remote (main) annotation API base URL",
    )
    parser.add_argument(
        "--sequence-list",
        type=str,
        help="Optional comma/space-separated alert_api_id list to restrict syncing",
    )
    parser.add_argument(
        "--max-sequences",
        type=int,
        default=None,
        help="Maximum number of sequences to sync",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be synced without modifying the remote API",
    )
    parser.add_argument(
        "--loglevel",
        type=str,
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )

    args = parser.parse_args()
    logging.basicConfig(
        level=args.loglevel.upper(), format="%(asctime)s - %(levelname)s - %(message)s"
    )

    sequence_filter = (
        parse_sequence_selection(args.sequence_list) if args.sequence_list else None
    )

    # Auth tokens
    local_login, local_password = shared.get_annotation_credentials(args.local_api)
    remote_login, remote_password = shared.get_annotation_credentials(args.remote_api)

    local_token = annotation_api.get_auth_token(
        args.local_api, username=local_login, password=local_password
    )
    remote_token = annotation_api.get_auth_token(
        args.remote_api, username=remote_login, password=remote_password
    )

    logging.info(
        f"Fetching annotated sequences from local API {args.local_api} "
        f"(filter={sequence_filter or 'none'}, max={args.max_sequences or 'all'})"
    )
    local_sequences = fetch_local_annotated_sequences(
        args.local_api, local_token, sequence_filter, args.max_sequences
    )
    logging.info(f"Found {len(local_sequences)} annotated sequence(s) locally")

    stats = {
        "attempted": 0,
        "synced_new": 0,
        "synced_updated": 0,
        "skipped_no_annotation": 0,
        "skipped_no_detections_mapped": 0,
        "missing_remote": 0,
        "errors": 0,
    }

    for seq in local_sequences:
        stats["attempted"] += 1
        alert_id = seq.get("alert_api_id")
        source_api = seq.get("source_api")

        # Fetch local annotation
        local_ann = get_sequence_annotation_single(args.local_api, local_token, seq["id"])
        if not local_ann:
            logging.warning(f"Skipping alert_api_id={alert_id}: no local annotation")
            stats["skipped_no_annotation"] += 1
            continue

        # Find matching remote sequence by alert_api_id (and source_api if available)
        remote_seq = find_remote_sequence_by_alert_id(
            args.remote_api, remote_token, alert_id, source_api=source_api
        )
        if not remote_seq:
            logging.warning(
                f"Skipping alert_api_id={alert_id}: not found on remote API"
            )
            stats["missing_remote"] += 1
            continue
        remote_seq_id = remote_seq["id"]
        logging.debug(
            f"Matched alert_api_id={alert_id} to remote_seq_id={remote_seq_id} "
            f"(remote alert_api_id={remote_seq.get('alert_api_id')}, source_api={remote_seq.get('source_api')})"
        )

        # Build detection id mapping and remap annotation bboxes
        det_id_map = build_detection_id_map(
            args.local_api,
            local_token,
            args.remote_api,
            remote_token,
            seq["id"],
            remote_seq_id,
        )
        remapped_annotation = remap_annotation_bboxes(
            local_ann.get("annotation", {}), det_id_map
        )
        if not remapped_annotation.get("sequences_bbox"):
            logging.warning(
                f"Skipping alert_api_id={alert_id}: no detection mappings found"
            )
            stats["skipped_no_detections_mapped"] += 1
            continue

        # Check if remote already has an annotation
        remote_ann = get_sequence_annotation_single(
            args.remote_api, remote_token, remote_seq_id
        )

        # Build payload from local annotation
        payload = {
            "sequence_id": remote_seq_id,
            "annotation": remapped_annotation,
            "processing_stage": SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE.value,
            "has_missed_smoke": local_ann.get("has_missed_smoke", False),
        }

        try:
            if args.dry_run:
                action = "update" if remote_ann else "create"
                logging.info(
                    f"DRY RUN: would {action} annotation for alert_api_id={alert_id} "
                    f"(remote_seq_id={remote_seq_id})"
                )
                continue

            if remote_ann:
                annotation_api.update_sequence_annotation(
                    args.remote_api, remote_token, remote_ann["id"], payload
                )
                stats["synced_updated"] += 1
                logging.info(
                    f"Updated remote annotation for alert_api_id={alert_id} "
                    f"(remote_seq_id={remote_seq_id})"
                )
            else:
                annotation_api.create_sequence_annotation(
                    args.remote_api, remote_token, payload
                )
                stats["synced_new"] += 1
                logging.info(
                    f"Created remote annotation for alert_api_id={alert_id} "
                    f"(remote_seq_id={remote_seq_id})"
                )
        except Exception as exc:
            logging.error(
                f"Failed to sync annotation for alert_api_id={alert_id}: {exc}"
            )
            stats["errors"] += 1

    logging.info(
        f"Done. Attempted={stats['attempted']}, "
        f"created={stats['synced_new']}, updated={stats['synced_updated']}, "
        f"missing_remote={stats['missing_remote']}, "
        f"no_local_annotation={stats['skipped_no_annotation']}, "
        f"no_detections_mapped={stats['skipped_no_detections_mapped']}, "
        f"errors={stats['errors']}"
    )


if __name__ == "__main__":
    main()
