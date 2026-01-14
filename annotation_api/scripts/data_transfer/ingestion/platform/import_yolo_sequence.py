"""
Import a single YOLO sequence folder (images + labels) into the annotation API.

Expected layout:
  <sequence_dir>/
    images/
      pyronear-<org>-<camera>-<azimuth>-<recorded_at>.jpg
    labels/
      pyronear-<org>-<camera>-<azimuth>-<recorded_at>.txt

YOLO label format per line:
  class_id x_center y_center width height [confidence]
"""

from __future__ import annotations

import argparse
import logging
import re
import unicodedata
import zlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import requests
from dotenv import load_dotenv

from app.clients import annotation_api
from scripts.data_transfer.ingestion.platform.shared import get_annotation_credentials

load_dotenv()

SMOKE_TYPES = ["wildfire", "industrial", "other"]
FALSE_POSITIVE_TYPES = [
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
ALL_CLASSES = SMOKE_TYPES + FALSE_POSITIVE_TYPES

SOURCE_API_CHOICES = ["pyronear_french", "alert_wildfire", "api_cenia"]
SEQ_STAGE_CHOICES = [
    "imported",
    "ready_to_annotate",
    "under_annotation",
    "seq_annotation_done",
    "in_review",
    "needs_manual",
    "annotated",
]
ANNOTATION_TYPE_CHOICES = ["wildfire_smoke", "other_smoke", "other", "none"]

RECORDED_AT_RE = re.compile(r"-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$")


@dataclass
class ResolvedNames:
    organisation_id: int
    organisation_name: str
    camera_id: int
    camera_name: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import a YOLO sequence folder into the annotation API."
    )
    parser.add_argument(
        "--sequence-dir",
        required=True,
        help="Path to the sequence folder containing images/ and labels/.",
    )
    parser.add_argument(
        "--api-base",
        default="http://localhost:5050",
        help="Annotation API base URL (with or without /api/v1).",
    )
    parser.add_argument(
        "--username",
        default="",
        help="API username (defaults to MAIN_/LOCAL_ANNOTATION_LOGIN or ANNOTATOR_LOGIN).",
    )
    parser.add_argument(
        "--password",
        default="",
        help="API password (defaults to MAIN_/LOCAL_ANNOTATION_PASSWORD or ANNOTATOR_PASSWORD).",
    )
    parser.add_argument(
        "--alert-api-id",
        type=int,
        default=None,
        help="Sequence alert_api_id (required if you want a stable ID).",
    )
    parser.add_argument(
        "--source-api",
        choices=SOURCE_API_CHOICES,
        default="",
        help="Source API for the sequence.",
    )
    parser.add_argument(
        "--organisation-id",
        type=int,
        default=None,
        help="Organisation ID to use for the sequence.",
    )
    parser.add_argument(
        "--organisation-name",
        type=str,
        default="",
        help="Organisation name to use for the sequence.",
    )
    parser.add_argument(
        "--camera-id",
        type=int,
        default=None,
        help="Camera ID to use for the sequence.",
    )
    parser.add_argument(
        "--camera-name",
        type=str,
        default="",
        help="Camera name to use for the sequence.",
    )
    parser.add_argument(
        "--lat",
        type=float,
        default=None,
        help="Camera latitude for the sequence.",
    )
    parser.add_argument(
        "--lon",
        type=float,
        default=None,
        help="Camera longitude for the sequence.",
    )
    parser.add_argument(
        "--azimuth",
        type=int,
        default=None,
        help="Camera azimuth for the sequence (optional).",
    )
    parser.add_argument(
        "--is-wildfire-alertapi",
        choices=ANNOTATION_TYPE_CHOICES,
        default="none",
        help="Optional wildfire classification from external API.",
    )
    parser.add_argument(
        "--sequence-stage",
        choices=SEQ_STAGE_CHOICES,
        default="ready_to_annotate",
        help="Sequence annotation processing stage to set.",
    )
    parser.add_argument(
        "--has-missed-smoke",
        action="store_true",
        help="Set has_missed_smoke=true for the sequence annotation.",
    )
    parser.add_argument(
        "--is-unsure",
        action="store_true",
        help="Mark the sequence annotation as unsure.",
    )
    parser.add_argument(
        "--detection-alert-api-id-start",
        type=int,
        default=1,
        help="Starting alert_api_id for detections (incremented per image).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview actions without creating anything in the API.",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level.",
    )
    return parser.parse_args()


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="%(levelname)s - %(message)s",
    )


