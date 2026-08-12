# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import UTC, datetime
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import and_, asc, desc, func, not_, or_, select
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
    SequenceGroupThumbnail,
    SequenceGroupUpdate,
)
from app.services.annotators import human_annotators, merge_annotators
from app.services.storage import s3_service

router = APIRouter()


class SequenceGroupOrderByField(str, Enum):
    """Valid fields for ordering sequence groups."""

    member_count = "member_count"
    camera_name = "camera_name"
    azimuth = "azimuth"
    created_at = "created_at"
    temporal_model_score = "temporal_model_score"


class GroupLabelState(str, Enum):
    """A group's label state. The three values are mutually exclusive and
    together cover every group.

    `unsure` is a recorded annotator decision — the object was judged
    undecidable and the verdict fanned across the group without a label
    (`_propagate_to_group_if_validated`) — so it partitions *out* of
    `unlabeled` rather than sitting inside it as phantom to-do work."""

    labeled = "labeled"
    unlabeled = "unlabeled"
    unsure = "unsure"


def _label_state_clause(state: GroupLabelState):
    """SQL predicate for one label state. A group carrying both a label and
    is_unsure counts as labeled: the label is the stronger statement."""
    has_label = or_(
        SequenceGroup.smoke_type.is_not(None),
        SequenceGroup.false_positive_type.is_not(None),
    )
    if state is GroupLabelState.labeled:
        return has_label
    if state is GroupLabelState.unsure:
        return and_(not_(has_label), SequenceGroup.is_unsure.is_(True))
    return and_(not_(has_label), SequenceGroup.is_unsure.is_(False))


class OrderDirection(str, Enum):
    """Valid directions for ordering."""

    asc = "asc"
    desc = "desc"


def _crop_bbox(algo_predictions: Optional[dict]) -> Optional[list[float]]:
    """Union of a frame's valid prediction boxes, as a crop target for the
    list page's thumbnails. Mirrors the frontend's cropBox math on the
    group annotate page (union of valid boxes, else fall back)."""
    predictions = (algo_predictions or {}).get("predictions") or []
    boxes = [
        p["xyxyn"]
        for p in predictions
        if isinstance(p.get("xyxyn"), list)
        and len(p["xyxyn"]) == 4
        and p["xyxyn"][2] > p["xyxyn"][0]
        and p["xyxyn"][3] > p["xyxyn"][1]
    ]
    if not boxes:
        return None
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


