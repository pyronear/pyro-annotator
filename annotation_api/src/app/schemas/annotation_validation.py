# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models import FalsePositiveType, SmokeType

__all__ = [
    "BoundingBox",
    "SequenceBBox",
    "SequenceAnnotationData",
    "AlgoPrediction",
    "AlgoPredictions",
    "DetectionAnnotationItem",
    "DetectionAnnotationData",
]


class BoundingBox(BaseModel):
    detection_id: int
    xyxyn: List[float] = Field(..., min_length=4, max_length=4)

    @field_validator("xyxyn")
    @classmethod
    def validate_xyxyn(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("xyxyn must contain exactly 4 values")

        x1, y1, x2, y2 = v

        # Check values are between 0 and 1
        for val in v:
            if not (0 <= val <= 1):
                raise ValueError("All xyxyn values must be between 0 and 1")

        # Check constraints: x1 <= x2 and y1 <= y2
        if x1 > x2:
            raise ValueError("x1 must be <= x2")
        if y1 > y2:
            raise ValueError("y1 must be <= y2")

        return v


class SequenceBBox(BaseModel):
    is_smoke: bool
    gif_url_main: Optional[str] = None
    gif_url_crop: Optional[str] = None
    false_positive_types: List[FalsePositiveType] = Field(default_factory=list)
    bboxes: List[BoundingBox]


class SequenceAnnotationData(BaseModel):
    sequences_bbox: List[SequenceBBox]


class AlgoPrediction(BaseModel):
    xyxyn: List[float] = Field(..., min_length=4, max_length=4)
    confidence: float = Field(..., ge=0.0, le=1.0)
    class_name: str

    @field_validator("xyxyn")
    @classmethod
    def validate_xyxyn(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("xyxyn must contain exactly 4 values")

        x1, y1, x2, y2 = v

        # Check values are between 0 and 1
        for val in v:
            if not (0 <= val <= 1):
                raise ValueError("All xyxyn values must be between 0 and 1")

        # Check constraints: x1 <= x2 and y1 <= y2
        if x1 > x2:
            raise ValueError("x1 must be <= x2")
        if y1 > y2:
            raise ValueError("y1 must be <= y2")

        return v


class AlgoPredictions(BaseModel):
    predictions: List[AlgoPrediction]


class DetectionAnnotationItem(BaseModel):
    xyxyn: List[float] = Field(..., min_length=4, max_length=4)
    class_name: str
    smoke_type: SmokeType

    @field_validator("xyxyn")
    @classmethod
    def validate_xyxyn(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("xyxyn must contain exactly 4 values")

        x1, y1, x2, y2 = v

        # Check values are between 0 and 1
        for val in v:
            if not (0 <= val <= 1):
                raise ValueError("All xyxyn values must be between 0 and 1")

        # Check constraints: x1 <= x2 and y1 <= y2
        if x1 > x2:
            raise ValueError("x1 must be <= x2")
        if y1 > y2:
            raise ValueError("y1 must be <= y2")

        return v


class DetectionAnnotationData(BaseModel):
    annotation: List[DetectionAnnotationItem]
