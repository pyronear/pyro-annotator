"""
Offline port of pyro-api's detection -> sequence association logic.

The alert platform (`pyro-api`) turns a stream of per-frame bounding boxes into
one *sequence per detected object*: an incoming box joins an existing open
sequence when it spatially overlaps that sequence's most-recent box, otherwise a
brand-new sequence is spawned once enough overlapping un-assigned boxes have
accumulated within a short time window. We replay that exact rule offline over
the (already complete) set of predictor boxes for a single platform sequence so
that one platform sequence is split into one annotation-API sequence per object.

Reference implementation:
  - `pyro-api/src/app/api/api_v1/endpoints/detections.py`
      `_bboxes_overlap`            (intersection area > 0, no IoU threshold)
      candidate match / spawn loop (lines ~420-491)
  - `pyro-api/src/app/services/cones.py` `resolve_cone`
  - thresholds: `pyro-api/src/app/core/config.py`
      SEQUENCE_RELAXATION_SECONDS = 7200  (open-sequence match window)
      SEQUENCE_MIN_INTERVAL_SECONDS = 300 (spawn pool window)
      SEQUENCE_MIN_INTERVAL_DETS = 3      (min overlapping dets to spawn)

Offline note: all frames of one platform sequence already share a camera/pose,
so the per-camera filtering collapses; the 2h relaxation window is effectively
always satisfied, while the 5min/3-detection spawn rule still shapes how many
distinct objects are carved out. The thresholds remain parameters so the
behaviour can be tightened.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Sequence, Tuple

# Defaults mirror pyro-api/src/app/core/config.py
SEQUENCE_RELAXATION_SECONDS = 7200
SEQUENCE_MIN_INTERVAL_SECONDS = 300
SEQUENCE_MIN_INTERVAL_DETS = 3

# A box is [x1, y1, x2, y2, conf], normalised to [0, 1].
Box = Sequence[float]


@dataclass(eq=False)
class Detection:
    """A single predictor box on a single frame.

    `eq=False` keeps identity-based equality so the pending-pool removal
    (`d not in window`) compares object identity, not value — two value-equal
    boxes (same frame/timestamp/coords) are never confused.
    """

    frame_idx: int
    recorded_at: datetime
    image_filename: str
    box: List[float]


@dataclass
class TrackedObject:
    """An object = an ordered chain of overlapping detections across frames."""

    members: List[Detection] = field(default_factory=list)

    @property
    def last(self) -> Detection:
        return self.members[-1]

    @property
    def last_box(self) -> List[float]:
        return self.members[-1].box

    @property
    def last_seen(self) -> datetime:
        return self.members[-1].recorded_at

    @property
    def started_at(self) -> datetime:
        return self.members[0].recorded_at


def bboxes_overlap(left: Box, right: Box) -> bool:
    """True iff the two boxes have a strictly positive 2D intersection.

    Port of pyro-api `_bboxes_overlap` (detections.py:90) — note there is NO IoU
    threshold; any pixel overlap counts. The confidence element is ignored.
    """
    lx_min, ly_min, lx_max, ly_max = left[0], left[1], left[2], left[3]
    rx_min, ry_min, rx_max, ry_max = right[0], right[1], right[2], right[3]
    inter_w = min(lx_max, rx_max) - max(lx_min, rx_min)
    inter_h = min(ly_max, ry_max) - max(ly_min, ry_min)
    return inter_w > 0 and inter_h > 0


def resolve_cone(
    azimuth: float, boxes: Sequence[Box], aov: float
) -> Tuple[float, float]:
    """Port of pyro-api `cones.resolve_cone` (cones.py:11).

    Keys on the box with the largest `xmax` (``max(boxes, key=itemgetter(2))`` in
    the original — this is what the code does, despite the misleading docstring
    that says "most confident"). Returns ``(cone_azimuth, cone_angle)`` derived
    from the *camera* azimuth and angle-of-view.
    """
    best = max(boxes, key=lambda b: b[2])
    xmin, xmax = best[0], best[2]
    cone_azimuth = round(azimuth + aov * ((xmin + xmax) / 2 - 0.5), 1) % 360
    cone_angle = round(aov * (xmax - xmin), 1)
    return cone_azimuth, cone_angle


def _flatten(frames: Sequence[dict]) -> List[Detection]:
    """Flatten per-frame box lists into ordered single-box detections.

    `frames` is the predictor output for one sequence:
        [{"frame_idx": int, "recorded_at": datetime,
          "image_filename": str, "boxes": [[x1,y1,x2,y2,conf], ...]}, ...]
    Frames with no boxes contribute nothing. Items are ordered by
    (recorded_at, frame_idx) so the replay is temporal.
    """
    items: List[Detection] = []
    for frame in frames:
        for box in frame.get("boxes", []):
            if not box:
                continue
            items.append(
                Detection(
                    frame_idx=frame["frame_idx"],
                    recorded_at=frame["recorded_at"],
                    image_filename=frame["image_filename"],
                    box=list(box),
                )
            )
    items.sort(key=lambda d: (d.recorded_at, d.frame_idx))
    return items


def cluster_objects(
    frames: Sequence[dict],
    *,
    min_dets: int = SEQUENCE_MIN_INTERVAL_DETS,
    min_interval_seconds: int = SEQUENCE_MIN_INTERVAL_SECONDS,
    relaxation_seconds: int = SEQUENCE_RELAXATION_SECONDS,
) -> List[TrackedObject]:
    """Replay pyro-api's association rule offline; return one object per chain.

    For each detection (in temporal order):
      1. Try to attach it to an OPEN object whose last box overlaps, scanning
         open objects most-recently-seen first (pyro-api orders candidates by
         `last_seen_at` desc and breaks on the first overlap, detections.py:421).
      2. Otherwise, collect the un-assigned detections within the trailing
         `min_interval_seconds` window that overlap the current box — INCLUDING
         the current detection in the count (detections.py:448-472) — and spawn a
         new object when that set reaches `min_dets`. Below the threshold the
         detection stays pending and may seed/join a later object.

    Detections that never reach the spawn threshold are dropped, exactly as
    pyro-api never materialises a sequence for fewer than `min_dets` overlapping
    detections.
    """
    items = _flatten(frames)
    open_objects: List[TrackedObject] = []
    pending: List[Detection] = []

    for det in items:
        # 1. attach to an existing open object (most-recent-seen first)
        candidates = sorted(
            (
                obj
                for obj in open_objects
                if (det.recorded_at - obj.last_seen).total_seconds()
                <= relaxation_seconds
            ),
            key=lambda obj: obj.last_seen,
            reverse=True,
        )
        matched: Optional[TrackedObject] = None
        for obj in candidates:
            if bboxes_overlap(obj.last_box, det.box):
                matched = obj
                break

        if matched is not None:
            matched.members.append(det)
            continue

        # 2. otherwise, try to spawn a new object from overlapping pending dets
        window = [
            d
            for d in pending
            if (det.recorded_at - d.recorded_at).total_seconds() <= min_interval_seconds
            and bboxes_overlap(d.box, det.box)
        ]
        window.append(det)  # the current detection counts toward the threshold
        if len(window) >= min_dets:
            window.sort(key=lambda d: (d.recorded_at, d.frame_idx))
            open_objects.append(TrackedObject(members=window))
            pending = [d for d in pending if d not in window]
        else:
            pending.append(det)

    return open_objects


def object_cone_azimuth(
    obj: TrackedObject, camera_azimuth: float, angle_of_view: Optional[float]
) -> Optional[float]:
    """Per-object azimuth, derived from the *camera* azimuth (never the
    platform's `sequence_azimuth`), using the object's first detection box —
    mirroring pyro-api which keys the cone on `first_det.bbox` (detections.py:474).

    Returns None when angle-of-view is unavailable so the caller can fall back to
    the plain camera azimuth.
    """
    if angle_of_view is None:
        return None
    cone_azimuth, _ = resolve_cone(camera_azimuth, [obj.members[0].box], angle_of_view)
    return cone_azimuth