async def _thumbnails_for_groups(
    session: AsyncSession, group_ids: list[int]
) -> dict[int, list[SequenceGroupThumbnail]]:
    """Up to 3 member previews per group: first / middle / last member by
    (recorded_at, id), among members that have at least one detection.
    One query for the whole page; presigning is a local computation."""
    if not group_ids:
        return {}

    # First detection per member sequence (lowest recorded_at, id as
    # tie-breaker) — same definition as the group detail endpoint.
    detection_rownum = (
        select(
            Detection.id.label("det_id"),
            Detection.sequence_id.label("seq_id"),
            Detection.bucket_key.label("bucket_key"),
            Detection.algo_predictions.label("det_algo"),
            func.row_number()
            .over(
                partition_by=Detection.sequence_id,
                order_by=(Detection.recorded_at.asc(), Detection.id.asc()),
            )
            .label("rn"),
        )
        .join(Sequence, Sequence.id == Detection.sequence_id)
        .where(Sequence.sequence_group_id.in_(group_ids))
        .subquery()
    )
    first_det = (
        select(
            detection_rownum.c.seq_id,
            detection_rownum.c.det_id,
            detection_rownum.c.bucket_key,
            detection_rownum.c.det_algo,
        )
        .where(detection_rownum.c.rn == 1)
        .subquery()
    )

    # Rank eligible members (inner join drops detection-less ones) per
    # group along the timeline.
    member_rank = (
        select(
            Sequence.sequence_group_id.label("group_id"),
            first_det.c.det_id,
            first_det.c.bucket_key,
            first_det.c.det_algo,
            func.row_number()
            .over(
                partition_by=Sequence.sequence_group_id,
                order_by=(Sequence.recorded_at.asc(), Sequence.id.asc()),
            )
            .label("rn"),
            func.count().over(partition_by=Sequence.sequence_group_id).label("cnt"),
        )
        .join(first_det, first_det.c.seq_id == Sequence.id)
        .where(Sequence.sequence_group_id.in_(group_ids))
        .subquery()
    )
    # First / middle / last ranks. `//` is floor division (SQLAlchemy 2.0
    # renders `/` on integers as TRUE division): cnt=5 → middle rank 3.
    # Overlapping ranks (cnt < 3) match a single row once — no duplicates.
    rows = await session.execute(
        select(
            member_rank.c.group_id,
            member_rank.c.det_id,
            member_rank.c.bucket_key,
            member_rank.c.det_algo,
        )
        .where(
            (member_rank.c.rn == 1)
            | (member_rank.c.rn == member_rank.c.cnt // 2 + 1)
            | (member_rank.c.rn == member_rank.c.cnt)
        )
        .order_by(member_rank.c.group_id, member_rank.c.rn)
    )

    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
    thumbnails: dict[int, list[SequenceGroupThumbnail]] = {}
    for group_id, det_id, bucket_key, det_algo in rows.all():
        thumbnails.setdefault(group_id, []).append(
            SequenceGroupThumbnail(
                detection_id=det_id,
                # generate_presigned_url, not get_public_url: presigning is
                # offline; get_public_url HEAD-checks S3 per key and 404s.
                url=bucket.generate_presigned_url(bucket_key),
                bbox_xyxyn=_crop_bbox(det_algo),
            )
        )
    return thumbnails


@router.get(
    "/",
    response_model=Page[SequenceGroupListItem],
    summary="List sequence groups (paginated, with member counts)",
)
async def list_sequence_groups(
    label_state: Optional[GroupLabelState] = Query(
        None,
        description=(
            "Filter by label state: 'labeled' (smoke or false-positive type "
            "set), 'unsure' (no label, marked undecidable), or 'unlabeled' "
            "(no label and not unsure). Omit for all three."
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
            func.min(Sequence.organisation_name).label("organisation_name"),
            # Only the alert's primary lane carries a score; siblings are
            # NULL. MAX skips NULLs, so this is the max over the object's
            # scored sightings without needing to join to find the primary.
            func.max(Sequence.temporal_model_score).label("temporal_model_score"),
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
        SequenceGroupOrderByField.temporal_model_score: (
            member_count_subq.c.temporal_model_score
        ),
    }
    primary = order_columns[order_by]
    primary = desc(primary) if order_direction == OrderDirection.desc else asc(primary)
    # Postgres orders NULLs FIRST on DESC. Unscored groups must sink to the
    # bottom either way, or a "most likely fires first" sort opens with the
    # objects nothing ever scored.
    primary = primary.nullslast()
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
            SequenceGroup.validated_at,
            User.username.label("validated_by_username"),
            SequenceGroup.labeled_at,
            SequenceGroup.created_at,
            member_count_subq.c.member_count,
            member_count_subq.c.camera_name,
            member_count_subq.c.organisation_name,
            member_count_subq.c.temporal_model_score,
        )
        # Inner-join so small groups (no row in the subquery) drop out.
        .join(member_count_subq, member_count_subq.c.group_id == SequenceGroup.id)
        # Reviewer attribution; LEFT JOIN because legacy validations and
        # unvalidated groups have no user.
        .outerjoin(User, User.id == SequenceGroup.validated_by_user_id)
        # Caller-chosen primary sort; created_at/id remain as deterministic
        # tie-breakers so paginated offsets stay stable.
        .order_by(
            primary,
            desc(SequenceGroup.created_at),
            desc(SequenceGroup.id),
        )
    )
    if label_state is not None:
        query = query.where(_label_state_clause(label_state))

    async def _hydrate(rows: list) -> list[SequenceGroupListItem]:
        group_ids = [r.id for r in rows]
        thumbnails = await _thumbnails_for_groups(session, group_ids)
        # Attribution is per member sequence, so it can't ride the grouped
        # list query — resolve it for the page's groups only.
        members = (
            await session.execute(
                select(Sequence.sequence_group_id, Sequence.id).where(
                    Sequence.sequence_group_id.in_(group_ids)
                )
            )
        ).all()
        members_by_group: dict[int, list[int]] = {}
        for group_id, sequence_id in members:
            members_by_group.setdefault(group_id, []).append(sequence_id)
        annotators_by_seq = await human_annotators(
            session, [sequence_id for _, sequence_id in members]
        )
        return [
            SequenceGroupListItem(
                **dict(r._mapping),
                thumbnails=thumbnails.get(r.id, []),
                annotators=merge_annotators(
                    annotators_by_seq, members_by_group.get(r.id, [])
                ),
            )
            for r in rows
        ]

    # `unique=False` is required because the row tuple includes the JSONB
    # `representative_bbox`, which is a dict and therefore not hashable.
    return await apaginate(session, query, params, unique=False, transformer=_hydrate)


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
            .filter(_label_state_clause(GroupLabelState.labeled))
            .label("labeled"),
            func.count(SequenceGroup.id)
            .filter(_label_state_clause(GroupLabelState.unsure))
            .label("unsure"),
        )
        .select_from(SequenceGroup)
        .join(member_count_subq, member_count_subq.c.group_id == SequenceGroup.id)
    )
    total, validated, labeled, unsure = (await session.exec(query)).one()
    return SequenceGroupStats(
        total=total,
        validated=validated,
        unvalidated=total - validated,
        labeled=labeled,
        unsure=unsure,
        unlabeled=total - labeled - unsure,
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
        new_value = changes["is_validated"]
        if new_value and not group.is_validated:
            # false→true: stamp the reviewer. Re-validating an already
            # validated group is a no-op — first reviewer stands.
            group.validated_by_user_id = current_user.id
            group.validated_at = datetime.now(UTC)
        elif not new_value:
            # true→false (or already false): never carry stale attribution.
            group.validated_by_user_id = None
            group.validated_at = None
        group.is_validated = new_value
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
