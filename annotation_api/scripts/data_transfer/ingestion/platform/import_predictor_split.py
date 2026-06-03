"""
Orchestrator: import platform sequences as predictor-derived, object-split
annotation sequences.

The date range is walked ONE CALENDAR DAY AT A TIME (inclusive of both
--date-from and --date-end): day 1 is fetched, predicted and pushed in full
before day 2 starts. Before any work, the set of platform sequences already in
the dataset is loaded (by reversing the synthetic alert_api_id scheme) so
already-imported sequences are skipped rather than re-fetched/re-pushed.

Pipeline (per day):
  1. Fetch: shell out to pyro-dataset's `fetch_all_platform_sequences.py` with
     `--detections-limit 30` into a temp dir (single pass — images + sequences.csv).
  2. Predict: shell out to `predictor_runner.py` via pyro-engine's venv to get the
     predictor's per-frame *smoothed* boxes for every fetched image
     (`predictor_boxes.jsonl`).
  3. Split: for each kept platform sequence, replay pyro-api's detection->sequence
     association rule (`object_clustering.cluster_objects`) over the predictor boxes,
     carving the sequence into one *object* per detected smoke plume.
  4. Post: for each object, create ONE annotation-API Sequence (synthetic
     `alert_api_id = alert_id_base + platform_id*1000 + object_index`, per-object
     cone azimuth), POST one Detection per (frame, box) carrying the predictor box as
     `algo_predictions` and the OTHER objects' boxes on the same frame as
     `others_bboxes` (read-only context for judging missed smoke), then write the
     sequence annotation as a SINGLE bbox track (= this object). We do NOT use
     the server's IoU auto-generation, which would re-fragment one
     drifting/tiny-box object into several tracks.
  5. Assign groups, then clean up the temp dir.

Unlike `import_filtered.py`, detections carry OUR predictor's boxes (not the
platform's tracked bbox), and one platform sequence may yield several annotation
sequences. `is_wildfire` / `camera_azimuth` are re-fetched from the platform API
because pyro-dataset's CSV does not carry a usable value for them.

Sister-repo paths come from `PYRO_DATASET_DIR` / `PYRO_ENGINE_DIR`.

Usage:
  uv run python -m scripts.data_transfer.ingestion.platform.import_predictor_split \\
    --date-from 2025-03-04 --url-api-annotation http://localhost:5050 --max-sequences 2

Or via the Makefile:
  make import-platform-predictor-split DATE_FROM=2025-03-04 MAX_SEQUENCES=2
"""

import argparse
import csv
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from dotenv import load_dotenv
from tqdm import tqdm

from . import client as platform_client
from . import shared
from .object_clustering import cluster_objects, object_cone_azimuth
from app.clients.annotation_api import (
    AnnotationAPIError,
    create_detection,
    create_sequence,
    create_sequence_annotation,
    delete_sequence,
    get_auth_token,
    list_sequences,
)

load_dotenv()

DEFAULT_ALERT_ID_BASE = 1_000_000_000
SOURCE_API = "pyronear_french"


def _path_from_env(env_name: str) -> Optional[Path]:
    value = os.getenv(env_name)
    return Path(value).expanduser() if value else None


def valid_date(s: str) -> str:
    """Argparse type: validate YYYY-MM-DD, return the original string."""
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"not a valid date: {s!r} (expected YYYY-MM-DD)"
        ) from exc
    return s


