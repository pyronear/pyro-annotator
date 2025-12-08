"""
Bulk-update sequence annotations (and optionally sequences) from one processing stage to another.
Useful to retry a workflow, e.g., set all `in_review` back to `seq_annotation_done`.
"""

import argparse
import logging
import os
from typing import Dict, List

from dotenv import load_dotenv

from app.clients import annotation_api

load_dotenv()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bulk update sequence annotation processing_stage values."
    )
    parser.add_argument(
        "--api-url",
        type=str,
        default=os.getenv("URL_API_ANNOTATION", "http://localhost:5050"),
        help="Annotation API base URL",
    )
    parser.add_argument(
        "--username",
        type=str,
        default=os.getenv("MAIN_ANNOTATION_LOGIN", os.getenv("ANNOTATOR_LOGIN", "admin")),
        help="API username",
    )
    parser.add_argument(
        "--password",
        type=str,
        default=os.getenv(
            "MAIN_ANNOTATION_PASSWORD", os.getenv("ANNOTATOR_PASSWORD", "admin12345")
        ),
        help="API password",
    )
    parser.add_argument(
        "--from-stage",
        required=True,
        help="Current processing_stage to filter on (e.g., in_review)",
    )
    parser.add_argument(
        "--to-stage",
        required=True,
        help="New processing_stage to set (e.g., seq_annotation_done)",
    )
    parser.add_argument(
        "--max-sequences",
        type=int,
        default=0,
        help="Optional cap on number of sequences to update (0 = all)",
    )
    parser.add_argument(
        "--update-sequence-stage",
        action="store_true",
        help="Also update the sequence processing_stage (not only the annotation)",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )
    return parser.parse_args()


def list_sequences_by_stage(api_url: str, token: str, stage: str) -> List[Dict]:
    page = 1
    size = 100
    results: List[Dict] = []
    while True:
        resp = annotation_api.list_sequences(
            api_url,
            token,
            processing_stage=stage,
            page=page,
            size=size,
            include_annotation=True,
        )
        items = resp.get("items", [])
        results.extend(items)
        if page >= resp.get("pages", 1):
            break
        page += 1
    return results


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=args.loglevel.upper(), format="%(levelname)s - %(message)s")

    token = annotation_api.get_auth_token(args.api_url, args.username, args.password)
    sequences = list_sequences_by_stage(args.api_url, token, args.from_stage)
    if args.max_sequences:
        sequences = sequences[: args.max_sequences]
    logging.info(
        "Found %s sequence(s) in stage '%s'%s",
        len(sequences),
        args.from_stage,
        f", capped to {args.max_sequences}" if args.max_sequences else "",
    )

    updated = 0
    failed = 0
    for seq in sequences:
        seq_id = seq["id"]
        try:
            ann_resp = annotation_api.list_sequence_annotations(
                args.api_url, token, sequence_id=seq_id, page=1, size=1
            )
            items = ann_resp.get("items", []) if isinstance(ann_resp, dict) else ann_resp
            if not items:
                logging.warning("Sequence %s has no annotation, skipping", seq_id)
                continue
            ann_id = items[0]["id"]

            annotation_api.update_sequence_annotation(
                args.api_url, token, ann_id, {"processing_stage": args.to_stage}
            )

            if args.update_sequence_stage:
                annotation_api.update_sequence(
                    args.api_url, token, seq_id, {"processing_stage": args.to_stage}
                )

            updated += 1
        except Exception as exc:
            failed += 1
            logging.error(
                "Failed to update sequence %s from %s to %s: %s",
                seq_id,
                args.from_stage,
                args.to_stage,
                exc,
            )

    logging.info(
        "Done. Updated=%s, failed=%s, target_stage=%s",
        updated,
        failed,
        args.to_stage,
    )


if __name__ == "__main__":
    main()
