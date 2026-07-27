"""
Pull sequences annotated on remote API (processing_stage=seq_annotation_done), download images/labels,
save locally, and transition remote annotations to in_review.

Sequences imported by the predictor-split pipeline (one annotation sequence per detected object,
synthetic ``alert_api_id = base + platform_id * 1000 + object_index``) are merged back into a single
review folder so each frame is reviewed only once:

- Siblings (objects of the same platform alert) always share one folder; frames are deduplicated by
  ``recorded_at`` and each label file carries the union of every object's boxes on that frame.
- Alerts from the same camera with the same camera azimuth (re-fetched from the platform API) are
  chained into the same folder while the gap between two consecutive alerts is below
  ``--merge-gap-hours``. Without platform credentials, merging degrades to siblings-only.
- If any sibling of a platform alert is not annotated yet (imported/ready_to_annotate/
  under_annotation), the whole alert is deferred to a later pull so its frames are never pulled
  twice. Unsure or smoke-type-filtered siblings do not block their alert.

Each folder gets a ``manifest.json`` describing member sequences and the frame -> per-sequence
detection mapping; ``apply_fiftyone_review.py`` uses it to push review results back to every member.

``--max-sequences`` caps the number of merged folders (groups), not raw sequences.
"""

import argparse
import json
import logging
import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv

from app.clients import annotation_api

from . import client as platform_client
from .label_classes import CLASS_ID, fp_class_name, smoke_class_name
from .shared import getenv_with_fallback

load_dotenv()

# Stages that mean a sibling sequence still awaits sequence-level annotation.
UNLABELED_STAGES = {"imported", "ready_to_annotate", "under_annotation"}

