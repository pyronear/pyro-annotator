# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models import FalsePositiveType, SmokeType

__all__ = [
    "RepresentativeBbox",
    "SequenceGroupCreate",
    "SequenceGroupRead",
    "SequenceGroupListItem",
    "SequenceGroupMember",
    "SequenceGroupReadWithMembers",
    "SequenceGroupUpdate",
]


class RepresentativeBbox(BaseModel):
    """Geometry of a SequenceGroup's reference region. Not tied to any
    specific detection — derived from the first joining sequence at group
    creation, then frozen."""

    xyxyn: List[float] = Field(..., min_length=4, max_length=4)
    confidence: float = Field(..., ge=0.0, le=1.0)

    @field_validator("xyxyn")
    @classmethod
    def _validate_xyxyn(cls, v: List[float]) -> List[float]:
        x1, y1, x2, y2 = v
        for val in v:
            if not (0 <= val <= 1):
                raise ValueError("All xyxyn values must be between 0 and 1")
        if x1 > x2 or y1 > y2:
            raise ValueError("x1 <= x2 and y1 <= y2 required")
        if v == [0, 0, 0, 0]:
            raise ValueError("Null coordinates [0,0,0,0] are not allowed")
        return v


class SequenceGroupCreate(BaseModel):
    """Internal payload — created by the assign_groups script, not exposed."""

    camera_id: int
    azimuth: int
    representative_bbox: RepresentativeBbox


class SequenceGroupMember(BaseModel):
    """Lightweight projection of a sequence inside a group's members list.
    Includes the first detection's id + algo_predictions so the UI can
    render a thumbnail with bbox overlays without an extra round trip per
    member."""

    sequence_id: int
    alert_api_id: int
    camera_name: str
    recorded_at: datetime
    last_seen_at: datetime
    annotation_processing_stage: Optional[str] = Field(
        default=None,
        description=(
            "Stage of the SequenceAnnotation for this sequence, or null if "
            "no annotation row exists. READY_TO_ANNOTATE is the placeholder "
            "import.py creates; SEQ_ANNOTATION_DONE+ means a human has "
            "submitted labels."
        ),
    )
    first_detection_id: Optional[int] = None
    first_detection_algo_predictions: Optional[dict] = None


class SequenceGroupListItem(BaseModel):
    """Lightweight row for the groups list page; includes member_count to
    avoid an N+1 in the UI."""

    id: int
    camera_id: int
    camera_name: str
    azimuth: int
    representative_bbox: RepresentativeBbox
    smoke_type: Optional[SmokeType]
    false_positive_type: Optional[FalsePositiveType]
    is_unsure: bool
    is_validated: bool
    validated_at: Optional[datetime]
    # Username of the validating user, LEFT-JOINed in the list query.
    # None for legacy validations (pre-attribution) or deleted users.
    validated_by_username: Optional[str]
    labeled_at: Optional[datetime]
    created_at: datetime
    member_count: int


class SequenceGroupStats(BaseModel):
    """Aggregate counts over groups with 3 or more members — the same
    population the list endpoint returns, so UI counts match the list.
    A group is "labeled" when smoke_type or false_positive_type is set —
    the same predicate as the list endpoint's `labeled` filter."""

    total: int
    validated: int
    unvalidated: int
    labeled: int
    unlabeled: int


class SequenceGroupUpdate(BaseModel):
    """Patch the group's review state. For now, only `is_validated` is
    user-mutable here — labels are written by the per-sequence annotation
    flow (and propagated to the group when validated)."""

    is_validated: Optional[bool] = None


class SequenceGroupRead(BaseModel):
    id: int
    camera_id: int
    azimuth: int
    representative_bbox: RepresentativeBbox
    smoke_type: Optional[SmokeType]
    false_positive_type: Optional[FalsePositiveType]
    is_unsure: bool
    is_validated: bool
    validated_at: Optional[datetime]
    validated_by_user_id: Optional[int]
    labeled_at: Optional[datetime]
    labeled_by_user_id: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]


class SequenceGroupReadWithMembers(SequenceGroupRead):
    members: List[SequenceGroupMember]
