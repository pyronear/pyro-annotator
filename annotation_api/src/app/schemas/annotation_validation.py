# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models import FalsePositiveType, SmokeType

__all__ = [
    "BoundingBox",
    "SequenceBBox",
    "SequenceAnnotationData",
    "AlgoPrediction",
    "AlgoPredictions",
    "AnnotationOrigin",
    "Predictor",
    "AnnotationSource",
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

        # Reject null coordinates [0, 0, 0, 0] from failed detections
        if v == [0, 0, 0, 0]:
            raise ValueError("Null coordinates [0,0,0,0] are not allowed")

        # Reject zero-area bounding boxes (no area for cropping)
        if x1 == x2 or y1 == y2:
            raise ValueError(
                f"Zero-area bounding boxes are not allowed (width={x2-x1:.6f}, height={y2-y1:.6f})"
            )

        return v


class SequenceBBox(BaseModel):
    is_smoke: bool
    smoke_type: Optional[SmokeType] = Field(default=None)
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

        # Reject null coordinates [0, 0, 0, 0] from failed detections
        if v == [0, 0, 0, 0]:
            raise ValueError("Null coordinates [0,0,0,0] are not allowed")

        # Reject zero-area bounding boxes (no area for cropping)
        if x1 == x2 or y1 == y2:
            raise ValueError(
                f"Zero-area bounding boxes are not allowed (width={x2-x1:.6f}, height={y2-y1:.6f})"
            )

        return v


class AlgoPredictions(BaseModel):
    predictions: List[AlgoPrediction]


class AnnotationOrigin(str, Enum):
    """Who/what produced a detection-annotation box."""

    ENGINE = "engine"
    AUTO_ANNOTATION = "auto_annotation"
    HUMAN = "human"


class Predictor(BaseModel):
    """Identifies the model that produced an auto_annotation box."""

    name: str
    version: str


class AnnotationSource(BaseModel):
    """Provenance of a detection-annotation box.

    `predictor` is present iff `origin` is `auto_annotation`.
    """

    origin: AnnotationOrigin
    predictor: Optional[Predictor] = None

    @model_validator(mode="after")
    def validate_predictor_matches_origin(self) -> "AnnotationSource":
        has_predictor = self.predictor is not None
        is_auto = self.origin == AnnotationOrigin.AUTO_ANNOTATION
        if is_auto and not has_predictor:
            raise ValueError("predictor is required when origin is 'auto_annotation'")
        if not is_auto and has_predictor:
            raise ValueError(
                "predictor is only allowed when origin is 'auto_annotation'"
            )
        return self


class DetectionAnnotationItem(BaseModel):
    """One reviewed box on a detection: either a smoke box (smoke_type set)
    or a false-positive box kept for traceability (false_positive_type set)."""

    xyxyn: List[float] = Field(..., min_length=4, max_length=4)
    class_name: str
    smoke_type: Optional[SmokeType] = Field(default=None)
    false_positive_type: Optional[FalsePositiveType] = Field(default=None)
    source: AnnotationSource = Field(
        default_factory=lambda: AnnotationSource(origin=AnnotationOrigin.HUMAN)
    )

    @model_validator(mode="after")
    def validate_exactly_one_type(self) -> "DetectionAnnotationItem":
        if (self.smoke_type is None) == (self.false_positive_type is None):
            raise ValueError(
                "Exactly one of smoke_type or false_positive_type must be set"
            )
        return self

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

        # Reject null coordinates [0, 0, 0, 0] from failed detections
        if v == [0, 0, 0, 0]:
            raise ValueError("Null coordinates [0,0,0,0] are not allowed")

        # Reject zero-area bounding boxes (no area for cropping)
        if x1 == x2 or y1 == y2:
            raise ValueError(
                f"Zero-area bounding boxes are not allowed (width={x2-x1:.6f}, height={y2-y1:.6f})"
            )

        return v


class DetectionAnnotationData(BaseModel):
    annotation: List[DetectionAnnotationItem]