def normalize_base_url(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    if trimmed.endswith("/api/v1"):
        return trimmed[: -len("/api/v1")]
    return trimmed


def normalize_slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def parse_recorded_at(text: str) -> Optional[datetime]:
    match = RECORDED_AT_RE.search(text)
    if not match:
        return None
    raw = match.group(1)
    return datetime.strptime(raw, "%Y-%m-%dT%H-%M-%S")


def parse_name_parts(basename: str) -> Tuple[Optional[str], Optional[int], Optional[str]]:
    match = RECORDED_AT_RE.search(basename)
    if not match:
        return None, None, None
    recorded_at_str = match.group(1)
    prefix = basename[: match.start()]
    az_match = re.search(r"-(\d+)$", prefix)
    if not az_match:
        return None, None, recorded_at_str
    azimuth = int(az_match.group(1))
    rest = prefix[: az_match.start()]
    if rest.startswith("pyronear-"):
        rest = rest[len("pyronear-") :]
    return rest or None, azimuth, recorded_at_str


def split_org_camera(
    rest: str, org_slugs: Iterable[str], cam_slugs: Iterable[str]
) -> Tuple[Optional[str], Optional[str], List[Tuple[str, str]]]:
    tokens = rest.split("-")
    org_slug_set = set(org_slugs)
    cam_slug_set = set(cam_slugs)
    matches: List[Tuple[str, str]] = []
    for idx in range(1, len(tokens)):
        org_slug = "-".join(tokens[:idx])
        cam_slug = "-".join(tokens[idx:])
        if org_slug in org_slug_set and cam_slug in cam_slug_set:
            matches.append((org_slug, cam_slug))
    if len(matches) == 1:
        return matches[0][0], matches[0][1], matches
    return None, None, matches


def fetch_slug_maps(
    base_url: str, token: str
) -> Tuple[Dict[str, Dict], Dict[str, Dict]]:
    headers = {"Authorization": f"Bearer {token}"}
    orgs_url = f"{base_url}/api/v1/organizations/"
    cams_url = f"{base_url}/api/v1/cameras/"
    orgs_resp = requests.get(orgs_url, headers=headers, timeout=30)
    orgs_resp.raise_for_status()
    cams_resp = requests.get(cams_url, headers=headers, timeout=30)
    cams_resp.raise_for_status()
    orgs = orgs_resp.json()
    cams = cams_resp.json()

    org_map: Dict[str, Dict] = {}
    cam_map: Dict[str, Dict] = {}

    def add_slug(target: Dict[str, Dict], item: Dict) -> None:
        slug = normalize_slug(item["name"])
        if slug in target and target[slug]["id"] != item["id"]:
            logging.warning(
                "Ambiguous slug '%s' for ids %s and %s",
                slug,
                target[slug]["id"],
                item["id"],
            )
            target.pop(slug, None)
            return
        target[slug] = item

    for org in orgs:
        if "name" in org and "id" in org:
            add_slug(org_map, org)
    for cam in cams:
        if "name" in cam and "id" in cam:
            add_slug(cam_map, cam)
    return org_map, cam_map


def resolve_names(
    args: argparse.Namespace,
    rest_slug: Optional[str],
    org_map: Dict[str, Dict],
    cam_map: Dict[str, Dict],
) -> ResolvedNames:
    org_id = args.organisation_id
    org_name = args.organisation_name.strip()
    cam_id = args.camera_id
    cam_name = args.camera_name.strip()

    if not org_name and org_id is not None:
        for item in org_map.values():
            if item["id"] == org_id:
                org_name = item["name"]
                break

    if not cam_name and cam_id is not None:
        for item in cam_map.values():
            if item["id"] == cam_id:
                cam_name = item["name"]
                break

    if rest_slug and (not org_name or not cam_name or org_id is None or cam_id is None):
        org_slug, cam_slug, matches = split_org_camera(
            rest_slug, org_map.keys(), cam_map.keys()
        )
        if matches and (org_slug is None or cam_slug is None):
            raise ValueError(
                f"Ambiguous org/camera split for '{rest_slug}': {matches}. "
                "Provide --organisation-name/--camera-name (and ids)."
            )
        if org_slug and not org_name and org_slug in org_map:
            org_name = org_map[org_slug]["name"]
            org_id = org_map[org_slug]["id"]
        if cam_slug and not cam_name and cam_slug in cam_map:
            cam_name = cam_map[cam_slug]["name"]
            cam_id = cam_map[cam_slug]["id"]

    if not org_name or org_id is None:
        raise ValueError(
            "Missing organisation info. Provide --organisation-id and --organisation-name."
        )
    if not cam_name or cam_id is None:
        raise ValueError("Missing camera info. Provide --camera-id and --camera-name.")

    return ResolvedNames(
        organisation_id=org_id,
        organisation_name=org_name,
        camera_id=cam_id,
        camera_name=cam_name,
    )


def infer_from_existing_sequence(
    base_url: str,
    token: str,
    names: ResolvedNames,
) -> Dict[str, Optional[object]]:
    resp = annotation_api.list_sequences(
        base_url,
        token,
        camera_id=names.camera_id,
        organisation_id=names.organisation_id,
        page=1,
        size=1,
    )
    items = resp.get("items", [])
    if not items:
        return {}
    item = items[0]
    return {
        "source_api": item.get("source_api"),
        "lat": item.get("lat"),
        "lon": item.get("lon"),
        "is_wildfire_alertapi": item.get("is_wildfire_alertapi"),
    }


def read_yolo_labels(label_path: Path) -> List[Tuple[int, float, float, float, float]]:
    if not label_path.exists() or label_path.stat().st_size == 0:
        return []
    labels: List[Tuple[int, float, float, float, float]] = []
    for raw in label_path.read_text().splitlines():
        parts = raw.strip().split()
        if len(parts) < 5:
            continue
        try:
            class_id = int(parts[0])
            cx, cy, w, h = map(float, parts[1:5])
        except ValueError:
            continue
        labels.append((class_id, cx, cy, w, h))
    return labels


def yolo_to_xyxyn(cx: float, cy: float, w: float, h: float) -> Optional[List[float]]:
    x1 = cx - w / 2.0
    y1 = cy - h / 2.0
    x2 = cx + w / 2.0
    y2 = cy + h / 2.0
    xyxyn = [max(0.0, min(1.0, v)) for v in (x1, y1, x2, y2)]
    if xyxyn[0] >= xyxyn[2] or xyxyn[1] >= xyxyn[3]:
        return None
    return xyxyn


def generate_alert_api_id(sequence_dir: Path, source_api: str) -> int:
    seed = f"{source_api}:{sequence_dir.name}"
    return zlib.crc32(seed.encode("utf-8")) & 0x7FFFFFFF


def main() -> None:
    args = parse_args()
    setup_logging(args.loglevel)

    base_url = normalize_base_url(args.api_base)
    username = args.username
    password = args.password
    if not username or not password:
        username, password = get_annotation_credentials(base_url)

    sequence_dir = Path(args.sequence_dir)
    images_dir = sequence_dir / "images"
    labels_dir = sequence_dir / "labels"
    if not images_dir.exists():
        raise FileNotFoundError(f"Missing images folder: {images_dir}")
    if not labels_dir.exists():
        raise FileNotFoundError(f"Missing labels folder: {labels_dir}")

    image_paths = sorted(
        [p for p in images_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg"}]
    )
    if not image_paths:
        raise ValueError(f"No images found in {images_dir}")

    token = annotation_api.get_auth_token(base_url, username, password)

    rest_slug, az_from_name, _ = parse_name_parts(image_paths[0].stem)
    org_map, cam_map = fetch_slug_maps(base_url, token)
    names = resolve_names(args, rest_slug, org_map, cam_map)

    inferred = infer_from_existing_sequence(base_url, token, names)
    source_api = args.source_api or inferred.get("source_api")
    if not source_api:
        raise ValueError("Missing source_api. Provide --source-api.")

    lat = args.lat if args.lat is not None else inferred.get("lat")
    lon = args.lon if args.lon is not None else inferred.get("lon")
    if lat is None or lon is None:
        raise ValueError("Missing lat/lon. Provide --lat and --lon.")

    azimuth = args.azimuth if args.azimuth is not None else az_from_name
    wildfire_value = args.is_wildfire_alertapi
    if wildfire_value == "none":
        wildfire_value = inferred.get("is_wildfire_alertapi")

    alert_api_id = args.alert_api_id
    if alert_api_id is None:
        alert_api_id = generate_alert_api_id(sequence_dir, source_api)
        logging.warning(
            "Generated alert_api_id=%s from folder name. Pass --alert-api-id for a stable ID.",
            alert_api_id,
        )

    image_infos: List[Tuple[Path, datetime]] = []
    for image_path in image_paths:
        recorded_at = parse_recorded_at(image_path.stem)
        if not recorded_at:
            raise ValueError(f"Could not parse recorded_at from {image_path.name}")
        image_infos.append((image_path, recorded_at))

    image_infos.sort(key=lambda item: item[1])
    seq_recorded_at = image_infos[0][1]
    seq_last_seen_at = image_infos[-1][1]

    sequence_payload = {
        "source_api": source_api,
        "alert_api_id": alert_api_id,
        "camera_name": names.camera_name,
        "camera_id": names.camera_id,
        "organisation_name": names.organisation_name,
        "organisation_id": names.organisation_id,
        "is_wildfire_alertapi": wildfire_value,
        "lat": lat,
        "lon": lon,
        "azimuth": azimuth,
        "recorded_at": seq_recorded_at.isoformat(),
        "last_seen_at": seq_last_seen_at.isoformat(),
    }

    if args.dry_run:
        logging.info("[DRY-RUN] Would create sequence: %s", sequence_payload)
        return

    sequence = annotation_api.create_sequence(base_url, token, sequence_payload)
    seq_id = sequence["id"]
    logging.info("Created sequence id=%s (alert_api_id=%s)", seq_id, alert_api_id)

    bboxes_by_class: Dict[int, List[Dict]] = {}
    detection_alert_id = args.detection_alert_api_id_start

    create_detection_annotations = args.sequence_stage == "annotated"

    for image_path, recorded_at in image_infos:
        label_path = labels_dir / f"{image_path.stem}.txt"
        labels = read_yolo_labels(label_path)
        parsed_labels: List[Tuple[int, str, List[float]]] = []
        for class_id, cx, cy, w, h in labels:
            if class_id < 0 or class_id >= len(ALL_CLASSES):
                logging.warning(
                    "Skipping unknown class_id=%s in %s", class_id, label_path
                )
                continue
            xyxyn = yolo_to_xyxyn(cx, cy, w, h)
            if not xyxyn:
                continue
            parsed_labels.append((class_id, ALL_CLASSES[class_id], xyxyn))

        detection_payload = {
            "algo_predictions": {
                "predictions": [
                    {
                        "xyxyn": xyxyn,
                        "confidence": 1.0,
                        "class_name": class_name,
                    }
                    for class_id, class_name, xyxyn in parsed_labels
                ]
            },
            "alert_api_id": detection_alert_id,
            "sequence_id": seq_id,
            "recorded_at": recorded_at.isoformat(),
        }
        detection_alert_id += 1

        detection = annotation_api.create_detection(
            base_url,
            token,
            detection_payload,
            image_path.read_bytes(),
            image_path.name,
        )
        det_id = detection["id"]

        det_annotation_items: List[Dict] = []
        for class_id, class_name, xyxyn in parsed_labels:
            bboxes_by_class.setdefault(class_id, []).append(
                {"detection_id": det_id, "xyxyn": xyxyn}
            )
            if create_detection_annotations and class_id < len(SMOKE_TYPES):
                det_annotation_items.append(
                    {
                        "xyxyn": xyxyn,
                        "class_name": class_name,
                        "smoke_type": class_name,
                    }
                )

        if create_detection_annotations:
            annotation_api.create_detection_annotation(
                base_url,
                token,
                det_id,
                {"annotation": det_annotation_items},
                "annotated",
            )

    sequences_bbox: List[Dict] = []
    for class_id, bboxes in bboxes_by_class.items():
        if not bboxes:
            continue
        class_name = ALL_CLASSES[class_id]
        if class_id < len(SMOKE_TYPES):
            sequences_bbox.append(
                {
                    "is_smoke": True,
                    "smoke_type": class_name,
                    "false_positive_types": [],
                    "bboxes": bboxes,
                }
            )
        else:
            sequences_bbox.append(
                {
                    "is_smoke": False,
                    "false_positive_types": [class_name],
                    "bboxes": bboxes,
                }
            )

    annotation_payload = {
        "sequence_id": seq_id,
        "has_missed_smoke": args.has_missed_smoke,
        "is_unsure": args.is_unsure,
        "annotation": {"sequences_bbox": sequences_bbox},
        "processing_stage": args.sequence_stage,
    }
    annotation_api.create_sequence_annotation(base_url, token, annotation_payload)
    logging.info(
        "Created sequence annotation for sequence_id=%s with %s bbox groups",
        seq_id,
        len(sequences_bbox),
    )


if __name__ == "__main__":
    main()
