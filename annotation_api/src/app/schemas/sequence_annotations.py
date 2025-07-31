# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models import SequenceAnnotationProcessingStage
from app.schemas.annotation_validation import SequenceAnnotationData

__all__ = [
    "SequenceAnnotationCreate",
    "SequenceAnnotationRead",
    "SequenceAnnotationUpdate",
]


class SequenceAnnotationCreate(BaseModel):
    sequence_id: int
    has_missed_smoke: bool
    annotation: SequenceAnnotationData
    processing_stage: SequenceAnnotationProcessingStage
    created_at: datetime


class SequenceAnnotationRead(BaseModel):
    id: int
    sequence_id: int
    has_smoke: bool
    has_false_positives: bool
    false_positive_types: str
    has_missed_smoke: bool
    annotation: SequenceAnnotationData
    processing_stage: SequenceAnnotationProcessingStage
    created_at: datetime
    updated_at: Optional[datetime]


class SequenceAnnotationUpdate(BaseModel):
    has_missed_smoke: Optional[bool] = None
    annotation: Optional[SequenceAnnotationData] = None
    processing_stage: Optional[SequenceAnnotationProcessingStage] = None
    updated_at: Optional[datetime] = None
