"""
Utility script to delete sequences from an annotation API.

Use this to clean up partial/duplicate sequences (e.g., those without annotations)
before re-running imports.
"""

import argparse
import logging
from typing import List, Optional

from app.clients import annotation_api

from . import shared


def parse_sequence_selection(sequence_arg: str) -> List[int]:
    """Parse comma/whitespace separated alert_api_id list."""
    tokens = [t.strip() for t in sequence_arg.replace(",", " ").split() if t.strip()]
    ids: List[int] = []
    for tok in tokens:
        try:
            ids.append(int(tok))
        except ValueError as exc:
            raise ValueError(f"Invalid sequence id '{tok}' in sequence list") from exc
    return ids


def fetch_sequences(
    base_url: str,
    auth_token: str,
    processing_stage: str,
    alert_ids: Optional[List[int]],
) -> List[dict]:
    """Fetch sequences from annotation API matching filters."""
    page = 1
    size = 100
    results: List[dict] = []
    while True:
        params = {"page": page, "size": size}
        if processing_stage != "all":
            params["processing_stage"] = processing_stage
        resp = annotation_api.list_sequences(base_url, auth_token, **params)
        items = resp.get("items", [])
        for seq in items:
            if alert_ids and seq.get("alert_api_id") not in alert_ids:
                continue
            results.append(seq)
        if page >= resp.get("pages", 1):
            break
        page += 1
    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Delete sequences from annotation API (use with care!)"
    )
    parser.add_argument(
        "--url-api-annotation",
        type=str,
        default="http://localhost:5050",
        help="Annotation API base URL",
    )
    parser.add_argument(
        "--processing-stage",
        type=str,
        choices=["no_annotation", "imported", "ready_to_annotate", "annotated", "all"],
        default="no_annotation",
        help="Filter sequences by processing stage (default: no_annotation)",
    )
    parser.add_argument(
        "--sequence-list",
        type=str,
        help="Optional comma/space-separated alert_api_id list to restrict deletions",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List matching sequences without deleting them",
    )

    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    alert_ids = parse_sequence_selection(args.sequence_list) if args.sequence_list else None

    login, password = shared.get_annotation_credentials(args.url_api_annotation)
    token = annotation_api.get_auth_token(args.url_api_annotation, login, password)

    sequences = fetch_sequences(
        args.url_api_annotation, token, args.processing_stage, alert_ids
    )

    logging.info(
        f"Found {len(sequences)} sequence(s) matching processing_stage={args.processing_stage}"
        + (f" and alert_ids filter ({len(alert_ids)} provided)" if alert_ids else "")
    )

    if args.dry_run or not sequences:
        logging.info("Dry run enabled or no sequences found; exiting without deletion.")
        return

    for seq in sequences:
        seq_id = seq["id"]
        alert_id = seq.get("alert_api_id")
        try:
            annotation_api.delete_sequence(args.url_api_annotation, token, seq_id)
            logging.info(f"Deleted sequence id={seq_id} alert_api_id={alert_id}")
        except Exception as exc:
            logging.error(f"Failed to delete sequence id={seq_id} alert_api_id={alert_id}: {exc}")


if __name__ == "__main__":
    main()