def make_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--date-from",
        type=valid_date,
        required=True,
        help="Start date (YYYY-MM-DD, inclusive).",
    )
    parser.add_argument(
        "--date-end",
        type=valid_date,
        default=None,
        help="End date (YYYY-MM-DD, INCLUSIVE; looped day by day). Defaults to today.",
    )
    parser.add_argument(
        "--max-sequences",
        type=int,
        default=0,
        help="Cap on NEW platform sequences imported across the whole run (0 = no cap).",
    )
    parser.add_argument(
        "--detections-limit",
        type=int,
        default=30,
        help="Images per sequence fetched & predicted (default: 30).",
    )

    # Predictor
    parser.add_argument(
        "--predictor-n-consecutive",
        type=int,
        default=6,
        help="Sliding-window size for the predictor (default: 6).",
    )
    parser.add_argument(
        "--predictor-conf-threshold",
        type=float,
        default=0.1,
        help="Predictor confidence threshold for kept/dropped (default: 0.1).",
    )

    # Object clustering (pyro-api thresholds)
    parser.add_argument(
        "--min-dets",
        type=int,
        default=3,
        help="Min overlapping detections to spawn an object (default: 3).",
    )
    parser.add_argument(
        "--min-interval-seconds",
        type=int,
        default=300,
        help="Spawn-pool time window in seconds (default: 300).",
    )
    parser.add_argument(
        "--relaxation-seconds",
        type=int,
        default=7200,
        help="Open-object match window in seconds (default: 7200).",
    )

    # Synthetic id namespace
    parser.add_argument(
        "--alert-id-base",
        type=int,
        default=DEFAULT_ALERT_ID_BASE,
        help=(
            "Base offset for synthetic sequence alert_api_ids "
            "(default: 1e9), kept disjoint from real platform ids."
        ),
    )

    # URLs
    parser.add_argument(
        "--url-api-annotation",
        type=str,
        default="http://localhost:5050",
        help="Annotation API URL.",
    )
    parser.add_argument(
        "--url-api-platform",
        type=str,
        default="https://alertapi.pyronear.org",
        help="Platform API URL.",
    )

    # Sister repos
    parser.add_argument(
        "--pyro-dataset-dir",
        type=Path,
        default=_path_from_env("PYRO_DATASET_DIR"),
        help="Path to the pyro-dataset repo (or set PYRO_DATASET_DIR).",
    )
    parser.add_argument(
        "--pyro-engine-dir",
        type=Path,
        default=_path_from_env("PYRO_ENGINE_DIR"),
        help="Path to the pyro-engine repo (or set PYRO_ENGINE_DIR).",
    )

    parser.add_argument(
        "--reset",
        action="store_true",
        help=(
            "Delete previously-imported synthetic sequences "
            "(source_api=pyronear_french, alert_api_id >= --alert-id-base) "
            "before importing, for a clean idempotent re-run."
        ),
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Do not delete the temp directory on success (debugging).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do everything except POST/DELETE to the annotation API.",
    )
    parser.add_argument(
        "--skip-group-assignment",
        action="store_true",
        help="Skip the final POST /sequence_groups/assign step.",
    )
    parser.add_argument(
        "--loglevel", default="info", help="Logging level (default: info)."
    )
    return parser


# --------------------------------------------------------------------------- #
# Setup helpers
# --------------------------------------------------------------------------- #
def _validate_paths(args: argparse.Namespace) -> None:
    if args.pyro_dataset_dir is None:
        raise SystemExit(
            "PYRO_DATASET_DIR is not set and --pyro-dataset-dir was not provided"
        )
    if args.pyro_engine_dir is None:
        raise SystemExit(
            "PYRO_ENGINE_DIR is not set and --pyro-engine-dir was not provided"
        )
    fetch_script = (
        args.pyro_dataset_dir
        / "scripts/platform_train_loop/fetch_all_platform_sequences.py"
    )
    runner = Path(__file__).resolve().parent / "predictor_runner.py"
    required = [
        fetch_script,
        args.pyro_dataset_dir / ".venv/bin/python",
        args.pyro_engine_dir / ".venv/bin/python",
        args.pyro_engine_dir / "pyro-predictor",
        args.pyro_engine_dir / "pyro-predictor/data",
        runner,
    ]
    for path in required:
        if not path.exists():
            raise SystemExit(f"Expected path does not exist: {path}")


def _run(
    cmd: list, label: str, cwd: Optional[Path] = None, env: Optional[dict] = None
) -> None:
    logging.info(f"[{label}] {' '.join(str(c) for c in cmd)}")
    try:
        subprocess.run(cmd, cwd=cwd, env=env, check=True)
    except OSError as exc:
        raise RuntimeError(f"[{label}] failed to start (cwd={cwd}): {cmd}") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"[{label}] exited with code {exc.returncode} (cwd={cwd}): {cmd}"
        ) from exc


