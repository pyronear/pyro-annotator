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

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


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
