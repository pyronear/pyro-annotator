"""
Export a YOLO style dataset from the local annotation API.

For each detection, this script:
- Calls the /export/detections endpoint in pages with limit and offset
- Downloads the image from image_url
- Uses sequence level annotations (sequences_bbox) to create YOLO labels
- Organizes data as:
    dataset_exported_{timestamp}/
        <seq_type>/                # smoke type, false positive type or "no_label"
            <sequence_folder>/     # named after first image basename for this sequence and type
                images/
                    pyronear-{organisation_name}-{camera_name}-{azimuth}-{recorded_at}.jpg
                labels/
                    pyronear-{organisation_name}-{camera_name}-{azimuth}-{recorded_at}.txt  # empty if no bbox

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
from datetime import datetime
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
        default=os.getenv("ANNOTATOR_LOGIN", "admin"),
        help="API username, defaults to ANNOTATOR_LOGIN env var or 'admin'",
    )
    parser.add_argument(
        "--password",
        default=os.getenv("ANNOTATOR_PASSWORD", "admin12345"),
        help="API password, defaults to ANNOTATOR_PASSWORD env var or 'admin12345'",
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
]

ALL_CLASSES: List[str] = SMOKE_TYPES + FALSE_POSITIVE_TYPES
CLASS_ID: Dict[str, int] = {name: idx for idx, name in enumerate(ALL_CLASSES)}


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


def build_file_basename(row: Dict[str, Any]) -> str:
    """
    Build base filename:
        pyronear-{organisation_name}-{camera_name}-{azimuth}-{recorded_at}
    where recorded_at is formatted as YYYY-MM-DDTHH-MM-SS.
    If azimuth is missing use 000.
    """
    org_raw = row.get("organisation_name", "unknown_org")
    cam_raw = row.get("camera_name", "unknown_camera")

    org = normalize_slug(str(org_raw))
    cam = normalize_slug(str(cam_raw))

    az = row.get("azimuth", None)
    az_str = f"{az:03d}" if isinstance(az, int) else "000"

    recorded_at_raw = row.get("recorded_at")
    if recorded_at_raw is None:
        raise ValueError("Missing recorded_at in export row")
    recorded_at_str = format_recorded_at(recorded_at_raw)

    return f"pyronear-{org}-{cam}-{az_str}-{recorded_at_str}"


def recorded_at_sort_key(row: Dict[str, Any]) -> Tuple[int, str]:
    """
    Sort key: (sequence_id, recorded_at_string)
    Uses format_recorded_at so ordering is chronological.
    """
    seq_id = row.get("sequence_id") or 0
    raw = row.get("recorded_at") or "1970-01-01T00:00:00"
    try:
        rec_str = format_recorded_at(raw)
    except Exception:
        rec_str = "1970-01-01T00-00-00"
    return int(seq_id), rec_str


def compute_sequence_types(rows: List[Dict[str, Any]]) -> Dict[int, List[str]]:
    """
    For each sequence, compute the set of seq_types present in sequences_bbox.
    seq_type is smoke_type if is_smoke is true,
    otherwise the first false_positive_type if present.
    """
    seq_types: Dict[int, set] = defaultdict(set)
    for row in rows:
        seq_id = row.get("sequence_id")
        if seq_id is None:
            continue
        seq_ann = row.get("sequence_annotation") or {}
        groups = seq_ann.get("sequences_bbox") or []
        for group in groups:
            is_smoke = group.get("is_smoke", False)
            smoke_type = group.get("smoke_type")
            fp_types = group.get("false_positive_types") or []

            if is_smoke and smoke_type:
                seq_type = smoke_type
            elif fp_types:
                seq_type = fp_types[0]
            else:
                continue

            if seq_type not in CLASS_ID:
                seq_type = "other"
            seq_types[int(seq_id)].add(seq_type)

    return {seq_id: sorted(types) for seq_id, types in seq_types.items()}


def extract_labels_for_detection(row: Dict[str, Any]) -> Dict[str, List[str]]:
    """
    From one export row, build:
      { seq_type: [ 'class_id x_center y_center width height', ... ] }

    seq_type is smoke_type if is_smoke is true,
    otherwise the first false_positive_type if present,
    otherwise "other".

    Only boxes whose detection_id matches row["detection_id"] are used.

    Boxes use normalized xyxyn coordinates [x1, y1, x2, y2].
    """
    detection_id = row.get("detection_id")
    seq_ann = row.get("sequence_annotation") or {}
    sequences_bbox = seq_ann.get("sequences_bbox") or []

    labels_by_type: Dict[str, List[str]] = {}

    for group in sequences_bbox:
        is_smoke = group.get("is_smoke", False)
        smoke_type = group.get("smoke_type")
        fp_types = group.get("false_positive_types") or []

        if is_smoke and smoke_type:
            seq_type = smoke_type
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

            line = (
                f"{class_id} "
                f"{x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"
            )
            labels_by_type.setdefault(seq_type, []).append(line)

    return labels_by_type


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

FOLDER_NAME_MAP: Dict[Tuple[str, int], str] = {}
BASE_DIR: Optional[Path] = None
TIMEOUT_G: int = 30
VERIFY_SSL_G: bool = False
HEADERS_G: Dict[str, str] = {}
SESSION: Optional[requests.Session] = None


def _init_worker(
    folder_name_map: Dict[Tuple[str, int], str],
    base_dir_str: str,
    timeout: int,
    verify_ssl: bool,
    headers: Dict[str, str],
) -> None:
    global FOLDER_NAME_MAP, BASE_DIR, TIMEOUT_G, VERIFY_SSL_G, HEADERS_G, SESSION
    FOLDER_NAME_MAP = folder_name_map
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
    seq_id_int: int = task["seq_id_int"]
    file_base: str = task["file_base"]
    image_url: str = task["image_url"]
    types_for_seq: List[str] = task["types_for_seq"]
    labels_by_type: Dict[str, List[str]] = task["labels_by_type"]

    try:
        session = _get_session()
        resp_img = session.get(image_url, timeout=TIMEOUT_G, stream=True)
        resp_img.raise_for_status()
        img_bytes = resp_img.content
    except Exception as exc:
        logging.warning("Failed to download %s: %s", image_url, exc)
        return 0, 0

    img_filename = f"{file_base}.jpg"
    label_filename = f"{file_base}.txt"

    images_written = 0
    labels_nonempty = 0

    for seq_type in types_for_seq:
        lines = labels_by_type.get(seq_type, [])

        key = (seq_type, seq_id_int)
        seq_folder_name = FOLDER_NAME_MAP.get(key, file_base)

        base = BASE_DIR / seq_type / seq_folder_name  # type: ignore[operator]
        img_dir = base / "images"
        label_dir = base / "labels"
        img_dir.mkdir(parents=True, exist_ok=True)
        label_dir.mkdir(parents=True, exist_ok=True)

        img_path = img_dir / img_filename
        label_path = label_dir / label_filename

        if not img_path.exists():
            with open(img_path, "wb") as f:
                f.write(img_bytes)
            images_written += 1

        with open(label_path, "w", encoding="utf-8") as f:
            if lines:
                f.write("\n".join(lines) + "\n")
        if lines:
            labels_nonempty += 1

    return images_written, labels_nonempty


def build_dataset(
    rows: List[Dict[str, Any]],
    root_dir: Path,
    timeout: int,
    verify_ssl: bool,
    headers: Dict[str, str],
    num_workers: int,
) -> None:
    """
    Build the dataset folder structure from the exported rows.

    All detections are included:
      images are always saved,
      labels are written from bboxes,
      if no bbox is present for a given type an empty txt file is created.

    For each sequence and seq_type, all images of the sequence are copied
    in that seq_type folder. Label content depends on the annotation
    for that detection and type.

    Processing is parallelized across worker processes and progress
    is tracked with a tqdm progress bar.
    """
    # sort rows by (sequence_id, recorded_at)
    rows_sorted = sorted(rows, key=recorded_at_sort_key)

    # compute sequence -> list of seq_types present in annotation
    seq_types_map = compute_sequence_types(rows_sorted)

    # Prepare folder name map and tasks
    folder_name_map: Dict[Tuple[str, int], str] = {}
    tasks: List[Dict[str, Any]] = []

    for row in rows_sorted:
        image_url = row.get("image_url")
        if not image_url:
            continue

        seq_id = row.get("sequence_id")
        detection_id = row.get("detection_id")
        if seq_id is None or detection_id is None:
            continue
        seq_id_int = int(seq_id)

        types_for_seq = seq_types_map.get(seq_id_int)
        if not types_for_seq:
            types_for_seq = ["no_label"]

        try:
            file_base = build_file_basename(row)
        except Exception as exc:
            logging.warning(
                "Could not build filename for detection %s: %s",
                detection_id,
                exc,
            )
            continue

        labels_by_type = extract_labels_for_detection(row)

        # record first file_base per (seq_type, seq_id) for folder naming
        for seq_type in types_for_seq:
            key = (seq_type, seq_id_int)
            if key not in folder_name_map:
                folder_name_map[key] = file_base

        tasks.append(
            {
                "seq_id_int": seq_id_int,
                "file_base": file_base,
                "image_url": image_url,
                "types_for_seq": types_for_seq,
                "labels_by_type": labels_by_type,
            }
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
        initargs=(folder_name_map, str(root_dir), timeout, verify_ssl, headers),
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

    build_dataset(
        rows=rows,
        root_dir=root_dir,
        timeout=args.timeout,
        verify_ssl=args.verify_ssl,
        headers=headers,
        num_workers=args.num_workers,
    )


if __name__ == "__main__":
    main()
