# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from statistics import median
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_sequence_group_crud
from app.crud import SequenceAnnotationCRUD, SequenceGroupCRUD
from app.db import get_session
from app.models import (
    Detection,
    FalsePositiveType,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
    SequenceGroup,
    SmokeType,
    User,
)
from app.schemas.sequence_annotations import SequenceAnnotationCreate
from app.schemas.sequence_group import (
    SequenceGroupListItem,
    SequenceGroupMember,
    SequenceGroupRead,
    SequenceGroupReadWithMembers,
)
from app.services.annotation_generation import (
    AnnotationGenerationService,
    apply_label_to_sequences_bbox,
)

router = APIRouter()

# Cross-sequence grouping threshold. Stricter than within-sequence clustering
# (IoU=0) because the precision cost of mis-grouping is much higher: a wrong
# match auto-applies inherited labels to an unrelated event.
_GROUP_IOU_THRESHOLD = 0.5


@router.get(
    "/",
    response_model=Page[SequenceGroupListItem],
    summary="List sequence groups (paginated, with member counts)",
)
async def list_sequence_groups(
    labeled: Optional[bool] = Query(
        None,
        description=(
            "Filter by label presence: true = only labeled groups, "
            "false = only unlabeled, omit for both."
        ),
    ),
    params: Params = Depends(),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Page[SequenceGroupListItem]:
    member_count_subq = (
        select(
            Sequence.sequence_group_id.label("group_id"),
            func.count(Sequence.id).label("member_count"),
        )
        .where(Sequence.sequence_group_id.is_not(None))
        .group_by(Sequence.sequence_group_id)
        .subquery()
    )
    query = (
        select(
            SequenceGroup.id,
            SequenceGroup.camera_id,
            SequenceGroup.azimuth,
            SequenceGroup.representative_bbox,
            SequenceGroup.smoke_type,
            SequenceGroup.false_positive_type,
            SequenceGroup.is_unsure,
            SequenceGroup.labeled_at,
            SequenceGroup.created_at,
            func.coalesce(member_count_subq.c.member_count, 0).label("member_count"),
        )
        .outerjoin(
            member_count_subq, member_count_subq.c.group_id == SequenceGroup.id
        )
        .order_by(desc(SequenceGroup.created_at))
    )
    if labeled is True:
        query = query.where(
            (SequenceGroup.smoke_type.is_not(None))
            | (SequenceGroup.false_positive_type.is_not(None))
        )
    elif labeled is False:
        query = query.where(
            SequenceGroup.smoke_type.is_(None)
            & SequenceGroup.false_positive_type.is_(None)
        )

    # `unique=False` is required because the row tuple includes the JSONB
    # `representative_bbox`, which is a dict and therefore not hashable.
    return await apaginate(session, query, params, unique=False)


@router.get(
    "/{group_id}",
    response_model=SequenceGroupReadWithMembers,
    summary="Get a sequence group with its members",
)
async def get_sequence_group(
    group_id: int = Path(..., ge=1),
    groups: SequenceGroupCRUD = Depends(get_sequence_group_crud),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SequenceGroupReadWithMembers:
    group = await groups.get(group_id, strict=False)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence group {group_id} not found",
        )

    # First detection per sequence in the group (lowest recorded_at). Used
    # for the UI thumbnail + bbox overlay.
    first_det_subq = (
        select(
            Detection.sequence_id.label("seq_id"),
            func.min(Detection.recorded_at).label("first_recorded_at"),
        )
        .join(Sequence, Sequence.id == Detection.sequence_id)
        .where(Sequence.sequence_group_id == group_id)
        .group_by(Detection.sequence_id)
        .subquery()
    )
    first_det_join = (
        select(
            Detection.sequence_id.label("seq_id"),
            Detection.id.label("det_id"),
            Detection.algo_predictions.label("det_algo"),
        )
        .join(
            first_det_subq,
            (first_det_subq.c.seq_id == Detection.sequence_id)
            & (first_det_subq.c.first_recorded_at == Detection.recorded_at),
        )
        .subquery()
    )

    member_query = (
        select(
            Sequence.id,
            Sequence.alert_api_id,
            Sequence.camera_name,
            Sequence.recorded_at,
            Sequence.last_seen_at,
            SequenceAnnotation.id,
            first_det_join.c.det_id,
            first_det_join.c.det_algo,
        )
        .outerjoin(SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id)
        .outerjoin(first_det_join, first_det_join.c.seq_id == Sequence.id)
        .where(Sequence.sequence_group_id == group_id)
        .order_by(Sequence.recorded_at)
    )
    result = await session.execute(member_query)
    members = [
        SequenceGroupMember(
            sequence_id=row[0],
            alert_api_id=row[1],
            camera_name=row[2],
            recorded_at=row[3],
            last_seen_at=row[4],
            has_annotation=row[5] is not None,
            first_detection_id=row[6],
            first_detection_algo_predictions=row[7],
        )
        for row in result.all()
    ]

    base = SequenceGroupRead.model_validate(group, from_attributes=True)
    return SequenceGroupReadWithMembers(**base.model_dump(), members=members)


# -------------------- assign-groups --------------------


class AssignGroupsResponse(BaseModel):
    """Outcome of one /sequence_groups/assign run."""

    processed: int
    new_groups: int
    joined_existing: int
    inherited_annotations: int
    skipped_no_bbox: int


def _bbox_iou(a: List[float], b: List[float]) -> float:
    ix1 = max(a[0], b[0])
    iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2])
    iy2 = min(a[3], b[3])
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _compute_representative_bbox(detections: List[Detection]) -> Optional[dict]:
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
    return {
        "xyxyn": [
            median(b[0] for b in boxes),
            median(b[1] for b in boxes),
            median(b[2] for b in boxes),
            median(b[3] for b in boxes),
        ],
        "confidence": median(confs),
    }