def _iter_days(args: argparse.Namespace) -> List[date]:
    """Return every day to process, INCLUSIVE of --date-from and --date-end.

    The orchestrator processes one day at a time (fetch -> predict -> push), so
    a "from xx to yy" request walks each calendar day in [xx, yy]. --date-end
    defaults to today. Rejects end-before-start.
    """
    start = datetime.strptime(args.date_from, "%Y-%m-%d").date()
    end = (
        datetime.strptime(args.date_end, "%Y-%m-%d").date()
        if args.date_end
        else datetime.now().date()
    )
    if end < start:
        raise SystemExit(f"--date-end ({end}) is before --date-from ({start})")
    days: List[date] = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


# --------------------------------------------------------------------------- #
# Pipeline steps
# --------------------------------------------------------------------------- #
def step_fetch(
    args: argparse.Namespace, temp_dir: Path, date_from: str, date_end: str
) -> None:
    """Step 1: download `--detections-limit` images per sequence + sequences.csv.

    `date_end` is exclusive (the fetch script's convention); callers pass a
    single-day window (`date_from`, `date_from + 1 day`).
    """
    script = (
        args.pyro_dataset_dir
        / "scripts/platform_train_loop/fetch_all_platform_sequences.py"
    )
    python = args.pyro_dataset_dir / ".venv/bin/python"
    env = {**os.environ, "PLATFORM_API_ENDPOINT": args.url_api_platform}
    # Disable the fetch script's LOCAL wildfire/fp registry dedup by pointing it
    # at non-existent files: that dedup targets the pyro-dataset training set,
    # not the annotation API. This importer dedups against the annotation API
    # itself (see load_imported_object_keys), so the fetcher must not silently
    # drop sequences that merely happen to be in a local registry.
    no_registry = temp_dir / "__no_registry__.json"
    cmd = [
        str(python),
        str(script),
        "--date-from",
        date_from,
        "--date-end",
        date_end,
        "--save-dir",
        str(temp_dir),
        "--detections-limit",
        str(args.detections_limit),
        "--wildfire-registry",
        str(no_registry),
        "--fp-registry",
        str(no_registry),
        "--loglevel",
        args.loglevel,
    ]
    _run(cmd, label="fetch", cwd=args.pyro_dataset_dir, env=env)


def step_predict(args: argparse.Namespace, temp_dir: Path) -> Path:
    """Step 2: run predictor_runner.py inside pyro-engine's venv -> JSONL."""
    runner = Path(__file__).resolve().parent / "predictor_runner.py"
    python = args.pyro_engine_dir / ".venv/bin/python"
    pyro_predictor_src = args.pyro_engine_dir / "pyro-predictor"
    out_path = temp_dir / "predictor_boxes.jsonl"
    env = {**os.environ, "PYTHONPATH": str(pyro_predictor_src)}
    cmd = [
        str(python),
        str(runner),
        "--save-dir",
        str(temp_dir),
        "--out",
        str(out_path),
        "--n-consecutive",
        str(args.predictor_n_consecutive),
        "--conf-threshold",
        str(args.predictor_conf_threshold),
        "--model-folder",
        str(pyro_predictor_src / "data"),
        "--loglevel",
        args.loglevel,
    ]
    _run(cmd, label="predict", env=env)
    return out_path


def step_assign_groups(args: argparse.Namespace) -> None:
    """Step 5: trigger POST /sequence_groups/assign on the annotation API."""
    if args.skip_group_assignment:
        logging.info("--skip-group-assignment: not invoking assign_groups")
        return
    annotation_api_dir = Path(__file__).resolve().parents[4]
    cmd = [
        "uv",
        "run",
        "python",
        "-m",
        "scripts.data_transfer.ingestion.platform.assign_groups",
        "--url-api-annotation",
        args.url_api_annotation,
        "--loglevel",
        args.loglevel,
    ]
    _run(cmd, label="assign-groups", cwd=annotation_api_dir)


