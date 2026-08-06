# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Sequence-group assignment sweep.

Called by the periodic worker task (``assign_sequence_groups`` in
``app.worker``), the sole trigger since the manual endpoint was removed
(#181): it calls ``assign_ungrouped_sequences``. Membership only — the
sweep never writes labels or annotations; labels enter exclusively through
human actions (classify propagation, bulk group apply).
"""

import logging
from statistics import median
from typing import List, Optional

from pydantic import BaseModel
from sqlalchemy import select, text
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import engine
from app.models import Detection, Sequence, SequenceAnnotation, SequenceGroup
from app.services.alert_skip import alert_skip_exists_clause
from app.services.annotation_generation import box_iou

logger = logging.getLogger(__name__)

# Cross-sequence grouping threshold. Stricter than within-sequence clustering
# (IoU=0) because the precision cost of mis-grouping is much higher: a wrong
# match funnels human group labels (propagation, bulk apply) onto an
# unrelated event. R&D on 857 real sequences shows 0.3 captures natural
# smoke drift while filtering accidental tiny overlaps; 0.5 was too strict
# in practice.
GROUP_IOU_THRESHOLD = 0.3

# Fixed key for the Postgres advisory lock that serializes overlapping
# assignment sweeps. Arbitrary but must never change.
ASSIGN_ADVISORY_LOCK_KEY = 743210517


class AssignGroupsResult(BaseModel):
    """Outcome of one assignment run."""

    processed: int = 0
    new_groups: int = 0
    joined_existing: int = 0
    skipped_no_bbox: int = 0
    already_running: bool = False


def compute_representative_bbox(detections: List[Detection]) -> Optional[dict]:
    """Median bbox across the sequence's detections (only `bbox`, ignoring
    `others_bboxes` to match the auto-annotation flow). Returns
    `{"xyxyn": [...], "confidence": float}` or None if no usable boxes."""
    boxes: List[List[float]] = []
    confs: List[float] = []
    for det in detections:
        preds = (det.algo_predictions or {}).get("predictions") or []
        for pred in preds:
            xy = pred.get("xyxyn")
            if not xy or len(xy) != 4:
                continue
            x1, y1, x2, y2 = (float(v) for v in xy)
            if x1 > x2 or y1 > y2 or [x1, y1, x2, y2] == [0.0, 0.0, 0.0, 0.0]:
                continue
            boxes.append([x1, y1, x2, y2])
            confs.append(float(pred.get("confidence", 0.0)))
    if not boxes:
        return None
    # Clamp confidence to [0, 1]: upstream xyxyn validation guarantees
    # 0 ≤ coords ≤ 1, but `confidence` is unconstrained on detections, and
    # downstream RepresentativeBbox validates `0.0 <= confidence <= 1.0`.
    # A stray >1 (or <0) would make this group fail validation on read.
    median_conf = median(confs) if confs else 0.0
    median_conf = max(0.0, min(1.0, median_conf))
    return {
        "xyxyn": [
            median(b[0] for b in boxes),
            median(b[1] for b in boxes),
            median(b[2] for b in boxes),
            median(b[3] for b in boxes),
        ],
        "confidence": median_conf,
    }


async def assign_ungrouped_sequences(session: AsyncSession) -> AssignGroupsResult:
    """Assign every ungrouped, fully-imported sequence to a group (idempotent).

    Serialized via a Postgres session-level advisory lock held on a dedicated
    connection for the whole run. A run that finds the lock taken returns
    immediately with ``already_running=True``.
    """
    lock_conn = await engine.connect()
    try:
        # AUTOCOMMIT so the connection never sits "idle in transaction" for
        # the whole sweep (which idle_in_transaction_session_timeout would
        # kill, silently releasing the lock mid-run). Session-level advisory
        # locks are connection-scoped and unaffected by transaction state.
        await lock_conn.execution_options(isolation_level="AUTOCOMMIT")
        locked = (
            await lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": ASSIGN_ADVISORY_LOCK_KEY},
            )
        ).scalar_one()
        if not locked:
            logger.info("group assignment already running; skipping this run")
            return AssignGroupsResult(already_running=True)
        try:
            return await _run_assignment(session)
        finally:
            await lock_conn.execute(
                text("SELECT pg_advisory_unlock(:key)"),
                {"key": ASSIGN_ADVISORY_LOCK_KEY},
            )
    finally:
        await lock_conn.close()


async def _run_assignment(session: AsyncSession) -> AssignGroupsResult:
    """Single assignment pass — callers must hold the advisory lock.

    Greedy best-IoU match on the (camera_id, azimuth) key, threshold > 0.3,
    against unvalidated groups only (validation freezes membership).
    Membership is all this writes: the joining sequence's annotation is
    never touched, whatever the group's label."""
    unassigned_query = (
        select(Sequence)
        .where(
            Sequence.sequence_group_id.is_(None),
            # Don't re-attach sequences an annotator removed by hand.
            Sequence.is_group_excluded.is_(False),
            # Only fully-imported sequences: every import path creates the
            # SequenceAnnotation row strictly after all detections are
            # posted, so its absence means "still importing" (or a failed
            # import) — grouping such a sequence would freeze a bbox from
            # partial data.
            select(SequenceAnnotation.id)
            .where(SequenceAnnotation.sequence_id == Sequence.id)
            .exists(),
            # A parked alert's lane state never moves (spec:
            # alert-skip-escape-hatch): leave its sequences unassigned so a
            # later sweep picks them up unchanged once unskipped.
            ~alert_skip_exists_clause(Sequence),
        )
        .order_by(Sequence.recorded_at)
    )
    unassigned = (await session.execute(unassigned_query)).scalars().all()

    if not unassigned:
        return AssignGroupsResult()

    new_groups = 0
    joined_existing = 0
    skipped_no_bbox = 0

    for seq in unassigned:
        if seq.azimuth is None or seq.camera_id is None:
            skipped_no_bbox += 1
            continue

        det_query = (
            select(Detection)
            .where(Detection.sequence_id == seq.id)
            .order_by(Detection.recorded_at)
            .limit(10)
        )
        detections = (await session.execute(det_query)).scalars().all()
        repr_bbox = compute_representative_bbox(detections)
        if repr_bbox is None:
            skipped_no_bbox += 1
            continue

        candidates_query = select(SequenceGroup).where(
            SequenceGroup.camera_id == seq.camera_id,
            SequenceGroup.azimuth == seq.azimuth,
            # Validation freezes membership: the member set a human confirmed
            # must stay exactly what they confirmed. Later matches for the
            # same camera/azimuth open a fresh unvalidated group instead.
            SequenceGroup.is_validated.is_(False),
        )
        candidates = (await session.execute(candidates_query)).scalars().all()

        best_group: Optional[SequenceGroup] = None
        best_iou = GROUP_IOU_THRESHOLD
        for g in candidates:
            g_xy = g.representative_bbox.get("xyxyn") if g.representative_bbox else None
            if not g_xy:
                continue
            score = box_iou(repr_bbox["xyxyn"], g_xy)
            if score > best_iou:
                best_iou = score
                best_group = g

        if best_group is None:
            new_group = SequenceGroup(
                camera_id=seq.camera_id,
                azimuth=seq.azimuth,
                representative_bbox=repr_bbox,
            )
            session.add(new_group)
            await session.flush()
            seq.sequence_group_id = new_group.id
            new_groups += 1
            continue

        seq.sequence_group_id = best_group.id
        joined_existing += 1

    await session.commit()

    return AssignGroupsResult(
        processed=len(unassigned),
        new_groups=new_groups,
        joined_existing=joined_existing,
        skipped_no_bbox=skipped_no_bbox,
    )
