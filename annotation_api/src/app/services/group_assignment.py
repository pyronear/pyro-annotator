# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Sequence-group assignment sweep.

Shared by the manual endpoint (POST /sequence_groups/assign) and the periodic
worker task (``assign_sequence_groups`` in ``app.worker``): both call
``assign_ungrouped_sequences``.
"""

import logging
from statistics import median
from typing import List, Optional

from pydantic import BaseModel
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud import SequenceAnnotationCRUD
from app.models import (
    Detection,
    FalsePositiveType,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
    SequenceGroup,
    SmokeType,
)
from app.schemas.sequence_annotations import (
    SequenceAnnotationCreate,
    SequenceAnnotationUpdate,
)
from app.services.annotation_generation import (
    AnnotationGenerationService,
    apply_label_to_sequences_bbox,
    box_iou,
)

logger = logging.getLogger(__name__)

# Cross-sequence grouping threshold. Stricter than within-sequence clustering
# (IoU=0) because the precision cost of mis-grouping is much higher: a wrong
# match auto-applies inherited labels to an unrelated event. R&D on 857
# real sequences shows 0.3 captures natural smoke drift while filtering
# accidental tiny overlaps; 0.5 was too strict in practice.
GROUP_IOU_THRESHOLD = 0.3

# Fixed key for the Postgres advisory lock that serializes assignment runs
# (manual endpoint vs periodic worker sweep). Arbitrary but must never change.
ASSIGN_ADVISORY_LOCK_KEY = 743210517


class AssignGroupsResult(BaseModel):
    """Outcome of one assignment run."""

    processed: int = 0
    new_groups: int = 0
    joined_existing: int = 0
    inherited_annotations: int = 0
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


async def assign_ungrouped_sequences(
    session: AsyncSession, user_id: int
) -> AssignGroupsResult:
    """Assign every unassigned sequence to a sequence group (idempotent).

    Single-runner by design. Greedy best-IoU match on the
    (camera_id, azimuth) key, threshold > 0.3. Label inheritance is
    conditional — when the matched group already has a label, the joining
    sequence gets a SequenceAnnotation in SEQ_ANNOTATION_DONE with that
    label, attributed to ``user_id``. If a placeholder annotation is already
    there in stage READY_TO_ANNOTATE (the import script's default), it is
    upgraded in place; any later stage is left untouched.
    """
    sa_crud = SequenceAnnotationCRUD(session=session)

    unassigned_query = (
        select(Sequence)
        .where(
            Sequence.sequence_group_id.is_(None),
            # Don't re-attach sequences an annotator removed by hand.
            Sequence.is_group_excluded.is_(False),
        )
        .order_by(Sequence.recorded_at)
    )
    unassigned = (await session.execute(unassigned_query)).scalars().all()

    if not unassigned:
        return AssignGroupsResult()

    gen_service = AnnotationGenerationService(
        session=session,
        confidence_threshold=0.0,
        iou_threshold=0.0,
        min_cluster_size=1,
    )

    new_groups = 0
    joined_existing = 0
    inherited = 0
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

        if best_group.smoke_type is None and best_group.false_positive_type is None:
            continue

        # Inherit the group's label. import.py creates an empty
        # READY_TO_ANNOTATE annotation for every imported sequence, so we
        # need to UPDATE that placeholder rather than skip on existence.
        # Skip only if the existing annotation is past the placeholder
        # stage (the human / review pipeline has touched it).
        existing_anno = (
            await session.execute(
                select(SequenceAnnotation).where(
                    SequenceAnnotation.sequence_id == seq.id
                )
            )
        ).scalar_one_or_none()
        if existing_anno is not None and existing_anno.processing_stage != (
            SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
        ):
            continue

        generated = await gen_service.generate_annotation_for_sequence(seq.id)
        if generated is None:
            continue

        smoke_enum = SmokeType(best_group.smoke_type) if best_group.smoke_type else None
        fp_enum = (
            FalsePositiveType(best_group.false_positive_type)
            if best_group.false_positive_type
            else None
        )
        apply_label_to_sequences_bbox(
            generated, smoke_type=smoke_enum, false_positive_type=fp_enum
        )

        if existing_anno is None:
            await sa_crud.create(
                SequenceAnnotationCreate(
                    sequence_id=seq.id,
                    has_missed_smoke=False,
                    is_unsure=best_group.is_unsure,
                    annotation=generated,
                    processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
                ),
                user_id,
            )
        else:
            await sa_crud.update(
                existing_anno.id,
                SequenceAnnotationUpdate(
                    is_unsure=best_group.is_unsure,
                    annotation=generated,
                    processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
                ),
                user_id,
            )
        inherited += 1

    await session.commit()

    return AssignGroupsResult(
        processed=len(unassigned),
        new_groups=new_groups,
        joined_existing=joined_existing,
        inherited_annotations=inherited,
        skipped_no_bbox=skipped_no_bbox,
    )
