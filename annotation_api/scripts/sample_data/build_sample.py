"""
Build the anonymized sample dataset that `make seed-sample` loads.

Input: a dataset written by `make export-alerts`, a selection made by
`select_sample.py`, and read access to the annotation API the export came
from. Output: a directory in the export format (manifest.jsonl + images/)
plus `load_states.csv`, ready to be archived and attached to a release.

What is rewritten: organisation and camera names and ids, coordinates, alert,
sequence and detection ids, image paths. Timestamps, azimuths, boxes, labels
and temporal scores are kept. Annotator identities are never read.

What is added: the export only carries finished work, so it lacks what the
loader needs to rebuild an alert *before* it was annotated (engine
predictions, the import-time track, per-object sequence fields). Those are
read from the source API and stored under a `seed` key on each object and
frame, leaving the export fields untouched.

The organisation map is private input, never committed:

    {"<real organisation name>": {"name": "org-alpha",
                                  "source_api": "pyronear_french",
                                  "organisation_id": 1}, ...}

Mapping one organisation to a second source_api makes camera ids and
platform_alert_ids collide across sources on purpose (multi-source cases).

Example:
uv run python -m scripts.sample_data.build_sample \
  --export-dir outputs/alerts_export \
  --selection-dir outputs/sample_selection \
  --org-map outputs/sample_selection/org_map.PRIVATE.json \
  --output-dir outputs/sample-data-v1
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv

from app.clients.annotation_api import (
    get_auth_token,
    get_sequence,
    list_detections,
    list_sequence_annotations,
)
from scripts.data_transfer.ingestion.alert_api.shared import (
    get_annotation_credentials,
)

load_dotenv()

logger = logging.getLogger(__name__)

# Must match app.services.alert_identity.ALERT_ID_BASE.
ALERT_ID_BASE = 1_000_000_000
FIRST_ALERT_ID = 1001
# Fake coordinates: one point per site, spread from a base point per source.
BASE_COORDINATES = {
    "pyronear_french": (46.0, 2.0),
    "api_cenia": (-33.0, -71.0),
    "alert_wildfire": (38.0, -120.0),
}


def site_of(camera_name: str) -> str:
    """Cameras of one site differ only by their trailing pose number."""
    return re.sub(r"-\d+$", "", camera_name)


def pose_of(camera_name: str) -> str:
    match = re.search(r"-(\d+)$", camera_name)
    return match.group(1) if match else "01"


def object_index(alert_api_id: int, platform_alert_id: int) -> int:
    """0 for the primary lane, else the sibling index encoded in its id."""
    if alert_api_id == platform_alert_id:
        return 0
    return alert_api_id - ALERT_ID_BASE - platform_alert_id * 1000


def lane_alert_api_id(platform_alert_id: int, index: int) -> int:
    if index == 0:
        return platform_alert_id
    return ALERT_ID_BASE + platform_alert_id * 1000 + index


def fetch_lane_extras(api_url: str, token: str, sequence_id: int) -> Dict[str, Any]:
    """Everything the export leaves out for one lane, without identities."""
    sequence = get_sequence(api_url, token, sequence_id)
    detections = list_detections(api_url, token, sequence_id=sequence_id, size=100)
    if detections["total"] > len(detections["items"]):
        raise RuntimeError(f"sequence {sequence_id} has more than 100 detections")
    annotation = list_sequence_annotations(api_url, token, sequence_id=sequence_id)[
        "items"
    ][0]
    return {
        "sequence": {
            key: sequence[key]
            for key in (
                "alert_api_id",
                "recorded_at",
                "last_seen_at",
                "azimuth",
                "is_wildfire_alertapi",
                "temporal_model_score",
                "temporal_model_version",
                "temporal_api_version",
            )
        },
        "has_missed_smoke": bool(annotation["has_missed_smoke"]),
        "sequences_bbox": annotation["annotation"]["sequences_bbox"],
        "detections": {
            str(det["id"]): {
                key: det[key]
                for key in ("algo_predictions", "others_bboxes", "auto_predictions")
            }
            for det in detections["items"]
        },
    }


def load_extras(
    alerts: List[Dict[str, Any]], cache_path: Path, api_url: str
) -> Dict[str, Any]:
    """Per-lane extras keyed by source sequence id, cached on disk so a
    rebuild does not hit the source API again."""
    cache: Dict[str, Any] = (
        json.loads(cache_path.read_text()) if cache_path.exists() else {}
    )
    wanted = [str(obj["sequence_id"]) for a in alerts for obj in a["objects"]]
    missing = [sid for sid in wanted if sid not in cache]
    if missing:
        login, password = get_annotation_credentials(api_url)
        token = get_auth_token(api_url, login, password)
        for n, sid in enumerate(missing, start=1):
            cache[sid] = fetch_lane_extras(api_url, token, int(sid))
            if n % 25 == 0 or n == len(missing):
                logger.info("Fetched %d/%d lanes", n, len(missing))
                cache_path.write_text(json.dumps(cache))
    return cache


def assign_cameras(
    alerts: List[Dict[str, Any]], org_map: Dict[str, Dict[str, Any]]
) -> Dict[int, Dict[str, Any]]:
    """Fake camera record per real camera id; ids restart at 1 per source."""
    cameras: Dict[int, Dict[str, Any]] = {}
    sites: Dict[Tuple[str, str], Tuple[str, float, float]] = {}
    cameras_per_source: Dict[str, int] = {}
    sites_per_org: Dict[str, int] = {}
    sites_per_source: Dict[str, int] = {}
    for alert in sorted(
        alerts, key=lambda a: (a["organisation_name"], a["camera_name"])
    ):
        org = org_map[alert["organisation_name"]]
        source = org["source_api"]
        site_key = (alert["organisation_name"], site_of(alert["camera_name"]))
        if site_key not in sites:
            n = sites_per_org[site_key[0]] = sites_per_org.get(site_key[0], 0) + 1
            k = sites_per_source[source] = sites_per_source.get(source, 0) + 1
            lat0, lon0 = BASE_COORDINATES[source]
            sites[site_key] = (
                f"{org['name'].removeprefix('org-')}-site{n}",
                round(lat0 + 0.15 * k, 4),
                round(lon0 + 0.2 * (k % 4), 4),
            )
        if alert["camera_id"] not in cameras:
            camera_id = cameras_per_source[source] = (
                cameras_per_source.get(source, 0) + 1
            )
            site_name, lat, lon = sites[site_key]
            cameras[alert["camera_id"]] = {
                "camera_id": camera_id,
                "camera_name": f"{site_name}-{pose_of(alert['camera_name'])}",
                "lat": lat,
                "lon": lon,
            }
    return cameras


def remap_tracks(
    tracks: List[Dict[str, Any]], det_ids: Dict[int, int]
) -> List[Dict[str, Any]]:
    """Rewrite a sequences_bbox onto the sample's detection ids. A box whose
    detection is not part of the exported lane is dropped."""
    out = []
    for track in tracks:
        bboxes = [
            {"detection_id": det_ids[box["detection_id"]], "xyxyn": box["xyxyn"]}
            for box in track["bboxes"]
            if box["detection_id"] in det_ids
        ]
        out.append({**track, "bboxes": bboxes})
    return out


def build(
    export_dir: Path,
    selection_dir: Path,
    org_map: Dict[str, Dict[str, Any]],
    output_dir: Path,
    api_url: str,
) -> None:
    with (selection_dir / "selection.csv").open() as fh:
        selection = {int(row["platform_alert_id"]): row for row in csv.DictReader(fh)}

    alerts = [
        alert
        for alert in map(json.loads, (export_dir / "manifest.jsonl").open())
        if alert["platform_alert_id"] in selection
    ]
    absent = set(selection) - {a["platform_alert_id"] for a in alerts}
    if absent:
        sys.exit(f"Selected alerts absent from the export: {sorted(absent)}")
    unmapped = {a["organisation_name"] for a in alerts} - set(org_map)
    if unmapped:
        sys.exit(f"Organisations missing from the org map: {sorted(unmapped)}")
    alerts.sort(key=lambda a: (a["recorded_at"], a["platform_alert_id"]))

    extras = load_extras(alerts, selection_dir / "prod_extras.PRIVATE.json", api_url)
    cameras = assign_cameras(alerts, org_map)

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)

    alerts_per_source: Dict[str, int] = {}
    next_sequence = next_detection = 1
    mapping: Dict[str, Dict[str, str]] = {"cameras": {}, "alerts": {}}
    load_rows = []
    with (output_dir / "manifest.jsonl").open("w", encoding="utf-8") as manifest:
        for alert in alerts:
            real_alert_id = alert["platform_alert_id"]
            org = org_map[alert["organisation_name"]]
            source = org["source_api"]
            camera = cameras[alert["camera_id"]]
            mapping["cameras"][alert["camera_name"]] = camera["camera_name"]
            n = alerts_per_source[source] = alerts_per_source.get(source, 0) + 1
            alert_id = FIRST_ALERT_ID + n - 1
            mapping["alerts"][str(real_alert_id)] = f"{source}/{alert_id}"

            for obj in alert["objects"]:
                extra = extras[str(obj["sequence_id"])]
                det_ids: Dict[int, int] = {}
                for frame in obj["frames"]:
                    real_det_id = frame["detection_id"]
                    det_ids[real_det_id] = next_detection
                    rel = f"images/{source}/{alert_id}/{next_detection}.jpg"
                    (output_dir / rel).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(export_dir / frame["image_path"], output_dir / rel)
                    frame.update(
                        detection_id=next_detection,
                        bucket_key=None,
                        image_path=rel,
                        seed={
                            "alert_api_id": next_detection,
                            **extra["detections"][str(real_det_id)],
                        },
                    )
                    next_detection += 1

                index = object_index(extra["sequence"]["alert_api_id"], real_alert_id)
                obj["sequence_id"] = next_sequence
                obj["seed"] = {
                    **extra["sequence"],
                    "alert_api_id": lane_alert_api_id(alert_id, index),
                    "has_missed_smoke": extra["has_missed_smoke"],
                    "sequences_bbox": remap_tracks(extra["sequences_bbox"], det_ids),
                }
                next_sequence += 1

            alert.update(
                source_api=source,
                platform_alert_id=alert_id,
                organisation_name=org["name"],
                organisation_id=org["organisation_id"],
                **camera,
            )
            manifest.write(json.dumps(alert) + "\n")
            row = selection[real_alert_id]
            load_rows.append(
                [
                    source,
                    alert_id,
                    row["load_state"],
                    org["name"],
                    camera["camera_name"],
                    row["category"],
                    row["smoke_types"],
                    row["false_positive_types"],
                    row["n_objects"],
                    row["n_frames"],
                    row["night"],
                ]
            )

    with (output_dir / "load_states.csv").open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
                "source_api",
                "platform_alert_id",
                "load_state",
                "organisation_name",
                "camera_name",
                "category",
                "smoke_types",
                "false_positive_types",
                "n_objects",
                "n_frames",
                "night",
            ]
        )
        writer.writerows(load_rows)

    (selection_dir / "anonymization_map.PRIVATE.json").write_text(
        json.dumps(mapping, indent=2)
    )
    logger.info(
        "Wrote %d alerts, %d objects, %d images to %s",
        len(alerts),
        next_sequence - 1,
        next_detection - 1,
        output_dir,
    )


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--export-dir", type=Path, required=True)
    parser.add_argument("--selection-dir", type=Path, required=True)
    parser.add_argument("--org-map", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--annotation-api-url",
        default="https://annotationapi.pyronear.org",
        help="Annotation API the export came from (read-only)",
    )
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s - %(message)s")
    build(
        args.export_dir,
        args.selection_dir,
        json.loads(args.org_map.read_text()),
        args.output_dir,
        args.annotation_api_url,
    )


if __name__ == "__main__":
    main()