# A cluster groups the object-split sequences of one platform alert:
# {"sid": Optional[int], "members": List[sequence dict]}
Cluster = Dict


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download seq_annotation_done sequences from remote API and mark in_review"
    )
    parser.add_argument(
        "--remote-api",
        type=str,
        default="https://annotationapi.pyronear.org",
        help="Remote annotation API base URL",
    )
    parser.add_argument(
        "--username",
        type=str,
        default=os.getenv(
            "MAIN_ANNOTATION_LOGIN", os.getenv("ANNOTATOR_LOGIN", "admin")
        ),
        help="Remote API username",
    )
    parser.add_argument(
        "--password",
        type=str,
        default=os.getenv(
            "MAIN_ANNOTATION_PASSWORD", os.getenv("ANNOTATOR_PASSWORD", "admin12345")
        ),
        help="Remote API password",
    )
    parser.add_argument(
        "--platform-api",
        type=str,
        default="https://alertapi.pyronear.org",
        help="Platform API base URL (used to re-fetch camera_azimuth for cross-alert merging)",
    )
    parser.add_argument(
        "--alert-id-base",
        type=int,
        default=1_000_000_000,
        help="Base offset of synthetic alert_api_ids created by the predictor-split import",
    )
    parser.add_argument(
        "--merge-gap-hours",
        type=float,
        default=2.0,
        help="Max gap between two alerts of the same camera/azimuth to merge them into one folder",
    )
    parser.add_argument(
        "--max-sequences",
        type=int,
        default=0,
        help="Optional cap on number of merged folders (groups) to pull (0 = all)",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=4,
        help="Number of worker threads for parallel downloads",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="outputs/seq_annotation_done",
        help="Directory to store images/labels",
    )
    parser.add_argument(
        "--skip-ssl-verify",
        action="store_true",
        help="Disable TLS verification (not recommended; use only if you trust the host)",
    )
    parser.add_argument(
        "--smoke-type",
        type=str,
        choices=["wildfire", "industrial", "other", "any", "empty"],
        default=None,
        help="Only pull sequences whose annotation smoke_types includes this value (use 'any' to include all smoke types, 'empty' to only include sequences with no smoke_types)",
    )
    parser.add_argument(
        "--no-stage-update",
        action="store_true",
        help="Skip the remote PATCH that transitions seq_annotation_done -> in_review (read-only export)",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )
    return parser.parse_args()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def parse_dt(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def to_yolo(bbox: List[float]) -> List[float]:
    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    w = x2 - x1
    h = y2 - y1
    return [cx, cy, w, h]


def write_labels(label_path: Path, boxes: List[Tuple[str, List[float]]]) -> None:
    """Write one YOLO line per (class_name, xyxyn) box; empty file when no boxes."""
    lines = []
    for class_name, bbox in boxes:
        cid = CLASS_ID.get(class_name, 0)
        yolo = to_yolo(bbox)
        lines.append(f"{cid} " + " ".join(f"{v:.6f}" for v in yolo))
    label_path.write_text("\n".join(lines) + ("\n" if lines else ""))


def collect_annotation_bboxes(annotation: Dict) -> Dict[int, List[Dict]]:
    """Collect every annotated object's boxes, keyed by detection_id.

    Each frame gets a list so that distinct objects sharing a frame are all
    exported (#140). Smoke objects keep their annotated smoke type;
    false-positive objects (is_smoke=False) are exported under their
    ``fp_<type>`` class instead of being coerced into a smoke label (#141).
    """
    bboxes: Dict[int, List[Dict]] = defaultdict(list)
    for sb in annotation.get("sequences_bbox", []):
        if sb.get("is_smoke"):
            class_names = [smoke_class_name(sb.get("smoke_type"))]
        else:
            # one label per assigned FP type so no classification is lost
            fp_types = sb.get("false_positive_types") or [None]
            class_names = list(dict.fromkeys(fp_class_name(t) for t in fp_types))
        for bbox in sb.get("bboxes", []):
            det_key = bbox.get("detection_id")
            if det_key is not None and bbox.get("xyxyn"):
                bboxes[det_key].extend(
                    {"xyxyn": bbox["xyxyn"], "class_name": class_name}
                    for class_name in class_names
                )
    return bboxes


def decode_platform_id(alert_api_id: Optional[int], base: int) -> Optional[int]:
    """Reverse the synthetic id scheme (alert_api_id = base + platform_id*1000 + object_index)."""
    if alert_api_id is None or alert_api_id < base:
        return None
    return (alert_api_id - base) // 1000


def _passes_smoke_filter(seq: Dict, smoke_type: Optional[str]) -> bool:
    """Apply the --smoke-type filter against the sequence's embedded annotation.

    Returns True if the sequence should be kept. Sequences without an embedded
    annotation are always kept (the worker will fetch one and decide).
    """
    if not smoke_type:
        return True
    ann = seq.get("annotation")
    if not ann:
        return True
    smoke_types = ann.get("smoke_types") or []
    if smoke_type == "empty":
        return not smoke_types
    if smoke_type == "any":
        return bool(smoke_types)
    return smoke_type in smoke_types


def fetch_sequences(
    remote_api: str,
    token: str,
    smoke_type: Optional[str] = None,
) -> List[Dict]:
    """Page through ALL seq_annotation_done sequences that pass the smoke-type
    filter. Everything must be fetched before grouping so siblings and chained
    alerts are never split across pulls (--max-sequences caps groups, not rows).

    Sequences whose annotation is marked as unsure (``is_unsure=True``) are
    excluded server-side and never pulled.
    """
    page = 1
    size = 100
    accepted: List[Dict] = []
    while True:
        resp = annotation_api.list_sequences(
            remote_api,
            token,
            processing_stage="seq_annotation_done",
            is_unsure=False,
            page=page,
            size=size,
            include_annotation=True,
        )
        items = resp.get("items", [])
        for item in items:
            if not _passes_smoke_filter(item, smoke_type):
                continue
            accepted.append(item)
        if page >= resp.get("pages", 1):
            break
        page += 1
    return accepted


def get_sequence_annotation(remote_api: str, token: str, seq_id: int) -> Optional[Dict]:
    resp = annotation_api.list_sequence_annotations(
        remote_api, token, sequence_id=seq_id, page=1, size=1
    )
    items = resp.get("items", []) if isinstance(resp, dict) else resp
    return items[0] if items else None


def list_all_detections(remote_api: str, token: str, seq_id: int) -> List[Dict]:
    page = 1
    detections: List[Dict] = []
    while True:
        resp = annotation_api.list_detections(
            remote_api, token, sequence_id=seq_id, page=page, size=100
        )
        detections.extend(resp.get("items", []))
        if page >= resp.get("pages", 1):
            break
        page += 1
    return detections


# --------------------------------------------------------------------------- #
# Grouping
# --------------------------------------------------------------------------- #
def build_clusters(sequences: List[Dict], base: int) -> List[Cluster]:
    """Bucket sequences by decoded platform alert id; legacy ids become singletons."""
    by_sid: Dict[int, List[Dict]] = defaultdict(list)
    clusters: List[Cluster] = []
    for seq in sequences:
        sid = decode_platform_id(seq.get("alert_api_id"), base)
        if sid is None:
            clusters.append({"sid": None, "members": [seq]})
        else:
            by_sid[sid].append(seq)
    clusters.extend({"sid": sid, "members": members} for sid, members in by_sid.items())
    return clusters


def cluster_start(cluster: Cluster) -> datetime:
    return min(parse_dt(s["recorded_at"]) for s in cluster["members"])


def cluster_end(cluster: Cluster) -> datetime:
    return max(
        parse_dt(s.get("last_seen_at") or s["recorded_at"]) for s in cluster["members"]
    )


def fetch_camera_azimuths(
    platform_api: str, sids: List[int]
) -> Dict[int, Optional[float]]:
    """Fetch camera_azimuth per platform alert id (the annotation API only stores
    the per-object cone azimuth, which differs between objects of one pose)."""
    login = getenv_with_fallback("ALERT_API_LOGIN")
    password = getenv_with_fallback("ALERT_API_PASSWORD")
    if not sids:
        return {}
    if not login or not password:
        logging.warning(
            "ALERT_API_LOGIN/ALERT_API_PASSWORD unset - cannot fetch camera_azimuth; "
            "merging siblings of the same alert only"
        )
        return {}
    try:
        token = platform_client.get_api_access_token(
            api_endpoint=platform_api, username=login, password=password
        )
    except Exception as exc:  # noqa: BLE001
        logging.warning(
            "Platform authentication failed (%s); merging siblings only", exc
        )
        return {}

    azimuths: Dict[int, Optional[float]] = {}
    for sid in sids:
        try:
            seq = platform_client.get_sequence(platform_api, sid, token)
            raw = seq.get("camera_azimuth")
            azimuths[sid] = float(raw) if raw is not None else None
        except Exception as exc:  # noqa: BLE001
            logging.warning("Failed to fetch platform sequence %s: %s", sid, exc)
            azimuths[sid] = None
    return azimuths


def chain_clusters(
    clusters: List[Cluster],
    azimuths: Dict[int, Optional[float]],
    max_gap: timedelta,
) -> List[List[Cluster]]:
    """Chain alert clusters sharing (camera_id, camera azimuth) while the gap
    between one alert's end and the next one's start stays under ``max_gap``.
    Clusters without a known camera azimuth stay alone."""
    groups: List[List[Cluster]] = []
    keyed: Dict[Tuple[int, int], List[Cluster]] = defaultdict(list)
    for cluster in clusters:
        sid = cluster["sid"]
        azimuth = azimuths.get(sid) if sid is not None else None
        if azimuth is None:
            groups.append([cluster])
            continue
        camera_id = cluster["members"][0]["camera_id"]
        keyed[(camera_id, int(round(azimuth)) % 360)].append(cluster)

    for chain_candidates in keyed.values():
        chain_candidates.sort(key=cluster_start)
        current = [chain_candidates[0]]
        current_end = cluster_end(chain_candidates[0])
        for nxt in chain_candidates[1:]:
            if cluster_start(nxt) - current_end <= max_gap:
                current.append(nxt)
                current_end = max(current_end, cluster_end(nxt))
            else:
                groups.append(current)
                current = [nxt]
                current_end = cluster_end(nxt)
        groups.append(current)

    groups.sort(key=lambda group: min(cluster_start(c) for c in group))
    return groups


def find_blocking_siblings(
    remote_api: str, token: str, cluster: Cluster, base: int
) -> List[str]:
    """Return descriptions of sibling sequences (same platform alert) that are
    still awaiting sequence annotation. Unsure or already-reviewed siblings do
    not block; neither do seq_annotation_done siblings excluded by the smoke
    filter (they belong to another review pipeline)."""
    sid = cluster["sid"]
    members = cluster["members"]
    known_ids = {s["id"] for s in members}
    camera_id = members[0]["camera_id"]
    window_start = cluster_start(cluster) - timedelta(hours=12)
    window_end = cluster_end(cluster) + timedelta(hours=12)

    blocking: List[str] = []
    page = 1
    while True:
        resp = annotation_api.list_sequences(
            remote_api,
            token,
            camera_id=camera_id,
            recorded_at_gte=window_start.isoformat(),
            recorded_at_lte=window_end.isoformat(),
            include_annotation=True,
            page=page,
            size=100,
        )
        for item in resp.get("items", []):
            if item["id"] in known_ids:
                continue
            if decode_platform_id(item.get("alert_api_id"), base) != sid:
                continue
            ann = item.get("annotation")
            if ann is None:
                blocking.append(f"sequence {item['id']} (no annotation)")
            elif ann.get("is_unsure"):
                logging.info(
                    "Alert %s: sibling sequence %s is unsure; pulling without it",
                    sid,
                    item["id"],
                )
            elif ann.get("processing_stage") in UNLABELED_STAGES:
                blocking.append(
                    f"sequence {item['id']} (stage {ann.get('processing_stage')})"
                )
            elif ann.get("processing_stage") == "seq_annotation_done":
                logging.info(
                    "Alert %s: sibling sequence %s filtered out (smoke types %s); pulling without it",
                    sid,
                    item["id"],
                    ann.get("smoke_types"),
                )
        if page >= resp.get("pages", 1):
            break
        page += 1
    return blocking


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=args.loglevel.upper(), format="%(levelname)s - %(message)s"
    )

    token = annotation_api.get_auth_token(args.remote_api, args.username, args.password)
    sequences = fetch_sequences(args.remote_api, token, smoke_type=args.smoke_type)
    logging.info(f"Found {len(sequences)} sequence(s) with stage seq_annotation_done")

    clusters = build_clusters(sequences, args.alert_id_base)
    sids = sorted({c["sid"] for c in clusters if c["sid"] is not None})
    azimuths = fetch_camera_azimuths(args.platform_api, sids)
    groups = chain_clusters(clusters, azimuths, timedelta(hours=args.merge_gap_hours))
    logging.info(
        "Grouped %s sequence(s) into %s folder(s)", len(sequences), len(groups)
    )

    # Defer alerts whose siblings are still being annotated, so their frames are
    # pulled once, complete, in a later run. Deferred groups do not count against
    # --max-sequences, so blocked groups never starve eligible ones.
    deferred = 0
    final_groups: List[List[Dict]] = []
    for group in groups:
        if args.max_sequences and len(final_groups) >= args.max_sequences:
            break
        kept: List[Dict] = []
        for cluster in group:
            if cluster["sid"] is not None:
                blocking = find_blocking_siblings(
                    args.remote_api, token, cluster, args.alert_id_base
                )
                if blocking:
                    deferred += 1
                    logging.info(
                        "Deferring alert %s: waiting for %s",
                        cluster["sid"],
                        "; ".join(blocking),
                    )
                    continue
            kept.extend(cluster["members"])
        if kept:
            final_groups.append(kept)
    if deferred:
        logging.info("Deferred %s incomplete alert(s) to a later pull", deferred)
    logging.info(
        "Pulling %s folder(s) with %s worker(s)", len(final_groups), args.max_workers
    )

    base = Path(args.output_dir)
    ensure_dir(base)

    def prepare_member(seq: Dict) -> Optional[Tuple[Dict, Dict, List[Dict]]]:
        """Fetch the member's annotation and detections; None if it must be skipped."""
        seq_id = seq["id"]
        ann = get_sequence_annotation(args.remote_api, token, seq_id)
        if not ann:
            logging.warning("No annotation for sequence %s, skipping", seq_id)
            return None

        # Re-check against the freshly fetched annotation; the page payload is only a prefilter.
        smoke_types = ann.get("smoke_types", [])
        if args.smoke_type == "empty":
            if smoke_types:
                logging.info(
                    "Skipping sequence %s (smoke_types=%s, expected empty)",
                    seq_id,
                    smoke_types,
                )
                return None
        elif args.smoke_type and args.smoke_type != "any":
            if args.smoke_type not in smoke_types:
                logging.info(
                    "Skipping sequence %s (smoke_types=%s not matching %s)",
                    seq_id,
                    smoke_types,
                    args.smoke_type,
                )
                return None
        elif args.smoke_type == "any":
            if not smoke_types:
                logging.info("Skipping sequence %s (no smoke_types)", seq_id)
                return None

        detections = list_all_detections(args.remote_api, token, seq_id)
        return (seq, ann, detections)

    def process_group(group: List[Dict]) -> Tuple[str, List[int]]:
        group = sorted(group, key=lambda s: s.get("alert_api_id") or s["id"])
        members = [m for m in (prepare_member(seq) for seq in group) if m]
        if not members:
            return ("filter_skip", [s["id"] for s in group])

        first_seq = members[0][0]
        seq_dir = base / f"seq_{first_seq.get('alert_api_id') or first_seq['id']}"
        img_dir = seq_dir / "images"
        lbl_dir = seq_dir / "labels"
        ensure_dir(img_dir)
        ensure_dir(lbl_dir)

        # Deduplicate frames across members by recorded_at: the first member seen
        # for a timestamp provides the canonical image; every member's box on that
        # frame lands in the same label file.
        frames: Dict[datetime, Dict] = {}
        boxes: Dict[str, List[Tuple[str, List[float]]]] = defaultdict(list)
        for seq, ann, detections in members:
            ann_bboxes = collect_annotation_bboxes(ann.get("annotation", {}))
            for det in detections:
                det_id = det["id"]
                frame = frames.setdefault(
                    parse_dt(det["recorded_at"]),
                    {
                        "canonical_det_id": det_id,
                        "filename": f"detection_{det_id}.jpg",
                        "recorded_at": det["recorded_at"],
                        "detections": {},
                    },
                )
                frame["detections"][seq["id"]] = det_id
                # Match by annotation detection_id (primary) then fall back to alert_api_id if present.
                frame_bboxes = ann_bboxes.get(det_id, [])
                if not frame_bboxes and det.get("alert_api_id") is not None:
                    frame_bboxes = ann_bboxes.get(det["alert_api_id"], [])
                for bbox in frame_bboxes:
                    boxes[frame["filename"]].append((bbox["class_name"], bbox["xyxyn"]))

        manifest_frames: Dict[str, Dict] = {}
        for key in sorted(frames):
            frame = frames[key]
            det_id = frame["canonical_det_id"]
            img_name = frame["filename"]
            try:
                image_url = annotation_api.get_detection_url(
                    args.remote_api, token, det_id
                )
                resp = requests.get(
                    image_url, timeout=30, verify=not args.skip_ssl_verify
                )
                resp.raise_for_status()
                (img_dir / img_name).write_bytes(resp.content)
            except Exception as exc:  # noqa: BLE001
                logging.error(
                    "Failed to download image for detection %s: %s", det_id, exc
                )
                continue
            write_labels(lbl_dir / img_name.replace(".jpg", ".txt"), boxes[img_name])
            manifest_frames[img_name] = {
                "recorded_at": frame["recorded_at"],
                "detections": {
                    str(seq_id): d_id for seq_id, d_id in frame["detections"].items()
                },
            }

        manifest = {
            "version": 1,
            "members": [
                {
                    "sequence_id": seq["id"],
                    "alert_api_id": seq.get("alert_api_id"),
                    "annotation_id": ann["id"],
                    "platform_sequence_id": decode_platform_id(
                        seq.get("alert_api_id"), args.alert_id_base
                    ),
                }
                for seq, ann, _ in members
            ],
            "frames": manifest_frames,
        }
        (seq_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

        # update remote stages to in_review only once the folder is fully written
        # (skipped in read-only export mode)
        status = "ok"
        if not args.no_stage_update:
            for seq, ann, _ in members:
                try:
                    annotation_api.update_sequence_annotation(
                        args.remote_api,
                        token,
                        ann["id"],
                        {"processing_stage": "in_review"},
                    )
                except Exception as exc:  # noqa: BLE001
                    logging.warning(
                        "Failed to set sequence %s to in_review: %s", seq["id"], exc
                    )
                    status = "stage_update_failed"

        return (status, [seq["id"] for seq, _, _ in members])

    results: Dict[str, int] = {
        "ok": 0,
        "filter_skip": 0,
        "stage_update_failed": 0,
        "errors": 0,
    }

    with ThreadPoolExecutor(max_workers=args.max_workers) as executor:
        future_map = {
            executor.submit(process_group, group): group for group in final_groups
        }
        for future in as_completed(future_map):
            try:
                status, _ = future.result()
                results[status] = results.get(status, 0) + 1
            except Exception as exc:  # noqa: BLE001
                results["errors"] = results.get("errors", 0) + 1
                group = future_map[future]
                logging.error(
                    "Unhandled error on group %s: %s",
                    [s.get("id") for s in group],
                    exc,
                )

    logging.info(
        "Finished: ok=%s, skipped_filter=%s, deferred=%s, stage_update_failed=%s, errors=%s",
        results["ok"],
        results["filter_skip"],
        deferred,
        results["stage_update_failed"],
        results["errors"],
    )


if __name__ == "__main__":
    main()
