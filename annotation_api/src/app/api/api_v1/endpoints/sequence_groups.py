# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import UTC, datetime
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import asc, desc, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_sequence_group_crud
from app.crud import SequenceGroupCRUD
from app.db import get_session
from app.models import (
    Detection,
    Sequence,
    SequenceAnnotation,
    SequenceGroup,
    User,
)
from app.schemas.sequence_group import (
    SequenceGroupListItem,
    SequenceGroupMember,
    SequenceGroupRead,
    SequenceGroupReadWithMembers,
    SequenceGroupStats,
    SequenceGroupUpdate,
)

router = APIRouter()


class SequenceGroupOrderByField(str, Enum):
    """Valid fields for ordering sequence groups."""

    member_count = "member_count"
    camera_name = "camera_name"
    azimuth = "azimuth"
    created_at = "created_at"


class OrderDirection(str, Enum):
    """Valid directions for ordering."""

    asc = "asc"
    desc = "desc"


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
    order_by: SequenceGroupOrderByField = Query(
        SequenceGroupOrderByField.member_count, description="Order by field"
    ),
    order_direction: OrderDirection = Query(
        OrderDirection.desc, description="Order direction"
    ),
    params: Params = Depends(),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Page[SequenceGroupListItem]:
    # Small groups (fewer than 3 members) are excluded from the list because
    # the whole point of this page is to find groups worth bulk-annotating.
    member_count_subq = (
        select(
            Sequence.sequence_group_id.label("group_id"),
            func.count(Sequence.id).label("member_count"),
            # All members share one camera; min() just picks that value.
            func.min(Sequence.camera_name).label("camera_name"),
        )
        .where(Sequence.sequence_group_id.is_not(None))
        .group_by(Sequence.sequence_group_id)
        .having(func.count(Sequence.id) >= 3)
        .subquery()
    )
    order_columns = {
        SequenceGroupOrderByField.member_count: member_count_subq.c.member_count,
        SequenceGroupOrderByField.camera_name: member_count_subq.c.camera_name,
        SequenceGroupOrderByField.azimuth: SequenceGroup.azimuth,
        SequenceGroupOrderByField.created_at: SequenceGroup.created_at,
    }
    primary = order_columns[order_by]
    primary = desc(primary) if order_direction == OrderDirection.desc else asc(primary)
    query = (
        select(
            SequenceGroup.id,
            SequenceGroup.camera_id,
            SequenceGroup.azimuth,
            SequenceGroup.representative_bbox,
            SequenceGroup.smoke_type,
            SequenceGroup.false_positive_type,
            SequenceGroup.is_unsure,
            SequenceGroup.is_validated,
            SequenceGroup.labeled_at,
            SequenceGroup.created_at,
            member_count_subq.c.member_count,
            member_count_subq.c.camera_name,
        )
        # Inner-join so small groups (no row in the subquery) drop out.
        .join(member_count_subq, member_count_subq.c.group_id == SequenceGroup.id)
        # Caller-chosen primary sort; created_at/id remain as deterministic
        # tie-breakers so paginated offsets stay stable.
        .order_by(
            primary,
            desc(SequenceGroup.created_at),
            desc(SequenceGroup.id),
        )
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
    "/stats",
    response_model=SequenceGroupStats,
    summary="Aggregate counts of sequence groups (3+ members only)",
)
async def get_sequence_group_stats(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SequenceGroupStats:
    # Same 3+ member population as the list endpoint, so the sidebar badge
    # always matches what the groups page shows.
    member_count_subq = (
        select(Sequence.sequence_group_id.label("group_id"))
        .where(Sequence.sequence_group_id.is_not(None))
        .group_by(Sequence.sequence_group_id)
        .having(func.count(Sequence.id) >= 3)
        .subquery()
    )
    query = (
        select(
            func.count(SequenceGroup.id).label("total"),
            func.count(SequenceGroup.id)
            .filter(SequenceGroup.is_validated.is_(True))
            .label("validated"),
            func.count(SequenceGroup.id)
            .filter(
                (SequenceGroup.smoke_type.is_not(None))
                | (SequenceGroup.false_positive_type.is_not(None))
            )
            .label("labeled"),
        )
        .select_from(SequenceGroup)
        .join(member_count_subq, member_count_subq.c.group_id == SequenceGroup.id)
    )
    total, validated, labeled = (await session.exec(query)).one()
    return SequenceGroupStats(
        total=total,
        validated=validated,
        unvalidated=total - validated,
        labeled=labeled,
        unlabeled=total - labeled,
    )


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

    # First detection per sequence in the group (lowest recorded_at, then
    # lowest id as a deterministic tie-breaker so ties don't duplicate the
    # member row). Used for the UI thumbnail + bbox overlay.
    detection_rownum = (
        select(
            Detection.id.label("det_id"),
            Detection.sequence_id.label("seq_id"),
            Detection.algo_predictions.label("det_algo"),
            func.row_number()
            .over(
                partition_by=Detection.sequence_id,
                order_by=(Detection.recorded_at.asc(), Detection.id.asc()),
            )
            .label("rn"),
        )
        .join(Sequence, Sequence.id == Detection.sequence_id)
        .where(Sequence.sequence_group_id == group_id)
        .subquery()
    )
    first_det_join = (
        select(
            detection_rownum.c.seq_id,
            detection_rownum.c.det_id,
            detection_rownum.c.det_algo,
        )
        .where(detection_rownum.c.rn == 1)
        .subquery()
    )

    member_query = (
        select(
            Sequence.id,
            Sequence.alert_api_id,
            Sequence.camera_name,
            Sequence.recorded_at,
            Sequence.last_seen_at,
            SequenceAnnotation.processing_stage,
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
            annotation_processing_stage=(row[5].value if row[5] is not None else None),
            first_detection_id=row[6],
            first_detection_algo_predictions=row[7],
        )
        for row in result.all()
    ]

    base = SequenceGroupRead.model_validate(group, from_attributes=True)
    return SequenceGroupReadWithMembers(**base.model_dump(), members=members)


@router.patch(
    "/{group_id}",
    response_model=SequenceGroupRead,
    summary="Update group review state (currently: is_validated only)",
)
async def update_sequence_group(
    group_id: int = Path(..., ge=1),
    payload: SequenceGroupUpdate = Body(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SequenceGroupRead:
    group = await session.get(SequenceGroup, group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence group {group_id} not found",
        )
    changes = payload.model_dump(exclude_unset=True)
    if "is_validated" in changes:
        group.is_validated = changes["is_validated"]
    if changes:
        group.updated_at = datetime.now(UTC)
    session.add(group)
    await session.commit()
    await session.refresh(group)
    return SequenceGroupRead.model_validate(group, from_attributes=True)


@router.delete(
    "/{group_id}/members/{sequence_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a sequence from a group (does not delete the sequence)",
)
async def remove_member_from_group(
    group_id: int = Path(..., ge=1),
    sequence_id: int = Path(..., ge=1),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    seq = await session.get(Sequence, sequence_id)
    if seq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence {sequence_id} not found",
        )
    if seq.sequence_group_id != group_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(f"Sequence {sequence_id} is not a member of group {group_id}"),
        )
    seq.sequence_group_id = None
    # Sticky exclusion: prevents assign_groups from silently re-attaching
    # this sequence on the next import. The annotator has decided it's an
    # outlier for this camera/azimuth/region.
    seq.is_group_excluded = True
    session.add(seq)
    await session.commit()


@router.post(
    "/members/{sequence_id}/re-include",
    status_code=status.HTTP_204_NO_CONTENT,
    summary=(
        "Clear the manual is_group_excluded flag on a sequence so the next "
        "assign-groups run can put it back into a group. Recovery path "
        "after an accidental DELETE /members."
    ),
)
async def reinclude_sequence_in_grouping(
    sequence_id: int = Path(..., ge=1),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    seq = await session.get(Sequence, sequence_id)
    if seq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence {sequence_id} not found",
        )
    seq.is_group_excluded = False
    session.add(seq)
    await session.commit()