# --------------------------------------------------------------------------- #
# Data loading / joining
# --------------------------------------------------------------------------- #
def _parse_dt(value: str) -> datetime:
    """Parse a platform ISO datetime to a naive UTC datetime.

    Timezone-aware inputs are converted to UTC before the tzinfo is dropped, so
    naive comparisons in clustering use a single, consistent wall clock.
    """
    text = value.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


class SequenceMeta:
    """Platform sequence metadata + per-image detection lookup, from sequences.csv."""

    def __init__(self, first_row: dict) -> None:
        self.camera_name = first_row.get("camera_name")
        self.camera_id = _to_int(first_row.get("camera_id"))
        self.organization_name = first_row.get("organization_name")
        self.organization_id = _to_int(first_row.get("organization_id"))
        self.camera_lat = _to_float(first_row.get("camera_lat"))
        self.camera_lon = _to_float(first_row.get("camera_lon"))
        self.camera_angle_of_view = _to_float(first_row.get("camera_angle_of_view"))
        self.sequence_started_at = first_row.get("sequence_started_at")
        self.sequence_last_seen_at = first_row.get("sequence_last_seen_at")
        # image_filename (basename) -> detection lookup
        self.images: Dict[str, dict] = {}

    def add_image(self, row: dict) -> None:
        filepath = row.get("filepath_image")
        if not filepath:
            return
        filename = Path(filepath).name
        if filename in self.images:
            logging.warning(
                f"Duplicate image filename {filename} in sequences.csv — keeping first"
            )
            return
        self.images[filename] = {
            "filepath_image": filepath,
            "recorded_at": row.get("detection_created_at"),
            "detection_id": _to_int(row.get("detection_id")),
        }


def _to_int(value) -> Optional[int]:
    try:
        return int(float(value)) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _to_float(value) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def load_sequences_csv(temp_dir: Path) -> Dict[int, SequenceMeta]:
    """Index sequences.csv by platform sequence_id -> SequenceMeta."""
    csv_path = temp_dir / "sequences.csv"
    metas: Dict[int, SequenceMeta] = {}
    if not csv_path.exists():
        logging.warning(f"{csv_path} not found — fetch produced no images")
        return metas
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            sid = _to_int(row.get("sequence_id"))
            if sid is None:
                continue
            meta = metas.get(sid)
            if meta is None:
                meta = SequenceMeta(row)
                metas[sid] = meta
            meta.add_image(row)
    return metas


def load_predictor_boxes(jsonl_path: Path) -> Dict[int, dict]:
    """Load predictor_boxes.jsonl into platform sequence_id -> record."""
    records: Dict[int, dict] = {}
    if not jsonl_path.exists():
        logging.warning(f"{jsonl_path} not found — predictor produced no output")
        return records
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            sid = _to_int(obj.get("sequence_id"))
            if sid is not None:
                records[sid] = obj
    return records


# --------------------------------------------------------------------------- #
# Platform re-fetch (camera_azimuth + is_wildfire)
# --------------------------------------------------------------------------- #
def _platform_token(args: argparse.Namespace) -> Optional[str]:
    login = os.getenv("PLATFORM_LOGIN")
    password = os.getenv("PLATFORM_PASSWORD")
    if not login or not password:
        logging.warning(
            "PLATFORM_LOGIN/PLATFORM_PASSWORD unset — cannot re-fetch "
            "camera_azimuth/is_wildfire; falling back to CSV/None"
        )
        return None
    try:
        return platform_client.get_api_access_token(
            api_endpoint=args.url_api_platform, username=login, password=password
        )
    except Exception as exc:
        logging.warning(f"Platform authentication failed: {exc}")
        return None


def _refetch_sequence_fields(
    args: argparse.Namespace,
    token: Optional[str],
    sid: int,
    cache: Dict[int, Tuple[Optional[float], Optional[str]]],
) -> Tuple[Optional[float], Optional[str]]:
    """Return (camera_azimuth, is_wildfire) for a platform sequence id, cached."""
    if sid in cache:
        return cache[sid]
    camera_azimuth: Optional[float] = None
    is_wildfire: Optional[str] = None
    if token is not None:
        try:
            seq = platform_client.get_sequence(args.url_api_platform, sid, token)
            camera_azimuth = _to_float(seq.get("camera_azimuth"))
            is_wildfire = seq.get("is_wildfire")
        except Exception as exc:
            logging.warning(f"Re-fetch of platform sequence {sid} failed: {exc}")
    cache[sid] = (camera_azimuth, is_wildfire)
    return camera_azimuth, is_wildfire


