# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict

from app.models import DetectionAnnotationProcessingStage
from app.schemas.annotation_validation import DetectionAnnotationData

__all__ = [
    "DetectionAnnotationCreate",
    "DetectionAnnotationRead",
    "DetectionAnnotationUpdate",
]


class DetectionAnnotationCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "detection_id": 123,
                    "annotation": {
                        "smoke_type": "wildfire",
                        "confidence": 0.87,
                        "notes": "Clear smoke plume visible",
                    },
                    "processing_stage": "imported",
                },
                {
                    "detection_id": 456,
                    "annotation": {
                        "smoke_type": "industrial",
                        "confidence": 0.92,
                        "notes": "Factory smoke confirmed",
                    },
                    "processing_stage": "annotated",
                },
            ]
        }
    )

    detection_id: int
    annotation: DetectionAnnotationData
    processing_stage: DetectionAnnotationProcessingStage = Field(
        ...,
        description="Current processing stage in the detection annotation workflow. Tracks progress from initial import through visual checks to final annotation.",
        examples=["imported", "visual_check", "annotated"],
    )


class DetectionAnnotationRead(BaseModel):
    id: int
    detection_id: int
    annotation: DetectionAnnotationData
    processing_stage: DetectionAnnotationProcessingStage = Field(
        ...,
        description="Current processing stage in the detection annotation workflow. Tracks progress from initial import through visual checks to final annotation.",
        examples=["imported", "visual_check", "annotated"],
    )
    created_at: datetime
    updated_at: Optional[datetime]


class DetectionAnnotationUpdate(BaseModel):
    annotation: Optional[DetectionAnnotationData] = None
    processing_stage: Optional[DetectionAnnotationProcessingStage] = Field(
        None,
        description="Updated processing stage in the detection annotation workflow. Use to advance or modify the current stage.",
        examples=["visual_check", "bbox_annotation", "annotated"],
    )
