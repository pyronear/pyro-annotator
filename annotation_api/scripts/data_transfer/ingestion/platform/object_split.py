"""
Split one platform sequence's records into one record group per smoke object.

The platform's detections already carry every object's boxes (`bbox` for the
tracked object, `others_bboxes` for its siblings — see issue #166). We cluster
all boxes across frames with `object_clustering.cluster_objects` (the offline
port of pyro-api's association rule) and emit, per object, rewritten copies of
the platform records. Because each copy carries the object's own
`sequence_id`, the existing posting pipeline
(`shared.post_records_to_annotation_api`) imports each object as its own
annotation sequence with no changes.

ID scheme: the PRIMARY object (the cluster with the most boxes sourced from
the platform's own `bbox` field; ties broken by earliest first detection)
keeps the raw platform sequence id so past plain imports dedup naturally via
the 409-skip. Siblings get
`alert_id_base + platform_sequence_id * 1000 + object_index`.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Set, Tuple

from app.schemas.annotation_validation import (
    BoundingBox,
    SequenceAnnotationData,
    SequenceBBox,
)
from .object_clustering import TrackedObject, cluster_objects, object_cone_azimuth
from .shared import group_records_by_sequence

DEFAULT_ALERT_ID_BASE = 1_000_000_000

# (frame_key, (x1, y1, x2, y2)) identifying one box on one frame
BoxKey = Tuple[str, Tuple[float, float, float, float]]


def _parse_dt(value: str) -> datetime:
    """Parse a platform ISO timestamp (tolerating a trailing Z)."""
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _frame_key(record: dict) -> str:
    return str(record["detection_id"])


def build_frames(sequence_records: List[dict]) -> Tuple[List[dict], Set[BoxKey]]:
    """Build `cluster_objects` frames plus the set of `bbox`-sourced box keys.

    Each frame merges the record's own `detection_bboxes` and its
    `detection_others_bboxes` — clustering ignores the source, but primary
    selection needs to know which boxes came from the platform's `bbox` field.
    """
    frames: List[dict] = []
    primary_keys: Set[BoxKey] = set()
    ordered = sorted(
        sequence_records, key=lambda r: _parse_dt(r["detection_created_at"])
    )
    for idx, record in enumerate(ordered):
        key = _frame_key(record)
        own = [list(b) for b in record.get("detection_bboxes") or [] if len(b) >= 5]
        others = [
            list(b) for b in record.get("detection_others_bboxes") or [] if len(b) >= 5
        ]
        for box in own:
            primary_keys.add((key, tuple(box[:4])))
        frames.append(
            {
                "frame_idx": idx,
                "recorded_at": _parse_dt(record["detection_created_at"]),
                "image_filename": key,
                "boxes": own + others,
            }
        )
    return frames, primary_keys


def select_primary_index(
    objects: List[TrackedObject], primary_keys: Set[BoxKey]
) -> int:
    """Index of the primary object: most `bbox`-sourced boxes, earliest start on ties."""

    def bbox_sourced_count(obj: TrackedObject) -> int:
        return sum(
            1
            for m in obj.members
            if (m.image_filename, tuple(m.box[:4])) in primary_keys
        )

    return min(
        range(len(objects)),
        key=lambda i: (-bbox_sourced_count(objects[i]), objects[i].started_at),
    )


def synthetic_alert_api_id(
    platform_sequence_id: int,
    object_index: int,
    alert_id_base: int = DEFAULT_ALERT_ID_BASE,
) -> int:
    return alert_id_base + platform_sequence_id * 1000 + object_index


@dataclass
class ObjectGroup:
    """One detected object, as rewritten platform records ready for posting."""

    object_index: int  # 0 = primary
    alert_api_id: int
    is_primary: bool
    is_fallback: bool
    records: List[dict]


def split_sequence_records(
    sequence_records: List[dict],
    *,
    alert_id_base: int = DEFAULT_ALERT_ID_BASE,
) -> List[ObjectGroup]:
    """Split one platform sequence's records into per-object groups.

    Falls back to a single unmodified group when clustering yields no
    qualifying object (sequence shorter than the spawn threshold, or boxless)
    so nothing is silently dropped.
    """
    platform_sid = sequence_records[0]["sequence_id"]
    frames, primary_keys = build_frames(sequence_records)
    objects = cluster_objects(frames)
    records_by_key = {_frame_key(r): r for r in sequence_records}

    if not objects:
        return [
            ObjectGroup(
                object_index=0,
                alert_api_id=platform_sid,
                is_primary=True,
                is_fallback=True,
                records=[dict(r) for r in sequence_records],
            )
        ]

    primary = select_primary_index(objects, primary_keys)
    ordered = [objects[primary]] + sorted(
        (o for i, o in enumerate(objects) if i != primary), key=lambda o: o.started_at
    )

    # frame_key -> [(object_position, box), ...] so each detection can carry
    # the OTHER objects' boxes on the same frame as others_bboxes.
    boxes_by_frame: Dict[str, List[Tuple[int, List[float]]]] = {}
    for pos, obj in enumerate(ordered):
        for member in obj.members:
            boxes_by_frame.setdefault(member.image_filename, []).append((pos, member.box))

    groups: List[ObjectGroup] = []
    for pos, obj in enumerate(ordered):
        own_by_frame: Dict[str, List[List[float]]] = {}
        for member in obj.members:
            own_by_frame.setdefault(member.image_filename, []).append(member.box)

        alert_id = (
            platform_sid if pos == 0 else synthetic_alert_api_id(platform_sid, pos, alert_id_base)
        )
        member_keys = sorted(own_by_frame, key=lambda k: _parse_dt(records_by_key[k]["detection_created_at"]))
        recorded = [records_by_key[k]["detection_created_at"] for k in member_keys]

        base_record = records_by_key[member_keys[0]]
        camera_azimuth = base_record.get("camera_azimuth")
        cone = (
            object_cone_azimuth(obj, camera_azimuth, base_record.get("camera_angle_of_view"))
            if camera_azimuth is not None
            else None
        )

        member_records: List[dict] = []
        for key in member_keys:
            record = dict(records_by_key[key])
            record["sequence_id"] = alert_id
            record["detection_bboxes"] = own_by_frame[key]
            record["detection_others_bboxes"] = [
                box for other_pos, box in boxes_by_frame.get(key, []) if other_pos != pos
            ]
            record["sequence_started_at"] = recorded[0]
            record["sequence_last_seen_at"] = recorded[-1]
            if cone is not None:
                record["camera_azimuth"] = cone
            member_records.append(record)

        groups.append(
            ObjectGroup(
                object_index=pos,
                alert_api_id=alert_id,
                is_primary=(pos == 0),
                is_fallback=False,
                records=member_records,
            )
        )
    return groups


def split_all_records(
    records: List[dict],
    *,
    alert_id_base: int = DEFAULT_ALERT_ID_BASE,
) -> Tuple[List[dict], dict]:
    """Split every platform sequence's records into per-object records.

    Returns the flat rewritten record list (feed it to the existing posting
    pipeline — each object group has its own sequence_id) plus summary stats.
    """
    stats = {"platform_sequences": 0, "objects": 0, "sibling_objects": 0, "fallback_sequences": 0}
    out: List[dict] = []
    for _sid, seq_records in group_records_by_sequence(records).items():
        groups = split_sequence_records(seq_records, alert_id_base=alert_id_base)
        stats["platform_sequences"] += 1
        stats["objects"] += len(groups)
        stats["sibling_objects"] += sum(1 for g in groups if not g.is_primary)
        stats["fallback_sequences"] += sum(1 for g in groups if g.is_fallback)
        for group in groups:
            out.extend(group.records)
    return out, stats


def build_single_track_annotation(detection_results: List[dict]) -> SequenceAnnotationData:
    """One `sequences_bbox` track from a posted object's detection results.

    Every detection here belongs to the same object (the split happened
    upstream), so the annotation is exactly one conservative is_smoke track —
    the server's empty-bbox auto-generation would re-cluster by IoU and can
    fragment a drifting object into several tracks, so we bypass it.

    Returns sequences_bbox=[] when nothing valid was posted (the server
    auto-generation then runs as a harmless no-op on empty predictions).
    """
    ordered = sorted(detection_results, key=lambda r: _parse_dt(r["recorded_at"]))
    bboxes = [
        BoundingBox(detection_id=r["annotation_detection_id"], xyxyn=[float(c) for c in xy[:4]])
        for r in ordered
        for xy in r.get("xyxyns", [])
        if xy[0] < xy[2] and xy[1] < xy[3]  # BoundingBox rejects zero-area boxes
    ]
    if not bboxes:
        return SequenceAnnotationData(sequences_bbox=[])
    return SequenceAnnotationData(
        sequences_bbox=[SequenceBBox(is_smoke=True, false_positive_types=[], bboxes=bboxes)]
    )