# --------------------------------------------------------------------------- #
# Posting
# --------------------------------------------------------------------------- #
def _iter_synthetic_sequences(args: argparse.Namespace, token: str):
    """Yield (sequence_dict) for every synthetic sequence (alert_api_id >= base).

    Collects each page fully before yielding so callers may delete while
    iterating without skipping rows (paginating forward over a shrinking set
    would otherwise miss items).
    """
    collected = []
    page = 1
    while True:
        result = list_sequences(
            args.url_api_annotation, token, source_api=SOURCE_API, page=page, size=100
        )
        items = result.get("items", [])
        for seq in items:
            if (seq.get("alert_api_id") or 0) >= args.alert_id_base:
                collected.append(seq)
        if page >= result.get("pages", 1) or not items:
            break
        page += 1
    return collected


def reset_synthetic_sequences(args: argparse.Namespace, token: str) -> None:
    """Delete previously-imported synthetic sequences for a clean re-run."""
    sequences = _iter_synthetic_sequences(args, token)
    deleted = 0
    for seq in sequences:
        if not args.dry_run:
            delete_sequence(args.url_api_annotation, token, seq["id"])
        deleted += 1
    logging.info(f"--reset: deleted {deleted} synthetic sequence(s)")


def load_imported_object_keys(
    args: argparse.Namespace, token: str
) -> Set[Tuple[int, int]]:
    """Set of (platform_sid, object_index) already imported as synthetic sequences.

    Reverses the synthetic id scheme (``alert_api_id = base + sid*1000 + idx``)
    so a run skips re-importing objects that are already in the dataset. Working
    at object granularity (not just sid) lets a previously-partial import be
    completed: only the missing objects are re-created.
    """
    keys: Set[Tuple[int, int]] = set()
    for seq in _iter_synthetic_sequences(args, token):
        offset = (seq.get("alert_api_id") or 0) - args.alert_id_base
        keys.add((offset // 1000, offset % 1000))
    logging.info(f"{len(keys)} object(s) already in the dataset")
    return keys


def _build_sequence_payload(
    meta: SequenceMeta,
    sid: int,
    camera_azimuth: Optional[float],
    is_wildfire: Optional[str],
) -> dict:
    """Build the transform_sequence_data input record from CSV + re-fetched fields."""
    record = {
        "camera_azimuth": camera_azimuth,
        "sequence_id": sid,
        "camera_name": meta.camera_name,
        "camera_id": meta.camera_id,
        "organization_name": meta.organization_name,
        "organization_id": meta.organization_id,
        "sequence_is_wildfire": is_wildfire,
        "camera_lat": meta.camera_lat,
        "camera_lon": meta.camera_lon,
        "sequence_started_at": meta.sequence_started_at,
        "sequence_last_seen_at": meta.sequence_last_seen_at,
    }
    return shared.transform_sequence_data(record, SOURCE_API)


def post_object(
    args: argparse.Namespace,
    token: str,
    meta: SequenceMeta,
    sid: int,
    object_index: int,
    obj,
    camera_azimuth: Optional[float],
    is_wildfire: Optional[str],
    boxes_by_image: Dict[str, List[Tuple[int, List[float]]]],
) -> bool:
    """Create one annotation sequence + its detections + the single-object track.

    `boxes_by_image` maps each image filename to the list of
    `(object_index, box)` for every object detected on that frame, so each
    detection can carry the OTHER objects' boxes on the same image in
    `others_bboxes` (read-only context the annotator needs to judge missed
    smoke). Returns True on success.
    """
    members = obj.members
    sequence_data = _build_sequence_payload(meta, sid, camera_azimuth, is_wildfire)
    sequence_data["alert_api_id"] = args.alert_id_base + sid * 1000 + object_index

    cone_azimuth = (
        object_cone_azimuth(obj, camera_azimuth, meta.camera_angle_of_view)
        if camera_azimuth is not None
        else None
    )
    if cone_azimuth is not None:
        sequence_data["azimuth"] = int(round(cone_azimuth)) % 360

    # Per-object temporal extent from the member frames (raw ISO strings preserved).
    member_rows = [meta.images.get(m.image_filename) for m in members]
    recorded_strs = [
        (r["recorded_at"], _parse_dt(r["recorded_at"]))
        for r in member_rows
        if r and r.get("recorded_at")
    ]
    if recorded_strs:
        sequence_data["recorded_at"] = min(recorded_strs, key=lambda x: x[1])[0]
        sequence_data["last_seen_at"] = max(recorded_strs, key=lambda x: x[1])[0]

    alert_id = sequence_data["alert_api_id"]
    logging.info(
        f"seq {sid} object {object_index}: alert_api_id={alert_id}, "
        f"{len(members)} detection(s), azimuth={sequence_data.get('azimuth')}"
    )
    if args.dry_run:
        return True

    try:
        annotation_sequence = create_sequence(
            args.url_api_annotation, token, sequence_data
        )
    except AnnotationAPIError as exc:
        if exc.status_code == 409:
            logging.warning(
                f"seq {sid} object {object_index}: alert_api_id={alert_id} already "
                f"exists — skipping (use --reset for a clean re-run)"
            )
            return False
        raise
    new_seq_id = annotation_sequence["id"]

    posted = 0
    hard_failure = False
    track_bboxes: List[dict] = []
    for member in members:
        row = meta.images.get(member.image_filename)
        if row is None:
            logging.warning(
                f"No CSV row for image {member.image_filename}; skipping detection"
            )
            continue
        xyxyn = [float(c) for c in member.box[:4]]
        predictions = shared._sanitize_predictions(
            [
                {
                    "xyxyn": xyxyn,
                    "confidence": float(member.box[4]),
                    "class_name": "smoke",
                }
            ]
        )
        if not predictions:
            continue
        detection_data = {
            "sequence_id": new_seq_id,
            "alert_api_id": row["detection_id"],
            "recorded_at": row["recorded_at"],
            "algo_predictions": {"predictions": predictions},
        }
        # Other objects' boxes on this same frame -> others_bboxes (read-only
        # context so the annotator can judge missed smoke across objects).
        other_preds = shared._sanitize_predictions(
            [
                {
                    "xyxyn": [float(c) for c in box[:4]],
                    "confidence": float(box[4]),
                    "class_name": "smoke",
                }
                for oi, box in boxes_by_image.get(member.image_filename, [])
                if oi != object_index
            ]
        )
        if other_preds:
            detection_data["others_bboxes"] = {"predictions": other_preds}
        try:
            image_bytes = Path(row["filepath_image"]).read_bytes()
        except OSError as exc:
            logging.warning(f"Cannot read {row['filepath_image']}: {exc}")
            continue
        try:
            created = create_detection(
                args.url_api_annotation,
                token,
                detection_data,
                image_bytes,
                member.image_filename,
            )
            posted += 1
            # Remember the annotation-API detection id + its box so we can build
            # ONE annotation track for this object (see below).
            track_bboxes.append({"detection_id": created["id"], "xyxyn": xyxyn})
        except AnnotationAPIError as exc:
            logging.warning(
                f"Detection {row['detection_id']} (seq {new_seq_id}) failed: {exc}"
            )
            hard_failure = True

    # Roll back an incomplete object so it is not left half-imported (which the
    # object-level dedup would otherwise treat as "done" and never retry).
    # Any shortfall vs the member count (POST error, unreadable image, dropped
    # prediction) is treated as incomplete, so a retry re-creates it cleanly.
    if posted < len(members) or hard_failure:
        logging.warning(
            f"seq {sid} object {object_index}: incomplete "
            f"({posted}/{len(members)} detections, hard_failure={hard_failure}) "
            f"— deleting sequence {new_seq_id} for retry"
        )
        _safe_delete_sequence(args, token, new_seq_id)
        return False

    # Write the annotation ourselves as a SINGLE bbox track = this object.
    # We deliberately do NOT use the server's empty-bbox auto-generation: that
    # re-clusters the detections by IoU and fragments one drifting/tiny-box
    # object into several tracks. Since the object split already happened
    # upstream (object_clustering), every detection here belongs to the same
    # object, so it is exactly one track (is_smoke, conservative, for review).
    annotation_payload = {
        "sequence_id": new_seq_id,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": track_bboxes,
                }
            ]
        },
        "processing_stage": "ready_to_annotate",
        "has_missed_smoke": False,
        "has_smoke": True,
        "has_false_positives": False,
        "false_positive_types": [],
        "smoke_types": [],
        "is_unsure": False,
    }
    try:
        create_sequence_annotation(args.url_api_annotation, token, annotation_payload)
    except AnnotationAPIError as exc:
        logging.warning(
            f"seq {sid} object {object_index}: annotation POST failed ({exc}) "
            f"— deleting sequence {new_seq_id} for retry"
        )
        _safe_delete_sequence(args, token, new_seq_id)
        return False

    logging.info(
        f"seq {sid} object {object_index}: posted {posted} detection(s), 1 track"
    )
    return True


