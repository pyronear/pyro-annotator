"""
Split one alert sequence's records into one record group per smoke object.

The alert API's detections already carry every object's boxes (`bbox` for the
tracked object, `others_bboxes` for its siblings — see issue #166). We cluster
all boxes across frames with `object_clustering.cluster_objects` (the offline
port of pyro-api's association rule) and emit, per object, rewritten copies of
the alert API records. Because each copy carries the object's own
`sequence_id`, the existing posting pipeline
(`shared.post_records_to_annotation_api`) imports each object as its own
annotation sequence with no changes.

ID scheme: the PRIMARY object (the cluster with the most boxes sourced from
the alert API's own `bbox` field; ties broken by earliest first detection)
keeps the raw alert sequence id so past plain imports dedup naturally via
the 409-skip. Siblings get
`alert_id_base + alert_api_sequence_id * 1000 + object_index`. The alert API
sometimes materializes the same physical object as its own alert sequence
too (that sequence's own `bbox` boxes are this one's `others_bboxes`, and vice
versa); `split_all_records` cross-references sibling groups against every
other alert sequence's own boxes and drops a sibling that duplicates one,
but this only catches duplicates within a single run — sequences split across
a date-range boundary into different runs are not deduplicated.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Set, Tuple

from app.schemas.annotation_validation import (
    BoundingBox,
    SequenceAnnotationData,
    SequenceBBox,
    union_xyxyn,
)
from .object_clustering import TrackedObject, cluster_objects, object_cone_azimuth
from .shared import group_records_by_sequence

DEFAULT_ALERT_ID_BASE = 1_000_000_000

# (frame_key, (x1, y1, x2, y2)) identifying one box on one frame
BoxKey = Tuple[str, Tuple[float, float, float, float]]


def _parse_dt(value: str) -> datetime:
    """Parse an alert-api ISO timestamp (tolerating a trailing Z)."""
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _frame_key(record: dict) -> str:
    return str(record["detection_id"])


def build_frames(sequence_records: List[dict]) -> Tuple[List[dict], Set[BoxKey]]:
    """Build `cluster_objects` frames plus the set of `bbox`-sourced box keys.

    Each frame merges the record's own `detection_bboxes` and its
    `detection_others_bboxes` — clustering ignores the source, but primary
    selection needs to know which boxes came from the alert API's `bbox` field.
    A box present in both lists (same coordinates) is deduped to appear once,
    with the `own` copy taking precedence so it is still tagged primary.
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
        seen_coords = {tuple(box[:4]) for box in own}
        boxes = list(own)
        for box in others:
            coords = tuple(box[:4])
            if coords in seen_coords:
                continue
            seen_coords.add(coords)
            boxes.append(box)
        frames.append(
            {
                "frame_idx": idx,
                "recorded_at": _parse_dt(record["detection_created_at"]),
                "image_filename": key,
                "boxes": boxes,
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
    alert_api_sequence_id: int,
    object_index: int,
    alert_id_base: int = DEFAULT_ALERT_ID_BASE,
) -> int:
    return alert_id_base + alert_api_sequence_id * 1000 + object_index


def union_boxes(boxes: List[List[float]]) -> List[float]:
    """Enclosing box of several same-frame boxes of one object.

    Carries the group's highest confidence. A third of real engine boxes have
    confidence 0.0, so any confidence-weighted rule is degenerate on a large
    slice of the data; max is the best-evidence reading and is stable.
    """
    return [*union_xyxyn(boxes), max(b[4] for b in boxes)]


@dataclass
class ObjectGroup:
    """One detected object, as rewritten alert-api records ready for posting."""

    object_index: int  # 0 = primary
    alert_api_id: int
    is_primary: bool
    is_fallback: bool
    records: List[dict]
    # Frames on which this object's boxes were collapsed into one union box.
    same_frame_merges: int = 0


def split_sequence_records(
    sequence_records: List[dict],
    *,
    alert_id_base: int = DEFAULT_ALERT_ID_BASE,
) -> List[ObjectGroup]:
    """Split one alert sequence's records into per-object groups.

    Falls back to a single unmodified group when clustering yields no
    qualifying object (sequence shorter than the spawn threshold, or boxless)
    so nothing is silently dropped.
    """
    alert_api_sid = sequence_records[0]["sequence_id"]
    frames, primary_keys = build_frames(sequence_records)
    objects = cluster_objects(frames)
    records_by_key = {_frame_key(r): r for r in sequence_records}

    if not objects:
        return [
            ObjectGroup(
                object_index=0,
                alert_api_id=alert_api_sid,
                is_primary=True,
                is_fallback=True,
                records=[
                    {**r, "platform_alert_id": alert_api_sid} for r in sequence_records
                ],
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
            boxes_by_frame.setdefault(member.image_filename, []).append(
                (pos, member.box)
            )

    groups: List[ObjectGroup] = []
    for pos, obj in enumerate(ordered):
        own_by_frame: Dict[str, List[List[float]]] = {}
        for member in obj.members:
            own_by_frame.setdefault(member.image_filename, []).append(member.box)

        # One object, one box per frame. cluster_objects can attach two
        # same-frame boxes to one object (it flattens to one item per box and
        # never compares image_filename), but a plume the detector split into
        # two overlapping boxes is still one plume — boxed as the box enclosing
        # both, per the #286 modelling note. Deliberately here rather than in
        # cluster_objects: select_primary_index has already run above and
        # matches members by exact coordinates, so merging earlier would change
        # which lane keeps the alert's real alert_api_id.
        same_frame_merges = 0
        for frame_key, frame_boxes in own_by_frame.items():
            if len(frame_boxes) > 1:
                own_by_frame[frame_key] = [union_boxes(frame_boxes)]
                same_frame_merges += 1

        alert_id = (
            alert_api_sid
            if pos == 0
            else synthetic_alert_api_id(alert_api_sid, pos, alert_id_base)
        )
        member_keys = sorted(
            own_by_frame,
            key=lambda k: _parse_dt(records_by_key[k]["detection_created_at"]),
        )
        recorded = [records_by_key[k]["detection_created_at"] for k in member_keys]

        base_record = records_by_key[member_keys[0]]
        camera_azimuth = base_record.get("camera_azimuth")
        cone = (
            object_cone_azimuth(
                obj, camera_azimuth, base_record.get("camera_angle_of_view")
            )
            if camera_azimuth is not None
            else None
        )

        member_records: List[dict] = []
        for key in member_keys:
            record = dict(records_by_key[key])
            record["sequence_id"] = alert_id
            record["platform_alert_id"] = alert_api_sid
            record["detection_bboxes"] = own_by_frame[key]
            record["detection_others_bboxes"] = [
                box
                for other_pos, box in boxes_by_frame.get(key, [])
                if other_pos != pos
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
                same_frame_merges=same_frame_merges,
            )
        )
    return groups


# (bucket_key, (x1, y1, x2, y2) rounded to 4 decimals) identifying one box,
# shared across whichever alert sequences happen to carry it.
BucketBoxKey = Tuple[str, Tuple[float, float, float, float]]


def _own_box_keys(records: List[dict]) -> Set[BucketBoxKey]:
    """Box keys for a record group's own `detection_bboxes`, keyed by bucket key.

    Unlike `BoxKey` (keyed by `detection_id`, unique per alert sequence),
    this is keyed by `detection_bucket_key` so it stays comparable ACROSS
    sequences — the alert API reuses the same image bucket key for the same
    physical frame regardless of which sequence materializes it.
    """
    keys: Set[BucketBoxKey] = set()
    for record in records:
        bucket_key = record.get("detection_bucket_key")
        if not bucket_key:
            continue
        for box in record.get("detection_bboxes") or []:
            if len(box) >= 4:
                keys.add((bucket_key, tuple(round(c, 4) for c in box[:4])))
    return keys


def split_all_records(
    records: List[dict],
    *,
    alert_id_base: int = DEFAULT_ALERT_ID_BASE,
) -> Tuple[List[dict], dict]:
    """Split every alert sequence's records into per-object records.

    Returns the flat rewritten record list (feed it to the existing posting
    pipeline — each object group has its own sequence_id) plus summary stats.

    A sibling group is dropped (not included in the output) when its boxes
    match another alert sequence's own boxes — the alert API sometimes
    materializes the same object as its own sequence too, and without this
    check `split_sequence_records` would import it twice.
    """
    stats = {
        "alert_api_sequences": 0,
        "objects": 0,
        "sibling_objects": 0,
        "fallback_sequences": 0,
        "cross_deduped_siblings": 0,
        "same_frame_merges": 0,
    }

    grouped = group_records_by_sequence(records)

    # First pass: index every alert sequence's own bbox-sourced boxes so
    # siblings split out below can be checked against OTHER sequences' boxes.
    primary_keys_by_sid: Dict[int, Set[BucketBoxKey]] = {
        sid: _own_box_keys(seq_records) for sid, seq_records in grouped.items()
    }
    key_to_sids: Dict[BucketBoxKey, Set[int]] = defaultdict(set)
    for sid, keys in primary_keys_by_sid.items():
        for key in keys:
            key_to_sids[key].add(sid)

    out: List[dict] = []
    for _sid, seq_records in grouped.items():
        alert_api_sid = seq_records[0]["sequence_id"]
        try:
            groups = split_sequence_records(seq_records, alert_id_base=alert_id_base)
        except Exception as exc:
            logging.warning(
                f"Splitting alert sequence {alert_api_sid} failed, "
                f"importing it whole instead: {exc}"
            )
            groups = [
                ObjectGroup(
                    object_index=0,
                    alert_api_id=alert_api_sid,
                    is_primary=True,
                    is_fallback=True,
                    records=[dict(r) for r in seq_records],
                )
            ]
        stats["alert_api_sequences"] += 1
        stats["fallback_sequences"] += sum(1 for g in groups if g.is_fallback)
        stats["same_frame_merges"] += sum(g.same_frame_merges for g in groups)
        for group in groups:
            if not group.is_primary:
                matched_sid = None
                for key in _own_box_keys(group.records):
                    other_sids = key_to_sids.get(key, set()) - {alert_api_sid}
                    if other_sids:
                        matched_sid = next(iter(other_sids))
                        break
                if matched_sid is not None:
                    logging.info(
                        f"sibling object of seq {alert_api_sid} matches seq "
                        f"{matched_sid}'s own boxes — skipping (the alert API "
                        "already materialized it)"
                    )
                    stats["cross_deduped_siblings"] += 1
                    continue
            # Count only groups that are actually emitted, so the reported
            # object/sibling totals match what gets posted.
            stats["objects"] += 1
            if not group.is_primary:
                stats["sibling_objects"] += 1
            out.extend(group.records)
    return out, stats


def build_single_track_annotation(
    detection_results: List[dict],
) -> SequenceAnnotationData:
    """One `sequences_bbox` track from a posted object's detection results.

    Every detection here belongs to the same object (the split happened
    upstream), so the annotation is exactly one conservative is_smoke track —
    the server's empty-bbox auto-generation would re-cluster by IoU and can
    fragment a drifting object into several tracks, so we bypass it.

    Returns sequences_bbox=[] when nothing valid was posted (the server
    auto-generation then runs as a harmless no-op on empty predictions).
    """
    ordered = sorted(detection_results, key=lambda r: _parse_dt(r["recorded_at"]))
    # One object, one box per frame. split_sequence_records already unions an
    # object's same-frame boxes, but its fallback path passes records through
    # untouched, so a frame can still arrive with several boxes. This is one
    # conservative track either way, so those boxes are already declared to be
    # one object here — box them once.
    by_detection: Dict[int, List[List[float]]] = {}
    for r in ordered:
        for xy in r.get("xyxyns", []):
            if xy[0] < xy[2] and xy[1] < xy[3]:  # BoundingBox rejects zero-area boxes
                by_detection.setdefault(r["annotation_detection_id"], []).append(
                    [float(c) for c in xy[:4]]
                )
    bboxes = [
        BoundingBox(
            detection_id=detection_id,
            xyxyn=union_xyxyn(coords) if len(coords) > 1 else coords[0],
        )
        for detection_id, coords in by_detection.items()
    ]
    if not bboxes:
        return SequenceAnnotationData(sequences_bbox=[])
    return SequenceAnnotationData(
        sequences_bbox=[
            SequenceBBox(is_smoke=True, false_positive_types=[], bboxes=bboxes)
        ]
    )
