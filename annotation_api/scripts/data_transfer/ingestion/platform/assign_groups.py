"""Trigger the annotation API's `POST /sequence_groups/assign` endpoint and
print the result. Single-threaded by contract — meant to run sequentially
after `import-platform`, not concurrently with it.

Usage (from `annotation_api/`):
    uv run python -m scripts.data_transfer.ingestion.platform.assign_groups \
        --url-api-annotation http://localhost:5050
"""

from __future__ import annotations

import argparse
import logging
import sys

import requests

from .shared import get_annotation_credentials


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url-api-annotation",
        default="http://localhost:5050",
        help="Annotation API URL (default: http://localhost:5050)",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=args.loglevel.upper())

    base_url = args.url_api_annotation.rstrip("/")
    login, password = get_annotation_credentials(base_url)

    auth = requests.post(
        f"{base_url}/api/v1/auth/login",
        json={"username": login, "password": password},
        timeout=30,
    )
    auth.raise_for_status()
    token = auth.json()["access_token"]

    response = requests.post(
        f"{base_url}/api/v1/sequence_groups/assign",
        headers={"Authorization": f"Bearer {token}"},
        timeout=600,
    )
    if response.status_code != 200:
        logging.error(
            "assign-groups failed: HTTP %s — %s", response.status_code, response.text
        )
        sys.exit(1)

    summary = response.json()
    print(
        "assign-groups: "
        f"processed={summary['processed']} "
        f"new_groups={summary['new_groups']} "
        f"joined_existing={summary['joined_existing']} "
        f"inherited_annotations={summary['inherited_annotations']} "
        f"skipped_no_bbox={summary['skipped_no_bbox']}"
    )


if __name__ == "__main__":
    main()
