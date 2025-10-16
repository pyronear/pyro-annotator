"""
Import annotations from a backup JSON into the local annotation API.

Example:
uv run python -m scripts.data_transfer.ingestion.platform.import_annotations \
  --backup outputs/sequences_and_annotations_20250101.json \
  --api-base http://localhost:5050/api/v1 \
  --username admin --password admin12345 \
  --page-size 100 \
  --timeout 30 \
  --dry-run \
  --loglevel info
"""

from __future__ import annotations

import argparse
import json
import logging
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

# Globals
TOKEN: Optional[str] = None


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Import annotations into the platform")
    p.add_argument("--backup", required=True, help="Path to backup JSON produced by the exporter")
    p.add_argument("--api-base", default="http://localhost:5050/api/v1", help="Base URL of the API")
    p.add_argument("--username", default="admin", help="API username")
    p.add_argument("--password", default="admin12345", help="API password")
    p.add_argument("--page-size", type=int, default=100, help="Pagination size")
    p.add_argument("--timeout", type=int, default=30, help="HTTP timeout in seconds")
    p.add_argument("--dry-run", action="store_true", help="Do not PATCH, only simulate")
    p.add_argument("--loglevel", default="info", choices=["debug", "info", "warning", "error"])
    return p.parse_args()


def setup_logging(level: str) -> None:
    logging.basicConfig(level=getattr(logging, level.upper()), format="[%(levelname)s] %(message)s")


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_token(api_base: str, username: str, password: str, timeout: int) -> str:
    url = f"{api_base}/auth/login"
    payload = {"username": username, "password": password}
    resp = requests.post(url, json=payload, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise ValueError("No access token in login response")
    logging.info("Token generated successfully")
    return token


def get_headers(api_base: str, username: str, password: str, timeout: int) -> Dict[str, str]:
    global TOKEN
    if TOKEN is None:
        TOKEN = get_token(api_base, username, password, timeout)
    return {
        "accept": "application/json",
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    }


def fetch_all_pages(url: str, params_common: Dict[str, Any], page_size: int, api_base: str, username: str, password: str, timeout: int) -> List[Dict[str, Any]]:
    all_items: List[Dict[str, Any]] = []
    page = 1
    while True:
        params = {**params_common, "page": page, "size": page_size}
        try:
            resp = requests.get(url, headers=get_headers(api_base, username, password, timeout), params=params, timeout=timeout)
            if resp.status_code == 401:
                global TOKEN
                TOKEN = get_token(api_base, username, password, timeout)
                resp = requests.get(url, headers=get_headers(api_base, username, password, timeout), params=params, timeout=timeout)
            resp.raise_for_status()
        except Exception as e:
            logging.error("Failed to fetch page %s: %s", page, e)
            break

        data = resp.json()
        items = data.get("items", [])
        if not items:
            break
        all_items.extend(items)
        pages = data.get("pages")
        logging.debug("Fetched page %s count %s pages %s", page, len(items), pages)
        if pages is not None and page >= pages:
            break
        page += 1

    return all_items


def build_payload_keep_bboxes_update_labels(old_ann: Dict[str, Any], curr_ann: Dict[str, Any]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    for k in [
        "has_smoke",
        "has_false_positives",
        "false_positive_types",
        "smoke_types",
        "has_missed_smoke",
        "is_unsure",
        "processing_stage",
    ]:
        if k in old_ann:
            payload[k] = deepcopy(old_ann[k])

    ann_curr = deepcopy(curr_ann.get("annotation", {}))
    curr_groups = ann_curr.get("sequences_bbox", []) if isinstance(ann_curr, dict) else []
    old_groups = old_ann.get("annotation", {}).get("sequences_bbox", []) if isinstance(old_ann.get("annotation", {}), dict) else []

    for i in range(min(len(curr_groups), len(old_groups))):
        og = old_groups[i]
        cg = curr_groups[i]
        if isinstance(og, dict) and isinstance(cg, dict):
            if "is_smoke" in og:
                cg["is_smoke"] = og["is_smoke"]
            if "smoke_type" in og:
                cg["smoke_type"] = og["smoke_type"]
            if "false_positive_types" in og:
                cg["false_positive_types"] = deepcopy(og["false_positive_types"])

    ann_curr["sequences_bbox"] = curr_groups
    payload["annotation"] = ann_curr
    payload["updated_at"] = iso_utc_now()
    return payload


def patch_keep_bboxes(api_base: str, sequence_id: int, body: Dict[str, Any], api_username: str, api_password: str, timeout: int, dry_run: bool) -> tuple[int, Dict[str, Any]]:
    url = f"{api_base}/annotations/sequences/{sequence_id}"
    if dry_run:
        logging.info("[DRY RUN] PATCH %s", url)
        return 200, {"dry_run": True}

    headers = get_headers(api_base, api_username, api_password, timeout)
    resp = requests.patch(url, headers=headers, json=body, timeout=timeout)

    if resp.status_code == 401:
        global TOKEN
        TOKEN = get_token(api_base, api_username, api_password, timeout)
        resp = requests.patch(url, headers=get_headers(api_base, api_username, api_password, timeout), json=body, timeout=timeout)

    try:
        data = resp.json()
    except Exception:
        data = {"text": resp.text}
    return resp.status_code, data


def run_import(
    backup_path: str,
    api_base: str,
    username: str,
    password: str,
    page_size: int,
    timeout: int,
    dry_run: bool,
) -> None:
    # 1 load backup
    with open(backup_path, "r", encoding="utf-8") as f:
        backup: Dict[str, Any] = json.load(f)

    old_sequences = backup.get("sequences", {}).get("items", [])
    old_annotations = backup.get("annotations", {}).get("items", [])
    old_seq_by_alert = {s.get("alert_api_id"): s for s in old_sequences if s.get("alert_api_id") is not None}
    old_ann_by_seqid = {a.get("sequence_id"): a for a in old_annotations if a.get("sequence_id") is not None}

    logging.info("Backup sequences keyed by alert_api_id: %s", len(old_seq_by_alert))
    logging.info("Backup annotations keyed by sequence_id: %s", len(old_ann_by_seqid))

    # 2 fetch current data from API
    seq_params = {
        "include_annotation": False,
        "detection_annotation_completion": "all",
        "include_detection_stats": False,
        "order_by": "created_at",
        "order_direction": "desc",
    }
    annot_params = {
        "order_by": "created_at",
        "order_direction": "desc",
    }

    base_seq = f"{api_base}/sequences/"
    base_annot = f"{api_base}/annotations/sequences/"

    new_sequences = fetch_all_pages(base_seq, seq_params, page_size, api_base, username, password, timeout)
    new_annotations = fetch_all_pages(base_annot, annot_params, page_size, api_base, username, password, timeout)

    logging.info("Fetched new sequences: %s", len(new_sequences))
    logging.info("Fetched new annotations: %s", len(new_annotations))

    new_seq_by_id = {s.get("id"): s for s in new_sequences if s.get("id") is not None}

    # 3 loop and patch
    updated = 0
    skipped_no_seq = 0
    skipped_no_alert = 0
    skipped_not_in_backup = 0
    skipped_no_old_ann = 0
    errors = 0

    for curr_ann in new_annotations:
        new_seq_id = curr_ann.get("sequence_id")
        if new_seq_id is None:
            skipped_no_seq += 1
            continue

        new_seq = new_seq_by_id.get(new_seq_id)
        if not new_seq:
            skipped_no_seq += 1
            continue

        alert_id = new_seq.get("alert_api_id")
        if alert_id is None:
            skipped_no_alert += 1
            continue

        old_seq = old_seq_by_alert.get(alert_id)
        if not old_seq:
            skipped_not_in_backup += 1
            continue

        old_ann = old_ann_by_seqid.get(old_seq.get("id"))
        if not old_ann:
            skipped_no_old_ann += 1
            continue

        body = build_payload_keep_bboxes_update_labels(old_ann, curr_ann)
        status, data = patch_keep_bboxes(api_base, curr_ann["id"], body, username, password, timeout, dry_run)
        if 200 <= status < 300:
            updated += 1
            logging.info("Updated sequence %s using alert %s from old sequence %s", new_seq_id, alert_id, old_seq.get("id"))
        else:
            errors += 1
            logging.error("PATCH failed for sequence %s alert %s status %s", new_seq_id, alert_id, status)
            logging.debug(json.dumps(data, indent=2))

    print("Done.")
    print("Updated:", updated)
    print("Skipped missing new sequence:", skipped_no_seq)
    print("Skipped missing alert on new sequence:", skipped_no_alert)
    print("Skipped alert not found in backup:", skipped_not_in_backup)
    print("Skipped missing old annotation:", skipped_no_old_ann)
    print("Errors:", errors)


def main() -> None:
    args = parse_args()
    setup_logging(args.loglevel)
    run_import(
        backup_path=args.backup,
        api_base=args.api_base,
        username=args.username,
        password=args.password,
        page_size=args.page_size,
        timeout=args.timeout,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
