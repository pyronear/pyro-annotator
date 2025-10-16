"""
Export all sequences and annotations from the local annotation API to a single JSON file.

Example:
uv run python -m scripts.data_transfer.ingestion.platform.export_annotations \
  --api-base http://localhost:5050/api/v1 \
  --username admin --password admin12345 \
  --output outputs/sequences_and_annotations.json \
  --loglevel info
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export sequences and annotations to JSON")
    parser.add_argument("--api-base", default="http://localhost:5050/api/v1", help="Base URL of the API")
    parser.add_argument("--username", default="admin", help="API username")
    parser.add_argument("--password", default="admin12345", help="API password")
    parser.add_argument("--page-size", type=int, default=50, help="Page size for pagination")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP request timeout in seconds")
    parser.add_argument("--output", default="", help="Output JSON path, defaults to outputs/sequences_and_annotations_YYYYMMDD.json")
    parser.add_argument("--loglevel", default="info", choices=["debug", "info", "warning", "error"])
    parser.add_argument("--verify-ssl", action="store_true", help="Verify TLS certificates")
    return parser.parse_args()


def setup_logging(level: str) -> None:
    logging.basicConfig(level=getattr(logging, level.upper()), format="[%(levelname)s] %(message)s")


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_output_path() -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    p = Path(f"outputs/sequences_and_annotations_{timestamp}.json")
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def get_token(api_base: str, username: str, password: str, timeout: int, verify_ssl: bool) -> str:
    login_url = f"{api_base}/auth/login"
    payload = {"username": username, "password": password}
    resp = requests.post(login_url, json=payload, timeout=timeout, verify=verify_ssl)
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError("Login response did not include access_token")
    logging.info("Token generated successfully")
    return token


def fetch_all_pages(url: str, headers: Dict[str, str], params_common: Dict[str, Any], page_size: int, timeout: int, verify_ssl: bool) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    page = 1
    while True:
        params = {**params_common, "page": page, "size": page_size}
        resp = requests.get(url, headers=headers, params=params, timeout=timeout, verify=verify_ssl)
        resp.raise_for_status()
        data = resp.json()
        page_items = data.get("items", [])
        if not page_items:
            break
        items.extend(page_items)
        pages = data.get("pages")
        logging.debug("Fetched page %s, items %s, total pages %s", page, len(page_items), pages)
        if pages is not None and page >= pages:
            break
        page += 1
    return items


def export_all(api_base: str, username: str, password: str, page_size: int, timeout: int, verify_ssl: bool) -> Dict[str, Any]:
    token = get_token(api_base, username, password, timeout, verify_ssl)
    headers = {"accept": "application/json", "Authorization": f"Bearer {token}"}

    base_annot = f"{api_base}/annotations/sequences/"
    base_seq = f"{api_base}/sequences/"

    annot_params = {"order_by": "created_at", "order_direction": "desc"}
    seq_params = {
        "include_annotation": False,
        "detection_annotation_completion": "all",
        "include_detection_stats": False,
        "order_by": "created_at",
        "order_direction": "desc",
    }

    logging.info("Fetching annotations")
    annotations = fetch_all_pages(base_annot, headers, annot_params, page_size, timeout, verify_ssl)
    logging.info("Fetching sequences")
    sequences = fetch_all_pages(base_seq, headers, seq_params, page_size, timeout, verify_ssl)

    payload = {
        "generated_at": iso_utc_now(),
        "annotations": {"count": len(annotations), "items": annotations},
        "sequences": {"count": len(sequences), "items": sequences},
    }
    logging.info("Collected %s annotations and %s sequences", len(annotations), len(sequences))
    return payload


def main() -> None:
    args = parse_args()
    setup_logging(args.loglevel)

    out_path = Path(args.output) if args.output else default_output_path()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = export_all(
        api_base=args.api_base,
        username=args.username,
        password=args.password,
        page_size=args.page_size,
        timeout=args.timeout,
        verify_ssl=args.verify_ssl,
    )

    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    logging.info("Saved export to %s", out_path)


if __name__ == "__main__":
    main()
