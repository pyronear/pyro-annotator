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
  --verify-ssl \
  --loglevel info

If ANNOTATOR_LOGIN and ANNOTATOR_PASSWORD are set in the environment,
they override the default username and password.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

# Globals
TOKEN: Optional[str] = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import annotations into the platform")
    parser.add_argument(
        "--backup",
        required=True,
        help="Path to backup JSON produced by the exporter",
    )
    parser.add_argument(
        "--api-base",
        default="http://localhost:5050/api/v1",
        help="Base URL of the API",
    )
    parser.add_argument(
        "--username",
        default=os.getenv("ANNOTATOR_LOGIN", "admin"),
        help="API username, defaults to ANNOTATOR_LOGIN or admin",
    )
    parser.add_argument(
        "--password",
        default=os.getenv("ANNOTATOR_PASSWORD", "admin12345"),
        help="API password, defaults to ANNOTATOR_PASSWORD or admin12345",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=100,
        help="Pagination size",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="HTTP timeout in seconds",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not PATCH, only simulate",
    )
    parser.add_argument(
        "--verify-ssl",
        action="store_true",
        help="Verify TLS certificates when connecting to the API",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )

    return parser.parse_args()


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="[%(levelname)s] %(message)s",
    )


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_token(
    api_base: str,
    username: str,
    password: str,
    timeout: int,
    verify_ssl: bool,
) -> str:
    url = f"{api_base}/auth/login"
    payload = {"username": username, "password": password}
    resp = requests.post(url, json=payload, timeout=timeout, verify=verify_ssl)
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise ValueError("No access token in login response")
    logging.info("Token generated successfully")
    return token


def get_headers(
    api_base: str,
    username: str,
    password: str,
    timeout: int,
    verify_ssl: bool,
) -> Dict[str, str]:
    global TOKEN
    if TOKEN is None:
        TOKEN = get_token(api_base, username, password, timeout, verify_ssl)
    return {
        "accept": "application/json",
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    }


def fetch_all_pages(
    url: str,
    params_common: Dict[str, Any],
    page_size: int,
    api_base: str,
    username: str,
    password: str,
    timeout: int,
    verify_ssl: bool,
) -> List[Dict[str, Any]]:
    all_items: List[Dict[str, Any]] = []
    page = 1

    while True:
        params = {**params_common, "page": page, "size": page_size}
        try:
            resp = requests.get(
                url,
                headers=get_headers(api_base, username, password, timeout, verify_ssl),
                params=params,
                timeout=timeout,
                verify=verify_ssl,
            )
            if resp.status_code == 401:
                global TOKEN
                TOKEN = get_token(api_base, username, password, timeout, verify_ssl)
                resp = requests.get(
                    url,
                    headers=get_headers(
                        api_base,
                        username,
                        password,
                        timeout,
                        verify_ssl,
                    ),
                    params=params,
                    timeout=timeout,
                    verify=verify_ssl,
                )
            resp.raise_for_status()
        except Exception as exc:
            logging.error("Failed to fetch page %s: %s", page, exc)
            break

        data = resp.json()
        items = data.get("items", [])
        if not items:
            break

        all_items.extend(items)
        pages = data.get("pages")
        logging.debug(
            "Fetched page %s count %s pages %s",
            page,
            len(items),
            pages,
        )
        if pages is not None and page >= pages:
            break

        page += 1

    return all_items


