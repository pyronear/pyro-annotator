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

from datetime import datetime
from typing import List, Set, Tuple

from .object_clustering import TrackedObject

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