def _safe_delete_sequence(args: argparse.Namespace, token: str, seq_id: int) -> None:
    """Delete a sequence, swallowing errors (rollback is best-effort)."""
    try:
        delete_sequence(args.url_api_annotation, token, seq_id)
    except AnnotationAPIError as exc:
        logging.warning(f"Rollback delete of sequence {seq_id} failed: {exc}")


# --------------------------------------------------------------------------- #
# Per-day processing
# --------------------------------------------------------------------------- #
def process_day(
    args: argparse.Namespace,
    day: date,
    token: str,
    platform_token: Optional[str],
    refetch_cache: Dict[int, Tuple[Optional[float], Optional[str]]],
    imported_objs: Set[Tuple[int, int]],
    imported_run_sids: Set[int],
    max_new_sids: Optional[int],
) -> bool:
    """Fetch + predict + push one calendar day. Returns True if anything was created.

    Dedup is at OBJECT granularity: an object whose ``(sid, object_index)`` is
    already in `imported_objs` (the dataset) is skipped, so a previously-partial
    platform sequence is completed rather than blocked. `imported_run_sids`
    tracks platform sequences imported during this run for the --max-sequences
    budget (`max_new_sids`).
    """
    day_from = day.strftime("%Y-%m-%d")
    day_end = (day + timedelta(days=1)).strftime("%Y-%m-%d")  # exclusive
    temp_dir = Path(tempfile.mkdtemp(prefix=f"import_predictor_split_{day_from}_"))
    logging.info(f"=== Day {day_from} === temp dir: {temp_dir}")
    created_any = False
    try:
        step_fetch(args, temp_dir, day_from, day_end)
        jsonl_path = step_predict(args, temp_dir)

        metas = load_sequences_csv(temp_dir)
        predictor_records = load_predictor_boxes(jsonl_path)

        kept_sids = sorted(
            sid
            for sid, rec in predictor_records.items()
            if rec.get("status") == "kept" and sid in metas
        )
        logging.info(f"Day {day_from}: {len(kept_sids)} kept sequence(s)")

        for sid in tqdm(
            kept_sids, desc=f"{day_from} sequences", unit="seq", leave=False
        ):
            # Budget: stop taking NEW platform sequences once the cap is hit.
            if (
                max_new_sids is not None
                and sid not in imported_run_sids
                and len(imported_run_sids) >= max_new_sids
            ):
                logging.info("Reached --max-sequences cap; stopping.")
                break

            meta = metas[sid]
            rec = predictor_records[sid]
            # Attach the parsed recorded_at to each frame for clustering.
            frames = []
            for frame in rec.get("frames", []):
                row = meta.images.get(frame.get("image_filename"))
                if row is None or not row.get("recorded_at"):
                    continue
                frames.append(
                    {
                        "frame_idx": frame.get("frame_idx", 0),
                        "image_filename": frame["image_filename"],
                        "recorded_at": _parse_dt(row["recorded_at"]),
                        "boxes": frame.get("boxes", []),
                    }
                )
            objects = cluster_objects(
                frames,
                min_dets=args.min_dets,
                min_interval_seconds=args.min_interval_seconds,
                relaxation_seconds=args.relaxation_seconds,
            )
            if not objects:
                logging.info(f"seq {sid}: no objects after clustering — dropped")
                continue
            # Index every object's boxes by frame so each detection can carry the
            # OTHER objects' boxes on that frame as others_bboxes.
            boxes_by_image: Dict[str, List[Tuple[int, List[float]]]] = defaultdict(list)
            for oi, o in enumerate(objects):
                for m in o.members:
                    boxes_by_image[m.image_filename].append((oi, m.box))
            camera_azimuth, is_wildfire = _refetch_sequence_fields(
                args, platform_token, sid, refetch_cache
            )
            for object_index, obj in enumerate(objects):
                if (sid, object_index) in imported_objs:
                    logging.debug(
                        f"seq {sid} object {object_index}: already in dataset — skipping"
                    )
                    continue
                if post_object(
                    args,
                    token,
                    meta,
                    sid,
                    object_index,
                    obj,
                    camera_azimuth,
                    is_wildfire,
                    boxes_by_image,
                ):
                    imported_objs.add((sid, object_index))
                    imported_run_sids.add(sid)
                    created_any = True
        return created_any
    finally:
        if args.keep_temp:
            logging.info(f"Temp dir kept at {temp_dir}")
        else:
            try:
                shutil.rmtree(temp_dir)
            except OSError as exc:
                logging.warning(f"Failed to clean up temp dir {temp_dir}: {exc}")
            else:
                logging.info(f"Cleaned up temp dir {temp_dir}")


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    args = make_cli_parser().parse_args()
    logging.basicConfig(
        level=args.loglevel.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    days = _iter_days(args)
    _validate_paths(args)
    logging.info(f"Processing {len(days)} day(s): {days[0]} .. {days[-1]}")

    # Annotation API auth (sequences + detections). Re-fetched per day inside the
    # loop too, so a multi-day run never outlives the token's TTL.
    login, password = shared.get_annotation_credentials(args.url_api_annotation)
    token = get_auth_token(args.url_api_annotation, login, password)

    if args.reset:
        reset_synthetic_sequences(args, token)

    # Pre-load (sid, object_index) keys already in the dataset (object-level dedup).
    imported_objs = load_imported_object_keys(args, token)

    refetch_cache: Dict[int, Tuple[Optional[float], Optional[str]]] = {}
    imported_run_sids: Set[int] = set()
    max_new_sids = (
        args.max_sequences if args.max_sequences and args.max_sequences > 0 else None
    )

    failed_days: List[str] = []
    for day in tqdm(days, desc="Days", unit="day"):
        if max_new_sids is not None and len(imported_run_sids) >= max_new_sids:
            logging.info("Reached --max-sequences cap; stopping.")
            break
        # Refresh both tokens each day so a long run never hits an expired token.
        try:
            token = get_auth_token(args.url_api_annotation, login, password)
            platform_token = _platform_token(args)
            created = process_day(
                args,
                day,
                token,
                platform_token,
                refetch_cache,
                imported_objs,
                imported_run_sids,
                max_new_sids,
            )
        except Exception as exc:
            # One bad day (fetch/predict/network) must not abort a 335-day run.
            logging.error(f"Day {day} failed: {exc} — skipping", exc_info=True)
            failed_days.append(day.strftime("%Y-%m-%d"))
            continue
        # Assign groups after each productive day so an interruption never leaves
        # already-imported sequences ungrouped.
        if created and not args.dry_run:
            try:
                step_assign_groups(args)
            except Exception as exc:
                logging.error(f"assign_groups after {day} failed: {exc}")

    if failed_days:
        logging.warning(
            f"{len(failed_days)} day(s) failed and were skipped: {failed_days}"
        )
    return 1 if failed_days else 0


if __name__ == "__main__":
    sys.exit(main())
