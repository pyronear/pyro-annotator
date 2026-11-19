"""
Load the sample dataset into a local annotation API (`make seed-sample`).

The dataset is a GitHub release asset in the `make export-alerts` format
(manifest.jsonl + images/) with a `seed` block on each object and frame, and
a `load_states.csv` giving the state each alert is loaded in:

    to_classify   lanes left at ready_to_annotate
    to_localize   lanes classified; the ones needing boxes wait in Localize
    done          lanes classified and localized, every lane annotated

Everything is written through the API the script runs next to, replaying the
real workflow (import, classify-submit, localize-submit), so validation and
S3 uploads follow the production code paths. Nothing is written to Postgres
or S3 directly.

Idempotent: the archive is not downloaded again when it is already on disk
with the pinned checksum, and an alert that is already loaded is left alone,
whatever stage it has since been annotated to. An alert loaded only in part
(an interrupted run) is removed and loaded again.

Run inside the annotation_api container:
    python -m app.cli.seed_sample
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import os
import sys
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

logger = logging.getLogger("seed_sample")

# Pinned release. Publishing a new dataset means bumping all three together
# (see annotation_api/docs/sample-data.md).
SAMPLE_VERSION = "v1"
SAMPLE_URL = (
    "https://github.com/pyronear/pyro-annotator/releases/download/"
    f"sample-data-{SAMPLE_VERSION}/sample-data-{SAMPLE_VERSION}.tar.gz"
)
SAMPLE_SHA256 = "02bd6e2cc21c8750dcfa573881be608efd6ebd2c110e56a5e82cb1383613467b"

LOAD_STATES = ("to_classify", "to_localize", "done")
SKIP_STATE = "skip"
WILDFIRE = "wildfire"
REQUEST_TIMEOUT_S = 120
DOWNLOAD_CHUNK = 1024 * 1024

AlertKey = Tuple[str, int]


class SeedError(RuntimeError):
    """A failure the user can act on; reported without a traceback."""


# --------------------------------------------------------------------------
# Dataset on disk
# --------------------------------------------------------------------------


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(DOWNLOAD_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path) -> None:
    logger.info("Downloading %s", url)
    part = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=REQUEST_TIMEOUT_S) as response:
        if response.status_code == 404:
            raise SeedError(
                f"Sample archive not found at {url}. Is the release published?"
            )
        response.raise_for_status()
        with part.open("wb") as fh:
            for chunk in response.iter_content(DOWNLOAD_CHUNK):
                fh.write(chunk)
    part.replace(dest)


def ensure_dataset(
    data_dir: Path,
    version: str = SAMPLE_VERSION,
    url: str = SAMPLE_URL,
    sha256: str = SAMPLE_SHA256,
) -> Path:
    """Return the extracted dataset directory, downloading only when needed.

    A marker file records the checksum the extracted tree came from, so a
    second run does no network or disk work, and a bumped pin re-fetches.
    """
    dataset_dir = data_dir / f"sample-data-{version}"
    marker = data_dir / f".sample-data-{version}.sha256"
    archive = data_dir / f"sample-data-{version}.tar.gz"

    if not sha256:
        raise SeedError(
            "No sample dataset is published yet (SAMPLE_SHA256 is empty). "
            "Pass --dataset-dir to load a local dataset directory."
        )
    if (
        marker.exists()
        and marker.read_text().strip() == sha256
        and (dataset_dir / "manifest.jsonl").exists()
    ):
        logger.info("Sample dataset already present in %s", dataset_dir)
        return dataset_dir

    data_dir.mkdir(parents=True, exist_ok=True)
    if not (archive.exists() and sha256_of(archive) == sha256):
        download(url, archive)
        actual = sha256_of(archive)
        if actual != sha256:
            archive.unlink()
            raise SeedError(
                f"Checksum mismatch for {url}: expected {sha256}, got {actual}"
            )

    logger.info("Extracting %s", archive.name)
    with tarfile.open(archive) as tar:
        # "data" rejects absolute paths, links and anything outside data_dir.
        tar.extractall(data_dir, filter="data")
    if not (dataset_dir / "manifest.jsonl").exists():
        raise SeedError(f"{archive.name} does not contain {dataset_dir.name}/")
    marker.write_text(sha256 + "\n")
    return dataset_dir


def read_manifest(dataset_dir: Path) -> List[Dict[str, Any]]:
    with (dataset_dir / "manifest.jsonl").open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def read_load_states(path: Path) -> Dict[AlertKey, str]:
    states: Dict[AlertKey, str] = {}
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            state = row["load_state"].strip()
            if state not in (*LOAD_STATES, SKIP_STATE):
                raise SeedError(
                    f"{path}: unknown load_state {state!r} for alert "
                    f"{row['source_api']}/{row['platform_alert_id']} "
                    f"(expected one of {', '.join((*LOAD_STATES, SKIP_STATE))})"
                )
            states[(row["source_api"], int(row["platform_alert_id"]))] = state
    return states


# --------------------------------------------------------------------------
# Payloads (pure)
# --------------------------------------------------------------------------


def lane_needs_localization(obj: Dict[str, Any]) -> bool:
    """Client-side copy of app.services.localization_rule.needs_localization
    for a lane that is not unsure: wildfire smoke or missed smoke is boxed."""
    tracks = obj["seed"]["sequences_bbox"]
    has_wildfire = any(
        track["is_smoke"] and track.get("smoke_type") == WILDFIRE for track in tracks
    )
    return has_wildfire or bool(obj["seed"]["has_missed_smoke"])


def remap_tracks(
    tracks: Iterable[Dict[str, Any]], detection_ids: Dict[int, int]
) -> List[Dict[str, Any]]:
    return [
        {
            **track,
            "bboxes": [
                {"detection_id": detection_ids[b["detection_id"]], "xyxyn": b["xyxyn"]}
                for b in track["bboxes"]
            ],
        }
        for track in tracks
    ]


def import_annotation(
    obj: Dict[str, Any], detection_ids: Dict[int, int]
) -> Dict[str, Any]:
    """The annotation as the importer writes it: the lane's tracks, each a
    conservative unlabeled smoke candidate awaiting a human."""
    return {
        "sequences_bbox": [
            {**track, "is_smoke": True, "smoke_type": None, "false_positive_types": []}
            for track in remap_tracks(obj["seed"]["sequences_bbox"], detection_ids)
        ]
    }


def classify_item(
    annotation_id: int, obj: Dict[str, Any], detection_ids: Dict[int, int]
) -> Dict[str, Any]:
    """One lane's decision for classify-submit, with its two-lane exit."""
    return {
        "annotation_id": annotation_id,
        "annotation": {
            "sequences_bbox": remap_tracks(obj["seed"]["sequences_bbox"], detection_ids)
        },
        "has_missed_smoke": bool(obj["seed"]["has_missed_smoke"]),
        "is_unsure": False,
        "processing_stage": (
            "seq_annotation_done" if lane_needs_localization(obj) else "annotated"
        ),
    }


