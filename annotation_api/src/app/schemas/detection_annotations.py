# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import Dict, Optional

from pydantic import BaseModel

from app.models import DetectionAnnotationProcessingStage
from app.schemas.annotation_validation import DetectionAnnotationData

__all__ = [
    "DetectionAnnotationCreate",
    "DetectionAnnotationRead",
    "DetectionAnnotationUpdate",
]


class DetectionAnnotationCreate(BaseModel):
    detection_id: int
    annotation: DetectionAnnotationData
    processing_stages: DetectionAnnotationProcessingStage
    created_at: datetime


class DetectionAnnotationRead(BaseModel):
    id: int
    detection_id: int
    annotation: Dict  # Keep as Dict for read operations to maintain compatibility
    processing_stages: DetectionAnnotationProcessingStage
    created_at: datetime
    updated_at: Optional[datetime]


class DetectionAnnotationUpdate(BaseModel):
    annotation: Optional[DetectionAnnotationData] = None
    processing_stages: Optional[DetectionAnnotationProcessingStage] = None
    updated_at: Optional[datetime] = None
