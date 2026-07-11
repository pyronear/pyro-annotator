"""
Export a YOLO style dataset from the local annotation API.

For each detection, this script:
- Calls the /export/detections endpoint in pages with limit and offset
- Downloads the image from image_url
- Uses sequence level annotations (sequences_bbox) to create YOLO labels
- Organizes data as:
    dataset_exported_{timestamp}/
        <category>/                # wildfire, other_smoke, fp, or no_label
            <sequence_folder>/     # named {prefix}-{org}_{camera}_{azimuth}_{datetime}
                images/
                    {prefix}-{org}_{camera}_{azimuth}_{recorded_at}.jpg
                labels/
                    {prefix}-{org}_{camera}_{azimuth}_{recorded_at}.txt  # empty if no bbox

Sequences imported by the predictor-split pipeline (one sequence per detected object)
duplicate the same frames across sibling sequences. To export each frame once, sequences
from the same camera are chained into one view group while the gap between their frame
spans stays under ``--merge-gap-hours`` (siblings overlap, so they always merge). Frames
are deduplicated by platform detection id + timestamp and each label file carries the
union of every member's boxes on that frame.

Categories (from sequence_smoke_types, per view group with priority
wildfire > other_smoke > fp across member sequences):
    wildfire     - "wildfire" in sequence_smoke_types
    other_smoke  - any other smoke type in sequence_smoke_types
    fp           - no smoke types (false positive sequence)

YOLO format per line:
    class_id x_center y_center width height

Example:
uv run python -m scripts.data_transfer.ingestion.platform.export_dataset \
  --api-base https://annotationapi.pyronear.org/api/v1 \
  --limit 500 \
  --max-rows 2000 \
  --timeout 120 \
  --output-dir outputs/datasets \
  --verify-ssl \
  --loglevel info
# username and password will be read from .env if not provided as flags
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from multiprocessing import Pool, cpu_count
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv
from tqdm.auto import tqdm

# Load environment variables early so argparse defaults can see them
load_dotenv()


# ---------------------------------------------------------------------------
# CLI and utilities
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export YOLO style dataset from annotation API"
    )
    parser.add_argument(
        "--api-base",
        default="http://localhost:5050/api/v1",
        help="Base URL of the API",
    )
    parser.add_argument(
        "--username",
        default=os.getenv("MAIN_ANNOTATION_LOGIN")
        or os.getenv("ANNOTATOR_LOGIN", "admin"),
        help="API username, defaults to MAIN_ANNOTATION_LOGIN / ANNOTATOR_LOGIN env vars",
    )
    parser.add_argument(
        "--password",
        default=os.getenv("MAIN_ANNOTATION_PASSWORD")
        or os.getenv("ANNOTATOR_PASSWORD", "admin12345"),
        help="API password, defaults to MAIN_ANNOTATION_PASSWORD / ANNOTATOR_PASSWORD env vars",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="HTTP request timeout in seconds",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10000,
        help="Number of detections to request per page from /export/detections",
    )
    parser.add_argument(
        "--max-rows",
        type=int,
        default=0,
        help="Maximum total number of detections to fetch, zero means no limit",
    )
    parser.add_argument(
        "--annotation-created-gte",
        default="",
        help="Filter sequences with annotation created_at greater or equal to this ISO datetime",
    )
    parser.add_argument(
        "--annotation-created-lte",
        default="",
        help="Filter sequences with annotation created_at less or equal to this ISO datetime",
    )
    parser.add_argument(
        "--source-api",
        default="",
        help=(
            "Optional filter by source API, for example "
            "pyronear_french, alert_wildfire, api_cenia"
        ),
    )
    parser.add_argument(
        "--organisation-name",
        default="",
        help="Optional filter by organisation name exact match",
    )
    parser.add_argument(
        "--output-dir",
        default="",
        help=(
            "Base directory where the dataset root will be created, "
            "defaults to outputs/datasets/dataset_exported_YYYYMMDD_HHMMSS"
        ),
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )
    parser.add_argument(
        "--verify-ssl",
        action="store_true",
        help="Verify TLS certificates when connecting to the API and image URLs",
    )
    parser.add_argument(
        "--num-workers",
        type=int,
        default=0,
        help="Number of worker processes for downloads, zero uses CPU count",
    )
    parser.add_argument(
        "--category",
        type=str,
        choices=["wildfire", "other_smoke", "fp"],
        default=None,
        help="Only export sequences of this category (wildfire, other_smoke, fp). Default: all.",
    )
    parser.add_argument(
        "--merge-gap-hours",
        type=float,
        default=2.0,
        help=(
            "Max gap between frame spans of two sequences from the same camera "
            "to merge them into one view group folder"
        ),
    )
    return parser.parse_args()


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="[%(levelname)s] %(message)s",
    )


def default_dataset_root(base_output_dir: Optional[str] = None) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if base_output_dir:
        base = Path(base_output_dir)
    else:
        base = Path("outputs") / "datasets"
    root = base / f"dataset_exported_{timestamp}"
    root.mkdir(parents=True, exist_ok=True)
    return root


def get_token(
    api_base: str,
    username: str,
    password: str,
    timeout: int,
    verify_ssl: bool,
) -> str:
    login_url = f"{api_base}/auth/login"
    payload = {"username": username, "password": password}
    resp = requests.post(login_url, json=payload, timeout=timeout, verify=verify_ssl)
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError("Login response did not include access_token")
    logging.info("Token generated successfully")
    return token


# ---------------------------------------------------------------------------
# Dataset specific helpers
# ---------------------------------------------------------------------------

# SmokeType and FalsePositiveType values from the API enums
SMOKE_TYPES: List[str] = ["wildfire", "industrial", "other"]

FALSE_POSITIVE_TYPES: List[str] = [
    "antenna",
    "building",
    "cliff",
    "dark",
    "dust",
    "high_cloud",
    "low_cloud",
    "lens_flare",
    "lens_droplet",
    "light",
    "rain",
    "trail",
    "road",
    "sky",
    "tree",
    "water_body",
    "other",
    "unlabeled",
]

ALL_CLASSES: List[str] = SMOKE_TYPES + FALSE_POSITIVE_TYPES
CLASS_ID: Dict[str, int] = {name: idx for idx, name in enumerate(ALL_CLASSES)}

# Top-level folder categories
CATEGORY_WILDFIRE = "wildfire"
CATEGORY_OTHER_SMOKE = "other_smoke"
CATEGORY_FP = "fp"


def seq_type_to_category(seq_type: str) -> str:
    """Map a detailed seq_type to one of the three top-level categories."""
    if seq_type == "wildfire":
        return CATEGORY_WILDFIRE
    if seq_type in ("industrial", "other"):
        return CATEGORY_OTHER_SMOKE
    if seq_type in FALSE_POSITIVE_TYPES:
        return CATEGORY_FP
    return CATEGORY_FP


def format_recorded_at(raw: Any) -> str:
    """
    Convert recorded_at field to string YYYY-MM-DDTHH-MM-SS.
    Accepts ISO strings with optional timezone or datetime objects.
    """
    if isinstance(raw, datetime):
        dt = raw
    elif isinstance(raw, str):
        text = raw
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            text = text[:19]
            dt = datetime.fromisoformat(text)
    else:
        raise ValueError(f"Unsupported recorded_at value {raw!r}")

    dt = dt.replace(tzinfo=None, microsecond=0)
    return dt.strftime("%Y-%m-%dT%H-%M-%S")


def normalize_slug(s: str) -> str:
    """
    Convert arbitrary text into a filename friendly slug without underscores.
    lower case, remove accents, replace non alnum characters with dash,
    collapse repeated dashes, strip leading and trailing dashes.
    """
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


SOURCE_API_PREFIX: Dict[str, str] = {
    "pyronear_french": "pyronear",
    "alert_wildfire": "awf",
    "api_cenia": "cenia",
}


def build_file_basename(row: Dict[str, Any]) -> str:
    """
    Build base filename:
        {prefix}-{org}_{camera}_{azimuth}_{recorded_at}
    where prefix is derived from source_api (pyronear, awf, cenia),
    recorded_at is formatted as YYYY-MM-DDTHH-MM-SS,
    and azimuth defaults to 0.
    """
    source_raw = str(row.get("source_api", "unknown"))
    prefix = SOURCE_API_PREFIX.get(source_raw, normalize_slug(source_raw))

    org_raw = row.get("organisation_name", "unknown")
    org = normalize_slug(str(org_raw))

    cam_raw = row.get("camera_name", "unknown_camera")
    cam = normalize_slug(str(cam_raw))

    az = row.get("azimuth", None)
    az_str = str(az) if isinstance(az, int) else "0"

    recorded_at_raw = row.get("recorded_at")
    if recorded_at_raw is None:
        raise ValueError("Missing recorded_at in export row")
    recorded_at_str = format_recorded_at(recorded_at_raw)

    return f"{prefix}-{org}_{cam}_{az_str}_{recorded_at_str}"


def parse_dt_utc(raw: Any) -> datetime:
    """Parse a recorded_at value into an aware UTC datetime (grouping/dedup key)."""
    if isinstance(raw, datetime):
        dt = raw
    else:
        text = str(raw)
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def sequence_category_from_row(row: Dict[str, Any]) -> str:
    """Derive a single category from the sequence-level annotation fields.

    The export endpoint already filters to processing_stage=annotated, so
    rows reaching this function come from annotated sequences. Sequences
    with empty smoke_types and empty false_positive_types therefore
    represent confirmed false positives from the FP review workflow
    (a deliberate "no smoke, no FP type" annotation), not unannotated
    sequences.

    Priority:
      1. "wildfire" in sequence_smoke_types → wildfire
      2. any other smoke type present       → other_smoke
      3. otherwise (includes empty + empty)  → fp
    """
    smoke_types = row.get("sequence_smoke_types") or []
    if "wildfire" in smoke_types:
        return CATEGORY_WILDFIRE
    if smoke_types:
        return CATEGORY_OTHER_SMOKE
    return CATEGORY_FP


def compute_sequence_categories(rows: List[Dict[str, Any]]) -> Dict[int, str]:
    """Map each sequence_id to a single category (wildfire, other_smoke, fp).

    The export endpoint filters to annotated sequences, so every row gets a
    category (empty smoke_types + empty false_positive_types → fp).
    """
    seq_cats: Dict[int, str] = {}
    for row in rows:
        seq_id = row.get("sequence_id")
        if seq_id is None:
            continue
        seq_id_int = int(seq_id)
        if seq_id_int not in seq_cats:
            seq_cats[seq_id_int] = sequence_category_from_row(row)
    return seq_cats


CATEGORY_PRIORITY: List[str] = [CATEGORY_WILDFIRE, CATEGORY_OTHER_SMOKE, CATEGORY_FP]


def build_view_groups(
    rows_by_seq: Dict[int, List[Dict[str, Any]]],
    merge_gap: timedelta,
) -> List[List[int]]:
    """Chain sequences of the same (source_api, camera_id) into view groups while
    the gap between their frame time spans stays within ``merge_gap``.

    Object-split sibling sequences overlap in time, so they always land in the
    same group; consecutive alerts of the same camera view get chained too.
    """
    spans = []
    for seq_id, seq_rows in rows_by_seq.items():
        times = [parse_dt_utc(r["recorded_at"]) for r in seq_rows]
        first = seq_rows[0]
        spans.append(
            {
                "seq_id": seq_id,
                "start": min(times),
                "end": max(times),
                "camera": (first.get("source_api"), first.get("camera_id")),
            }
        )

    by_camera: Dict[Any, List[Dict[str, Any]]] = defaultdict(list)
    for span in spans:
        by_camera[span["camera"]].append(span)

    groups: List[List[int]] = []
    for cam_spans in by_camera.values():
        cam_spans.sort(key=lambda s: s["start"])
        current = [cam_spans[0]]
        current_end = cam_spans[0]["end"]
        for nxt in cam_spans[1:]:
            if nxt["start"] - current_end <= merge_gap:
                current.append(nxt)
                current_end = max(current_end, nxt["end"])
            else:
                groups.append([s["seq_id"] for s in current])
                current = [nxt]
                current_end = nxt["end"]
        groups.append([s["seq_id"] for s in current])

    groups.sort(key=min)
    return groups


def extract_labels_for_detection(row: Dict[str, Any]) -> List[str]:
    """
    From one export row, build a list of YOLO label lines for this detection.

    class_id uses the detailed type index from ALL_CLASSES.
    Only boxes whose detection_id matches row["detection_id"] are used.
    Boxes use normalized xyxyn coordinates [x1, y1, x2, y2].

    When a group has is_smoke=True but no smoke_type, falls back to
    the sequence-level smoke_types field.
    """
    detection_id = row.get("detection_id")
    seq_ann = row.get("sequence_annotation") or {}
    sequences_bbox = seq_ann.get("sequences_bbox") or []

    # Fallback smoke type from the sequence-level derived field
    seq_smoke_types = row.get("sequence_smoke_types") or []
    default_smoke_type = seq_smoke_types[0] if seq_smoke_types else "wildfire"

    labels: List[str] = []

    for group in sequences_bbox:
        is_smoke = group.get("is_smoke", False)
        smoke_type = group.get("smoke_type")
        fp_types = group.get("false_positive_types") or []

        if is_smoke:
            seq_type = smoke_type if smoke_type else default_smoke_type
        elif fp_types:
            seq_type = fp_types[0]
        else:
            seq_type = "other"

        if seq_type not in CLASS_ID:
            seq_type = "other"

        class_id = CLASS_ID[seq_type]

        for bbox in group.get("bboxes", []):
            if bbox.get("detection_id") != detection_id:
                continue

            xyxyn = bbox.get("xyxyn")
            if not xyxyn or len(xyxyn) != 4:
                continue

            x1, y1, x2, y2 = xyxyn
            x_center = (x1 + x2) / 2.0
            y_center = (y1 + y2) / 2.0
            width = x2 - x1
            height = y2 - y1

            labels.append(
                f"{class_id} " f"{x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"
            )

    return labels


def fetch_detections(
    api_base: str,
    headers: Dict[str, str],
    timeout: int,
    verify_ssl: bool,
    page_size: int,
    max_rows: int,
    annotation_created_gte: str,
    annotation_created_lte: str,
    source_api: str,
    organisation_name: str,
) -> List[Dict[str, Any]]:
    """
    Fetch detections from /export/detections using pagination with limit and offset.
    """
    url = f"{api_base}/export/detections"
    all_rows: List[Dict[str, Any]] = []
    offset = 0
    page_index = 0

    while True:
        if max_rows > 0 and len(all_rows) >= max_rows:
            logging.info("Reached max_rows limit %s, stopping pagination", max_rows)
            break

        effective_limit = page_size
        if max_rows > 0:
            remaining = max_rows - len(all_rows)
            if remaining <= 0:
                break
            if remaining < effective_limit:
                effective_limit = remaining

        params: Dict[str, Any] = {
            "limit": effective_limit,
            "offset": offset,
        }

        if annotation_created_gte:
            params["sequence_annotation_created_gte"] = annotation_created_gte
        if annotation_created_lte:
            params["sequence_annotation_created_lte"] = annotation_created_lte
        if source_api:
            params["source_api"] = source_api
        if organisation_name:
            params["organisation_name"] = organisation_name

        logging.info(
            "Requesting page %s, offset=%s, limit=%s, params=%s",
            page_index,
            offset,
            effective_limit,
            params,
        )
        resp = requests.get(
            url,
            headers=headers,
            params=params,
            timeout=timeout,
            verify=verify_ssl,
        )
        resp.raise_for_status()
        data = resp.json()

        if not isinstance(data, list):
            raise RuntimeError("Expected a list from /export/detections")

        num_rows = len(data)
        logging.info("Received %s detections in this page", num_rows)

        if num_rows == 0:
            break

        all_rows.extend(data)

        if num_rows < effective_limit:
            break

        offset += effective_limit
        page_index += 1

    logging.info("Total detections fetched from export endpoint: %s", len(all_rows))
    return all_rows


# ---------------------------------------------------------------------------
# Multiprocessing worker setup
# ---------------------------------------------------------------------------

BASE_DIR: Optional[Path] = None
TIMEOUT_G: int = 30
VERIFY_SSL_G: bool = False
HEADERS_G: Dict[str, str] = {}
SESSION: Optional[requests.Session] = None


def _init_worker(
    base_dir_str: str,
    timeout: int,
    verify_ssl: bool,
    headers: Dict[str, str],
) -> None:
    global BASE_DIR, TIMEOUT_G, VERIFY_SSL_G, HEADERS_G, SESSION
    BASE_DIR = Path(base_dir_str)
    TIMEOUT_G = timeout
    VERIFY_SSL_G = verify_ssl
    HEADERS_G = headers
    SESSION = None


def _get_session() -> requests.Session:
    global SESSION
    if SESSION is None:
        SESSION = requests.Session()
        SESSION.verify = VERIFY_SSL_G
        SESSION.headers.update(HEADERS_G)
    return SESSION


def _process_task(task: Dict[str, Any]) -> Tuple[int, int]:
    """
    Worker function that downloads one image and writes image and labels.

    Returns a tuple (images_written, labels_nonempty).
    """
    file_base: str = task["file_base"]
    image_url: str = task["image_url"]
    category: str = task["category"]
    labels: List[str] = task["labels"]
    seq_folder_name: str = task["seq_folder_name"]

    try:
        session = _get_session()
        resp_img = session.get(image_url, timeout=TIMEOUT_G, stream=True)
        resp_img.raise_for_status()
        img_bytes = resp_img.content
    except Exception as exc:
        logging.warning("Failed to download %s: %s", image_url, exc)
        return 0, 0

    base = BASE_DIR / category / seq_folder_name  # type: ignore[operator]
    img_dir = base / "images"
    label_dir = base / "labels"
    img_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)

    img_path = img_dir / f"{file_base}.jpg"
    label_path = label_dir / f"{file_base}.txt"

    images_written = 0
    labels_nonempty = 0

    if not img_path.exists():
        with open(img_path, "wb") as f:
            f.write(img_bytes)
        images_written = 1

    with open(label_path, "w", encoding="utf-8") as f:
        if labels:
            f.write("\n".join(labels) + "\n")
    if labels:
        labels_nonempty = 1

    return images_written, labels_nonempty


def build_dataset(
    rows: List[Dict[str, Any]],
    root_dir: Path,
    timeout: int,
    verify_ssl: bool,
    headers: Dict[str, str],
    num_workers: int,
    category_filter: Optional[str] = None,
    merge_gap_hours: float = 2.0,
) -> None:
    """
    Build the dataset folder structure from the exported rows.

    Sequences from the same camera whose frame spans are less than
    ``merge_gap_hours`` apart share one view group folder. Within a group,
    frames are deduplicated by platform detection id + timestamp:
      the image is saved once,
      the label file carries the union of every member sequence's boxes,
      an empty txt file is created when no box exists on the frame.

    Processing is parallelized across worker processes and progress
    is tracked with a tqdm progress bar.
    """
    rows_by_seq: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if not row.get("image_url"):
            continue
        if row.get("sequence_id") is None or row.get("detection_id") is None:
            continue
        rows_by_seq[int(row["sequence_id"])].append(row)

    if not rows_by_seq:
        logging.warning("No usable export rows, nothing to write")
        return

    # compute sequence -> single category
    seq_cat_map = compute_sequence_categories(rows)

    groups = build_view_groups(rows_by_seq, timedelta(hours=merge_gap_hours))
    logging.info(
        "Grouped %s sequence(s) into %s view group folder(s)",
        len(rows_by_seq),
        len(groups),
    )

    tasks: List[Dict[str, Any]] = []
    kept_groups = 0

    for group_seq_ids in groups:
        # one category per group: wildfire > other_smoke > fp across members
        cats = {seq_cat_map[s] for s in group_seq_ids if s in seq_cat_map}
        if not cats:
            continue
        category = min(cats, key=CATEGORY_PRIORITY.index)
        if category_filter and category != category_filter:
            continue
        kept_groups += 1

        # Deduplicate frames across member sequences: sibling detections of the
        # same frame share the platform detection id (alert_api_id) + timestamp.
        frames: Dict[Tuple[Any, datetime], Dict[str, Any]] = {}
        group_rows = sorted(
            (row for seq_id in group_seq_ids for row in rows_by_seq[seq_id]),
            key=lambda r: (parse_dt_utc(r["recorded_at"]), int(r["detection_id"])),
        )
        for row in group_rows:
            key = (
                row.get("alert_api_id") or f"det_{row['detection_id']}",
                parse_dt_utc(row["recorded_at"]),
            )
            frame = frames.setdefault(key, {"row": row, "labels": []})
            frame["labels"].extend(extract_labels_for_detection(row))

        folder_name: Optional[str] = None
        for frame in frames.values():
            row = frame["row"]
            try:
                file_base = build_file_basename(row)
            except Exception as exc:
                logging.warning(
                    "Could not build filename for detection %s: %s",
                    row.get("detection_id"),
                    exc,
                )
                continue
            if folder_name is None:
                folder_name = file_base

            tasks.append(
                {
                    "file_base": file_base,
                    "image_url": row["image_url"],
                    "category": category,
                    "seq_folder_name": folder_name,
                    "labels": sorted(set(frame["labels"])),
                }
            )

    if category_filter:
        logging.info(
            "Category filter '%s': kept %s/%s view groups",
            category_filter,
            kept_groups,
            len(groups),
        )

    if not tasks:
        logging.warning("No tasks built from export rows, nothing to write")
        return

    logging.info("Prepared %s download tasks", len(tasks))

    if num_workers <= 0:
        num_workers = cpu_count()
    logging.info("Using %s worker processes", num_workers)

    images_total = 0
    labels_total = 0

    with Pool(
        processes=num_workers,
        initializer=_init_worker,
        initargs=(str(root_dir), timeout, verify_ssl, headers),
    ) as pool:
        for img_count, label_count in tqdm(
            pool.imap_unordered(_process_task, tasks),
            total=len(tasks),
            desc="Building dataset",
        ):
            images_total += img_count
            labels_total += label_count

    logging.info("Dataset build complete")
    logging.info("Root directory: %s", root_dir)
    logging.info("Images saved: %s", images_total)
    logging.info("Label files written (non empty): %s", labels_total)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    args = parse_args()
    setup_logging(args.loglevel)

    root_dir = default_dataset_root(args.output_dir)
    logging.info("Dataset root directory: %s", root_dir)

    token = get_token(
        api_base=args.api_base,
        username=args.username,
        password=args.password,
        timeout=args.timeout,
        verify_ssl=args.verify_ssl,
    )
    headers = {
        "accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    rows = fetch_detections(
        api_base=args.api_base,
        headers=headers,
        timeout=args.timeout,
        verify_ssl=args.verify_ssl,
        page_size=args.limit,
        max_rows=args.max_rows,
        annotation_created_gte=args.annotation_created_gte,
        annotation_created_lte=args.annotation_created_lte,
        source_api=args.source_api,
        organisation_name=args.organisation_name,
    )

    if not rows:
        logging.warning("No detections returned by export endpoint, nothing to do")
        return

    if args.max_rows > 0:
        logging.warning(
            "--max-rows is set: truncated fetches can split sequences/view groups "
            "across runs and produce incomplete folders"
        )

    build_dataset(
        rows=rows,
        root_dir=root_dir,
        timeout=args.timeout,
        verify_ssl=args.verify_ssl,
        headers=headers,
        num_workers=args.num_workers,
        category_filter=args.category,
        merge_gap_hours=args.merge_gap_hours,
    )


if __name__ == "__main__":
    main()
