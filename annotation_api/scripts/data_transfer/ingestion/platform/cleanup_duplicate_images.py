"""
Delete sequences in READY_TO_ANNOTATE stage where at least 2 of the first 3 images are identical.

This catches sequences with duplicate/frozen frames that are not useful for annotation.

Usage:
    # Dry run (list duplicates without deleting)
    uv run python -m scripts.data_transfer.ingestion.platform.cleanup_duplicate_images \
        --url-api-annotation https://your-api-url --dry-run

    # Save images locally to double check before deleting
    uv run python -m scripts.data_transfer.ingestion.platform.cleanup_duplicate_images \
        --url-api-annotation https://your-api-url --dry-run --save-images outputs/duplicate_check

    # Actually delete
    uv run python -m scripts.data_transfer.ingestion.platform.cleanup_duplicate_images \
        --url-api-annotation https://your-api-url
"""

import argparse
import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import combinations
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

from app.clients import annotation_api

from . import shared

load_dotenv()

logger = logging.getLogger(__name__)


def fetch_ready_sequences(base_url: str, auth_token: str) -> list[dict]:
    """Fetch all sequence annotations in READY_TO_ANNOTATE stage, return their sequence info."""
    page = 1
    size = 100
    results: list[dict] = []
    while True:
        resp = annotation_api.list_sequence_annotations(
            base_url,
            auth_token,
            processing_stage="ready_to_annotate",
            page=page,
            size=size,
        )
        items = resp.get("items", [])
        results.extend(items)
        if page >= resp.get("pages", 1):
            break
        page += 1
    return results


def get_first_n_detections(
    base_url: str, auth_token: str, sequence_id: int, n: int = 3
) -> list[dict]:
    """Get the first N detections for a sequence, ordered by recorded_at."""
    resp = annotation_api.list_detections(
        base_url,
        auth_token,
        sequence_id=sequence_id,
        order_by="recorded_at",
        order_direction="asc",
        page=1,
        size=n,
    )
    return resp.get("items", [])


def download_image_bytes(url: str, timeout: int = 30) -> bytes:
    """Download image from a URL and return raw bytes."""
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.content


def image_hash(data: bytes) -> str:
    """Compute MD5 hash of image bytes."""
    return hashlib.md5(data).hexdigest()


def check_duplicate_images(
    base_url: str,
    auth_token: str,
    sequence_id: int,
    save_dir: Optional[Path] = None,
) -> bool:
    """Check if at least 2 of the first 3 images in a sequence are identical.

    If save_dir is provided, saves the downloaded images for manual review.
    """
    detections = get_first_n_detections(base_url, auth_token, sequence_id)

    if len(detections) < 2:
        return False

    hashes: list[Optional[str]] = []
    images: list[Optional[bytes]] = []
    for det in detections:
        det_id = det["id"]
        try:
            url = annotation_api.get_detection_url(base_url, auth_token, det_id)
            img_bytes = download_image_bytes(url)
            hashes.append(image_hash(img_bytes))
            images.append(img_bytes)
        except Exception:
            logger.warning(
                f"Failed to download detection {det_id} for sequence {sequence_id}"
            )
            hashes.append(None)
            images.append(None)

    # Check if any pair of hashes match
    is_duplicate = False
    for i, j in combinations(range(len(hashes)), 2):
        if hashes[i] is not None and hashes[i] == hashes[j]:
            is_duplicate = True
            break

    # Save images if requested
    if save_dir is not None:
        label = "DUP" if is_duplicate else "OK"
        seq_dir = save_dir / f"{label}_seq_{sequence_id}"
        seq_dir.mkdir(parents=True, exist_ok=True)
        for idx, (det, img_bytes) in enumerate(zip(detections, images)):
            if img_bytes is not None:
                h = hashes[idx] or "unknown"
                filepath = seq_dir / f"det_{det['id']}_{h[:8]}.jpg"
                filepath.write_bytes(img_bytes)

    return is_duplicate


def format_seq_info(seq_info: dict) -> str:
    """Format sequence info for logging."""
    parts = [
        f"org={seq_info.get('organisation_name', '?')}",
        f"camera={seq_info.get('camera_name', '?')}",
        f"recorded={seq_info.get('recorded_at', '?')}",
        f"alert_id={seq_info.get('alert_api_id', '?')}",
    ]
    return " | ".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Delete READY_TO_ANNOTATE sequences with duplicate images"
    )
    parser.add_argument(
        "--url-api-annotation",
        type=str,
        default="http://localhost:5050",
        help="Annotation API base URL",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List duplicates without deleting",
    )
    parser.add_argument(
        "--save-images",
        type=str,
        default=None,
        help="Save duplicate images to this directory for manual review",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=10,
        help="Number of parallel workers (default: 10)",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    save_dir = Path(args.save_images) if args.save_images else None
    if save_dir:
        save_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Will save duplicate images to {save_dir}")

    login, password = shared.get_annotation_credentials(args.url_api_annotation)
    token = annotation_api.get_auth_token(args.url_api_annotation, login, password)

    logger.info("Fetching READY_TO_ANNOTATE sequences...")
    annotations = fetch_ready_sequences(args.url_api_annotation, token)
    logger.info(f"Found {len(annotations)} sequences in READY_TO_ANNOTATE stage")

    def process_one(i: int, ann: dict) -> Optional[dict]:
        seq_id = ann["sequence_id"]
        try:
            seq_info = annotation_api.get_sequence(
                args.url_api_annotation, token, seq_id
            )
        except Exception:
            seq_info = {"id": seq_id}

        info_str = format_seq_info(seq_info)
        logger.info(f"[{i + 1}/{len(annotations)}] seq {seq_id} | {info_str}")

        try:
            if check_duplicate_images(args.url_api_annotation, token, seq_id, save_dir):
                logger.info(f"  -> DUPLICATE detected in seq {seq_id}")
                return {"annotation": ann, "sequence": seq_info}
        except Exception:
            logger.exception(f"  -> Error checking sequence {seq_id}")
        return None

    duplicates: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(process_one, i, ann): ann for i, ann in enumerate(annotations)
        }
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                duplicates.append(result)

    logger.info(
        f"\nFound {len(duplicates)} sequences with duplicate images out of {len(annotations)}"
    )

    if args.dry_run or not duplicates:
        for dup in duplicates:
            seq = dup["sequence"]
            logger.info(f"  Would delete seq {seq.get('id')} | {format_seq_info(seq)}")
        if save_dir:
            logger.info(f"Images saved to {save_dir} for review")
        logger.info("Dry run or no duplicates; no deletions performed.")
        return

    for dup in duplicates:
        seq_id = dup["sequence"].get("id", dup["annotation"]["sequence_id"])
        try:
            annotation_api.delete_sequence(args.url_api_annotation, token, seq_id)
            logger.info(
                f"Deleted sequence {seq_id} | {format_seq_info(dup['sequence'])}"
            )
        except Exception:
            logger.exception(f"Failed to delete sequence {seq_id}")

    logger.info(f"Done. Deleted {len(duplicates)} sequences.")


if __name__ == "__main__":
    main()
