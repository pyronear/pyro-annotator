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
from typing import Any, Dict, Optional, Set, Tuple


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
