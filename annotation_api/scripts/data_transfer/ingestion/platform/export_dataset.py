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
  --api-base http://localhost:5050/api/v1 \
  --username admin --password admin12345 \
  --limit 5000 \
  --max-rows 50000 \
  --annotation-created-gte 2025-01-01T00:00:00Z \
  --annotation-created-lte 2025-01-31T23:59:59Z \
  --output-dir outputs/datasets \
  --loglevel info
"""

from __future__ import annotations

import argparse
import logging
import unicodedata
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


# ---------------------------------------------------------------------------
# CLI and utilities
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export YOLO style dataset from annotation API")
    parser.add_argument("--api-base", default="http://localhost:5050/api/v1", help="Base URL of the API")
    parser.add_argument("--username", default="admin", help="API username")
    parser.add_argument("--password", default="admin12345", help="API password")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP request timeout in seconds")
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
        help="Optional filter by source API, for example pyronear_french, alert_wildfire, api_cenia",
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
    return parser.parse_args()


def setup_logging(level: str) -> None:
    logging.basicConfig(level=getattr(logging, level.upper()), format="[%(levelname)s] %(message)s")


def default_dataset_root(base_output_dir: Optional[str] = None) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if base_output_dir:
        base = Path(base_output_dir)
    else:
        base = Path("outputs") / "datasets"
    root = base / f"dataset_exported_{timestamp}"
    root.mkdir(parents=True, exist_ok=True)
    return root


def get_token(api_base: str, username: str, password: str, timeout: int, verify_ssl: bool) -> str:
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

            line = f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"
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
        # respect max_rows if provided
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

        logging.info("Requesting page %s, offset=%s, limit=%s, params=%s", page_index, offset, effective_limit, params)
        resp = requests.get(url, headers=headers, params=params, timeout=timeout, verify=verify_ssl)
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
            # last page
            break

        offset += effective_limit
        page_index += 1

    logging.info("Total detections fetched from export endpoint: %s", len(all_rows))
    return all_rows


def build_dataset(
    rows: List[Dict[str, Any]],
    root_dir: Path,
    timeout: int,
    verify_ssl: bool,
    headers: Dict[str, str],
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
    """
    session = requests.Session()
    session.verify = verify_ssl
    session.headers.update(headers)

    # sort rows by (sequence_id, recorded_at)
    rows_sorted = sorted(rows, key=recorded_at_sort_key)

    # compute sequence -> list of seq_types present in annotation
    seq_types_map = compute_sequence_types(rows_sorted)

    num_images = 0
    num_labels = 0
    total_rows = len(rows_sorted)

    # map (seq_type, sequence_id) -> folder name (first file_base)
    folder_name_map: Dict[Tuple[str, int], str] = {}

    for idx, row in enumerate(rows_sorted, start=1):
        if idx % 100 == 0 or idx == total_rows:
            logging.info("Processing detection %s/%s", idx, total_rows)

        image_url = row.get("image_url")
        if not image_url:
            continue

        seq_id = row.get("sequence_id")
        detection_id = row.get("detection_id")
        if seq_id is None or detection_id is None:
            continue
        seq_id_int = int(seq_id)

        # for this sequence, which seq_types do we have
        types_for_seq = seq_types_map.get(seq_id_int)
        if not types_for_seq:
            # no annotated bbox at sequence level, put everything under "no_label"
            types_for_seq = ["no_label"]

        # base filename for this detection
        try:
            file_base = build_file_basename(row)
        except Exception as exc:
            logging.warning("Could not build filename for detection %s: %s", detection_id, exc)
            continue

        # labels of this detection per type
        labels_by_type = extract_labels_for_detection(row)

        # download image once for this detection
        try:
            resp_img = session.get(image_url, timeout=timeout, stream=True)
            resp_img.raise_for_status()
            img_bytes = resp_img.content
        except Exception as exc:
            logging.warning("Failed to download %s: %s", image_url, exc)
            continue

        img_filename = f"{file_base}.jpg"
        label_filename = f"{file_base}.txt"

        for seq_type in types_for_seq:
            # get lines for this detection and this type (can be empty)
            lines = labels_by_type.get(seq_type, [])

            key = (seq_type, seq_id_int)
            if key not in folder_name_map:
                folder_name_map[key] = file_base

            seq_folder_name = folder_name_map[key]

            base = root_dir / seq_type / seq_folder_name
            img_dir = base / "images"
            label_dir = base / "labels"
            img_dir.mkdir(parents=True, exist_ok=True)
            label_dir.mkdir(parents=True, exist_ok=True)

            img_path = img_dir / img_filename
            label_path = label_dir / label_filename

            if not img_path.exists():
                with open(img_path, "wb") as f:
                    f.write(img_bytes)
                num_images += 1

            # always create label file, possibly empty
            with open(label_path, "w", encoding="utf-8") as f:
                if lines:
                    f.write("\n".join(lines) + "\n")
            if lines:
                num_labels += 1

    logging.info("Dataset build complete")
    logging.info("Root directory: %s", root_dir)
    logging.info("Images saved: %s", num_images)
    logging.info("Label files written (non empty): %s", num_labels)


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
    headers = {"accept": "application/json", "Authorization": f"Bearer {token}"}

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
    )


if __name__ == "__main__":
    main()