def build_payload_keep_bboxes_update_labels(
    old_ann: Dict[str, Any],
    curr_ann: Dict[str, Any],
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}

    for key in [
        "has_smoke",
        "has_false_positives",
        "false_positive_types",
        "smoke_types",
        "has_missed_smoke",
        "is_unsure",
        "processing_stage",
    ]:
        if key in old_ann:
            payload[key] = deepcopy(old_ann[key])

    ann_curr = deepcopy(curr_ann.get("annotation", {}))
    curr_groups = (
        ann_curr.get("sequences_bbox", [])
        if isinstance(ann_curr, dict)
        else []
    )
    old_ann_raw = old_ann.get("annotation", {})
    old_groups = (
        old_ann_raw.get("sequences_bbox", [])
        if isinstance(old_ann_raw, dict)
        else []
    )

    for idx in range(min(len(curr_groups), len(old_groups))):
        og = old_groups[idx]
        cg = curr_groups[idx]
        if not isinstance(og, dict) or not isinstance(cg, dict):
            continue

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


def patch_keep_bboxes(
    api_base: str,
    sequence_annotation_id: int,
    body: Dict[str, Any],
    api_username: str,
    api_password: str,
    timeout: int,
    dry_run: bool,
    verify_ssl: bool,
) -> tuple[int, Dict[str, Any]]:
    url = f"{api_base}/annotations/sequences/{sequence_annotation_id}"

    if dry_run:
        logging.info("[DRY RUN] PATCH %s", url)
        return 200, {"dry_run": True}

    headers = get_headers(api_base, api_username, api_password, timeout, verify_ssl)
    resp = requests.patch(
        url,
        headers=headers,
        json=body,
        timeout=timeout,
        verify=verify_ssl,
    )

    if resp.status_code == 401:
        global TOKEN
        TOKEN = get_token(api_base, api_username, api_password, timeout, verify_ssl)
        resp = requests.patch(
            url,
            headers=get_headers(
                api_base,
                api_username,
                api_password,
                timeout,
                verify_ssl,
            ),
            json=body,
            timeout=timeout,
            verify=verify_ssl,
        )

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
    verify_ssl: bool,
) -> None:
    # Load backup
    with open(backup_path, "r", encoding="utf-8") as fp:
        backup: Dict[str, Any] = json.load(fp)

    old_sequences = backup.get("sequences", {}).get("items", [])
    old_annotations = backup.get("annotations", {}).get("items", [])

    old_seq_by_alert = {
        seq.get("alert_api_id"): seq
        for seq in old_sequences
        if seq.get("alert_api_id") is not None
    }
    old_ann_by_seqid = {
        ann.get("sequence_id"): ann
        for ann in old_annotations
        if ann.get("sequence_id") is not None
    }

    logging.info(
        "Backup sequences keyed by alert_api_id: %s",
        len(old_seq_by_alert),
    )
    logging.info(
        "Backup annotations keyed by sequence_id: %s",
        len(old_ann_by_seqid),
    )

    # Fetch current data from API
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

    new_sequences = fetch_all_pages(
        base_seq,
        seq_params,
        page_size,
        api_base,
        username,
        password,
        timeout,
        verify_ssl,
    )
    new_annotations = fetch_all_pages(
        base_annot,
        annot_params,
        page_size,
        api_base,
        username,
        password,
        timeout,
        verify_ssl,
    )

    logging.info("Fetched new sequences: %s", len(new_sequences))
    logging.info("Fetched new annotations: %s", len(new_annotations))

    new_seq_by_id = {
        seq.get("id"): seq
        for seq in new_sequences
        if seq.get("id") is not None
    }

    # Loop and patch
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
        status, data = patch_keep_bboxes(
            api_base=api_base,
            sequence_annotation_id=curr_ann["id"],
            body=body,
            api_username=username,
            api_password=password,
            timeout=timeout,
            dry_run=dry_run,
            verify_ssl=verify_ssl,
        )
        if 200 <= status < 300:
            updated += 1
            logging.info(
                "Updated sequence %s using alert %s from old sequence %s",
                new_seq_id,
                alert_id,
                old_seq.get("id"),
            )
        else:
            errors += 1
            logging.error(
                "PATCH failed for sequence %s alert %s status %s",
                new_seq_id,
                alert_id,
                status,
            )
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
        verify_ssl=args.verify_ssl,
    )


if __name__ == "__main__":
    main()
