# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models import FalsePositiveType, SmokeType

__all__ = [
    "RepresentativeBbox",
    "SequenceGroupCreate",
    "SequenceGroupRead",
    "SequenceGroupMember",
    "SequenceGroupReadWithMembers",
    "SequenceGroupLabelUpdate",
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


class SequenceGroupLabelUpdate(BaseModel):
    """Labels written when an annotator bulk-confirms a group. Exactly one of
    smoke_type / false_positive_type must be set."""

    smoke_type: Optional[SmokeType] = None
    false_positive_type: Optional[FalsePositiveType] = None
    is_unsure: bool = False

    @model_validator(mode="after")
    def _exactly_one_label(self) -> "SequenceGroupLabelUpdate":
        smoke = self.smoke_type is not None
        fp = self.false_positive_type is not None
        if smoke == fp:  # both set or both unset
            raise ValueError(
                "exactly one of smoke_type or false_positive_type must be set"
            )
        return self


class SequenceGroupMember(BaseModel):
    """Lightweight projection of a sequence inside a group's members list."""

    sequence_id: int
    alert_api_id: int
    camera_name: str
    recorded_at: datetime
    last_seen_at: datetime
    has_annotation: bool = Field(
        description="True if a SequenceAnnotation already exists for this sequence"
    )


class SequenceGroupRead(BaseModel):
    id: int
    camera_id: int
    azimuth: int
    representative_bbox: RepresentativeBbox
    smoke_type: Optional[SmokeType]
    false_positive_type: Optional[FalsePositiveType]
    is_unsure: bool
    labeled_at: Optional[datetime]
    labeled_by_user_id: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]


class SequenceGroupReadWithMembers(SequenceGroupRead):
    members: List[SequenceGroupMember]
