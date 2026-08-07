"""
Pull annotated alerts from the annotation API's GET /api/v1/export/alerts
endpoint (see docs/specs/2026-08-07-export-alerts-pull-script-design.md) and
materialize them as a self-contained ML dataset:

    OUTPUT_DIR/
    ├── manifest.jsonl                 # one line per alert
    └── images/{source_api}/{platform_alert_id}/{detection_id}.jpg

Idempotent full pull: every run re-walks the export and rewrites the
manifest; only images missing on disk are downloaded.

Example:
uv run python -m scripts.data_transfer.export.export_alerts \
  --annotation-api-url http://localhost:5050 \
  --output-dir outputs/alerts_export --loglevel info
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import requests
from dotenv import load_dotenv

from app.clients.annotation_api import get_auth_token
from scripts.data_transfer.ingestion.alert_api.shared import (
    get_annotation_credentials,
)

load_dotenv()

logger = logging.getLogger(__name__)

DOWNLOAD_ATTEMPTS = 3
DOWNLOAD_TIMEOUT_S = 30
PAGE_TIMEOUT_S = 120


def frame_rel_path(source_api: str, platform_alert_id: int, detection_id: int) -> str:
    """Dataset-relative image path for one frame of an alert."""
    return f"images/{source_api}/{platform_alert_id}/{detection_id}.jpg"


def plan_downloads(item: Dict[str, Any]) -> Dict[int, Tuple[Optional[str], str]]:
    """Map detection_id -> (image_url, rel_path) for every frame of an alert.

    Objects (lanes) of one alert share frames, so entries are deduped by
    detection_id; a copy of the frame that carries a URL wins over one
    without.
    """
    plan: Dict[int, Tuple[Optional[str], str]] = {}
    for obj in item["objects"]:
        for frame in obj["frames"]:
            det_id = frame["detection_id"]
            url = frame.get("image_url")
            if det_id not in plan or (url and not plan[det_id][0]):
                plan[det_id] = (
                    url,
                    frame_rel_path(
                        item["source_api"], item["platform_alert_id"], det_id
                    ),
                )
    return plan


def to_manifest_item(item: Dict[str, Any], materialized: Set[int]) -> Dict[str, Any]:
    """Copy of the API item with each frame's image_url swapped for image_path.

    image_path is set when the image file exists on disk (detection_id in
    `materialized`), else None so a re-run can heal it.
    """
    out = json.loads(json.dumps(item))  # deep copy; payload is JSON-only data
    for obj in out["objects"]:
        for frame in obj["frames"]:
            det_id = frame["detection_id"]
            frame.pop("image_url", None)
            frame["image_path"] = (
                frame_rel_path(out["source_api"], out["platform_alert_id"], det_id)
                if det_id in materialized
                else None
            )
    return out


@dataclass
class ExportStats:
    alerts: int = 0
    downloaded: int = 0
    skipped: int = 0
    failed: int = 0
    missing_url: int = 0


FetchPage = Callable[[Optional[str]], Dict[str, Any]]
Download = Callable[[str, Path], None]


def _download_pending(
    pending: List[Tuple[int, str, Path]],
    download: Download,
    max_workers: int,
    stats: ExportStats,
) -> None:
    """Download (detection_id, url, dest) triples concurrently, tallying stats.

    Workers return a success flag and the tally happens on the main thread —
    `stats.x += 1` from worker threads would race.
    """

    def fetch_one(entry: Tuple[int, str, Path]) -> bool:
        det_id, url, dest = entry
        try:
            download(url, dest)
            return True
        except Exception:
            logger.warning("Download failed for detection %s", det_id, exc_info=True)
            return False

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = list(pool.map(fetch_one, pending))
    stats.downloaded += sum(results)
    stats.failed += len(results) - sum(results)


def run_export(
    fetch_page: FetchPage,
    download: Download,
    output_dir: Path,
    max_workers: int,
) -> ExportStats:
    """Walk the export cursor, download missing images, rewrite the manifest.

    The manifest is written to a .tmp sibling and renamed only after the walk
    completes, so an interrupted run never replaces a good manifest.
    """
    stats = ExportStats()
    output_dir.mkdir(parents=True, exist_ok=True)
    tmp_manifest = output_dir / "manifest.jsonl.tmp"

    with tmp_manifest.open("w", encoding="utf-8") as manifest:
        cursor: Optional[str] = None
        while True:
            page = fetch_page(cursor)
            plans = [(item, plan_downloads(item)) for item in page["items"]]

            pending: List[Tuple[int, str, Path]] = []
            for _, plan in plans:
                for det_id, (url, rel) in plan.items():
                    dest = output_dir / rel
                    if dest.exists():
                        stats.skipped += 1
                    elif url is None:
                        stats.missing_url += 1
                        logger.warning("No image_url for detection %s", det_id)
                    else:
                        pending.append((det_id, url, dest))
            _download_pending(pending, download, max_workers, stats)

            for item, plan in plans:
                materialized = {
                    det_id
                    for det_id, (_, rel) in plan.items()
                    if (output_dir / rel).exists()
                }
                manifest.write(json.dumps(to_manifest_item(item, materialized)) + "\n")
                stats.alerts += 1

            cursor = page.get("next_cursor")
            if cursor is None:
                break

    tmp_manifest.replace(output_dir / "manifest.jsonl")
    return stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export annotated alerts (manifest + images) from the "
        "annotation API"
    )
    parser.add_argument(
        "--annotation-api-url",
        default="http://localhost:5050",
        help="Base URL of the annotation API",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("outputs/alerts_export"),
        help="Dataset directory to write manifest.jsonl and images/ into",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=100,
        help="Alerts per page (max 500); one page's downloads bound how old "
        "a presigned image URL can get before use",
    )
    parser.add_argument(
        "--max-workers", type=int, default=4, help="Concurrent image downloads"
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )
    return parser.parse_args()


def _fetch_page_impl(
    session: requests.Session, api_url: str, page_size: int
) -> FetchPage:
    def fetch_page(cursor: Optional[str]) -> Dict[str, Any]:
        params: Dict[str, Any] = {"limit": page_size}
        if cursor is not None:
            params["cursor"] = cursor
        response = session.get(
            f"{api_url}/api/v1/export/alerts", params=params, timeout=PAGE_TIMEOUT_S
        )
        response.raise_for_status()
        return response.json()

    return fetch_page


def _download_impl(url: str, dest: Path) -> None:
    # Plain requests.get: presigned S3 URLs reject an extra Authorization
    # header, so the authenticated session must not be used here.
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(DOWNLOAD_ATTEMPTS):
        try:
            response = requests.get(url, timeout=DOWNLOAD_TIMEOUT_S)
            response.raise_for_status()
            part = dest.with_suffix(dest.suffix + ".part")
            part.write_bytes(response.content)
            part.replace(dest)
            return
        except requests.RequestException:
            if attempt == DOWNLOAD_ATTEMPTS - 1:
                raise
            time.sleep(2**attempt)


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=args.loglevel.upper(),
        format="%(asctime)s - %(levelname)s - %(message)s",
    )

    login, password = get_annotation_credentials(args.annotation_api_url)
    token = get_auth_token(args.annotation_api_url, login, password)
    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {token}"

    stats = run_export(
        _fetch_page_impl(session, args.annotation_api_url, args.page_size),
        _download_impl,
        args.output_dir,
        args.max_workers,
    )
    logger.info(
        "Exported %d alerts: %d images downloaded, %d already present, "
        "%d failed, %d without URL",
        stats.alerts,
        stats.downloaded,
        stats.skipped,
        stats.failed,
        stats.missing_url,
    )
    if stats.failed:
        logger.error(
            "%d image downloads failed (image_path null in manifest); "
            "re-run to heal",
            stats.failed,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