def detection_annotation_items(
    obj: Dict[str, Any], detection_ids: Dict[int, int]
) -> List[Dict[str, Any]]:
    """Every frame of a localized lane, including the frames left without a
    box: a lane only reaches annotated once all its frames are reviewed."""
    items = []
    for frame in obj["frames"]:
        boxes = []
        for box in frame["boxes"]:
            item = {
                "xyxyn": box["xyxyn"],
                "class_name": "smoke",
                "origin": box["origin"],
            }
            if box.get("smoke_type"):
                item["smoke_type"] = box["smoke_type"]
            else:
                item["false_positive_type"] = box["false_positive_types"][0]
            boxes.append(item)
        items.append(
            {
                "detection_id": detection_ids[frame["detection_id"]],
                "annotation": {"annotation": boxes},
                "processing_stage": "annotated",
            }
        )
    return items


def effective_state(alert: Dict[str, Any], state: str) -> str:
    """An alert with no lane to localize cannot wait in Localize: classifying
    it finishes it."""
    if state == "to_localize" and not any(
        lane_needs_localization(obj) for obj in alert["objects"]
    ):
        return "done"
    return state


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------


class Api:
    def __init__(self, base_url: str, username: str, password: str) -> None:
        self.base = f"{base_url.rstrip('/')}/api/v1"
        self.session = requests.Session()
        try:
            response = self.session.post(
                f"{self.base}/auth/login",
                json={"username": username, "password": password},
                timeout=REQUEST_TIMEOUT_S,
            )
        except requests.ConnectionError as exc:
            raise SeedError(f"Cannot reach the annotation API at {base_url}") from exc
        if response.status_code != 200:
            raise SeedError(
                f"Login to {base_url} failed ({response.status_code}). "
                "Check AUTH_USERNAME / AUTH_PASSWORD."
            )
        self.session.headers["Authorization"] = (
            f"Bearer {response.json()['access_token']}"
        )

    def call(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        response = self.session.request(
            method, f"{self.base}{path}", timeout=REQUEST_TIMEOUT_S, **kwargs
        )
        if response.status_code >= 400 and response.status_code != 404:
            raise RuntimeError(
                f"{method} {path} -> {response.status_code}: {response.text[:500]}"
            )
        return response

    def alert_lanes(self, key: AlertKey) -> List[Dict[str, Any]]:
        response = self.call(
            "GET",
            "/sequences/alert",
            params={"source_api": key[0], "platform_alert_id": key[1]},
        )
        return [] if response.status_code == 404 else response.json()["lanes"]


def create_lane(
    api: Api, alert: Dict[str, Any], obj: Dict[str, Any], dataset_dir: Path
) -> Tuple[int, int, Dict[int, int]]:
    """Import one object: its sequence, its frames and its import-time
    annotation. Returns the sequence id, the annotation id and the
    manifest->API detection ids."""
    seed = obj["seed"]
    form = {
        "source_api": alert["source_api"],
        "alert_api_id": seed["alert_api_id"],
        "platform_alert_id": alert["platform_alert_id"],
        "camera_name": alert["camera_name"],
        "camera_id": alert["camera_id"],
        "organisation_name": alert["organisation_name"],
        "organisation_id": alert["organisation_id"],
        "lat": alert["lat"],
        "lon": alert["lon"],
        "azimuth": seed["azimuth"],
        "recorded_at": seed["recorded_at"],
        "last_seen_at": seed["last_seen_at"],
        "is_wildfire_alertapi": seed["is_wildfire_alertapi"],
        "temporal_model_score": seed["temporal_model_score"],
        "temporal_model_version": seed["temporal_model_version"],
        "temporal_api_version": seed["temporal_api_version"],
    }
    sequence_id = api.call(
        "POST", "/sequences/", data={k: v for k, v in form.items() if v is not None}
    ).json()["id"]

    detection_ids: Dict[int, int] = {}
    for frame in obj["frames"]:
        frame_seed = frame["seed"]
        data = {
            "sequence_id": sequence_id,
            "alert_api_id": frame_seed["alert_api_id"],
            "recorded_at": frame["recorded_at"],
            "algo_predictions": json.dumps(frame_seed["algo_predictions"]),
        }
        for optional in ("others_bboxes", "auto_predictions"):
            if frame_seed.get(optional) is not None:
                data[optional] = json.dumps(frame_seed[optional])
        image = dataset_dir / frame["image_path"]
        with image.open("rb") as fh:
            detection = api.call(
                "POST",
                "/detections/",
                data=data,
                files={"file": (image.name, fh, "image/jpeg")},
            ).json()
        detection_ids[frame["detection_id"]] = detection["id"]

    annotation_id = api.call(
        "POST",
        "/annotations/sequences/",
        json={
            "sequence_id": sequence_id,
            "annotation": import_annotation(obj, detection_ids),
            "processing_stage": "ready_to_annotate",
            "has_missed_smoke": False,
            "has_smoke": False,
            "has_false_positives": False,
            "false_positive_types": [],
            "smoke_types": [],
            "is_unsure": False,
        },
    ).json()["id"]
    return sequence_id, annotation_id, detection_ids


def delete_alert(api: Api, lanes: List[Dict[str, Any]]) -> None:
    for lane in lanes:
        api.call("DELETE", f"/sequences/{lane['sequence']['id']}?force=true")


def load_alert(api: Api, alert: Dict[str, Any], state: str, dataset_dir: Path) -> str:
    """Load one alert in `state`. Returns 'loaded' or 'skipped'."""
    key: AlertKey = (alert["source_api"], alert["platform_alert_id"])
    existing = api.alert_lanes(key)
    if existing:
        complete = len(existing) == len(alert["objects"]) and all(
            lane["annotation"] is not None for lane in existing
        )
        if complete:
            return "skipped"
        logger.info("Alert %s/%s is partially loaded, reloading it", *key)
        delete_alert(api, existing)

    try:
        lanes = [
            (obj, *create_lane(api, alert, obj, dataset_dir))
            for obj in alert["objects"]
        ]
        state = effective_state(alert, state)
        if state == "to_classify":
            return "loaded"

        api.call(
            "POST",
            "/annotations/sequences/classify-submit",
            json={
                "items": [
                    classify_item(annotation_id, obj, detection_ids)
                    for obj, _sequence_id, annotation_id, detection_ids in lanes
                ]
            },
        )
        if state == "to_localize":
            return "loaded"

        localized = [lane for lane in lanes if lane_needs_localization(lane[0])]
        for obj, sequence_id, _annotation_id, detection_ids in localized:
            api.call(
                "POST",
                "/annotations/detections/bulk",
                json={
                    "sequence_id": sequence_id,
                    "items": detection_annotation_items(obj, detection_ids),
                },
            )
        if localized:
            api.call(
                "POST",
                "/annotations/sequences/localize-submit",
                json={"annotation_ids": [lane[2] for lane in localized]},
            )
        return "loaded"
    except Exception:
        # Never leave a half-built alert behind: the next run would have to
        # guess what state it is in.
        delete_alert(api, api.alert_lanes(key))
        raise


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load the sample dataset into a local annotation API"
    )
    parser.add_argument(
        "--api-url",
        default="http://localhost:5050",
        help="Annotation API to load into",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("/sample-data"),
        help="Where the archive is downloaded and extracted",
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=None,
        help="Load this local dataset directory instead of the pinned release",
    )
    parser.add_argument(
        "--load-states",
        type=Path,
        default=None,
        help="Alternative load_states.csv (default: the one in the dataset)",
    )
    parser.add_argument("--max-workers", type=int, default=4)
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> int:
    dataset_dir = args.dataset_dir or ensure_dataset(args.data_dir)
    if not (dataset_dir / "manifest.jsonl").exists():
        raise SeedError(f"No manifest.jsonl in {dataset_dir}")
    alerts = read_manifest(dataset_dir)
    states = read_load_states(args.load_states or dataset_dir / "load_states.csv")

    api = Api(
        args.api_url,
        os.environ.get("AUTH_USERNAME", "admin"),
        os.environ.get("AUTH_PASSWORD", "admin12345"),
    )

    todo = []
    for alert in alerts:
        state = states.get((alert["source_api"], alert["platform_alert_id"]))
        if state is None:
            raise SeedError(
                f"Alert {alert['source_api']}/{alert['platform_alert_id']} "
                "has no row in load_states.csv"
            )
        if state != SKIP_STATE:
            todo.append((alert, state))

    counts = {"loaded": 0, "skipped": 0, "failed": 0}
    loaded_states = {state: 0 for state in LOAD_STATES}

    def work(item: Tuple[Dict[str, Any], str]) -> Tuple[str, str]:
        alert, state = item
        try:
            return load_alert(api, alert, state, dataset_dir), effective_state(
                alert, state
            )
        except Exception as exc:  # noqa: BLE001 - one alert must not stop the run
            logger.error(
                "Alert %s/%s failed: %s",
                alert["source_api"],
                alert["platform_alert_id"],
                exc,
            )
            return "failed", state

    with ThreadPoolExecutor(max_workers=args.max_workers) as pool:
        for n, (outcome, state) in enumerate(pool.map(work, todo), start=1):
            counts[outcome] += 1
            if outcome == "loaded":
                loaded_states[state] += 1
            if n % 20 == 0 or n == len(todo):
                logger.info("%d/%d alerts processed", n, len(todo))

    logger.info(
        "Loaded %d alerts (%d to classify, %d to localize, %d done), "
        "%d already present, %d failed",
        counts["loaded"],
        loaded_states["to_classify"],
        loaded_states["to_localize"],
        loaded_states["done"],
        counts["skipped"],
        counts["failed"],
    )
    if loaded_states["to_localize"]:
        logger.info(
            "Alerts to localize appear in the Localize queue once the worker "
            "has auto-annotated them (a few minutes)."
        )
    return 1 if counts["failed"] else 0


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s - %(message)s")
    try:
        sys.exit(run(parse_args()))
    except SeedError as exc:
        logger.error("%s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