@router.post(
    "/assign",
    response_model=AssignGroupsResponse,
    summary="Compute group membership for unassigned sequences (idempotent).",
)
async def assign_groups(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AssignGroupsResponse:
    """Single-threaded by design — meant to run after each platform import,
    not concurrently. Greedy best-IoU match on the (camera_id, azimuth) key,
    threshold > 0.5. New sequences inherit the matched group's label
    automatically (creates a SequenceAnnotation in SEQ_ANNOTATION_DONE).
    Sequences already assigned or already annotated are left untouched."""

    sa_crud = SequenceAnnotationCRUD(session=session)

    unassigned_query = (
        select(Sequence)
        .where(Sequence.sequence_group_id.is_(None))
        .order_by(Sequence.recorded_at)
    )
    unassigned = (await session.execute(unassigned_query)).scalars().all()

    if not unassigned:
        return AssignGroupsResponse(
            processed=0,
            new_groups=0,
            joined_existing=0,
            inherited_annotations=0,
            skipped_no_bbox=0,
        )

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
        repr_bbox = _compute_representative_bbox(detections)
        if repr_bbox is None:
            skipped_no_bbox += 1
            continue

        candidates_query = select(SequenceGroup).where(
            SequenceGroup.camera_id == seq.camera_id,
            SequenceGroup.azimuth == seq.azimuth,
        )
        candidates = (await session.execute(candidates_query)).scalars().all()

        best_group: Optional[SequenceGroup] = None
        best_iou = _GROUP_IOU_THRESHOLD
        for g in candidates:
            g_xy = g.representative_bbox.get("xyxyn") if g.representative_bbox else None
            if not g_xy:
                continue
            score = _bbox_iou(repr_bbox["xyxyn"], g_xy)
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

        # Inherit the group's label only if the sequence isn't already annotated.
        existing_anno = (
            await session.execute(
                select(SequenceAnnotation).where(
                    SequenceAnnotation.sequence_id == seq.id
                )
            )
        ).scalar_one_or_none()
        if existing_anno is not None:
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

        create_data = SequenceAnnotationCreate(
            sequence_id=seq.id,
            has_missed_smoke=False,
            is_unsure=best_group.is_unsure,
            annotation=generated,
            processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
        )
        await sa_crud.create(create_data, current_user.id)
        inherited += 1

    await session.commit()

    return AssignGroupsResponse(
        processed=len(unassigned),
        new_groups=new_groups,
        joined_existing=joined_existing,
        inherited_annotations=inherited,
        skipped_no_bbox=skipped_no_bbox,
    )
