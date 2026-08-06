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
    """Provenance of a committed detection-annotation box.

    Model predictions live immutably on the detection (``algo_predictions`` /
    ``auto_predictions``); a committed box is tagged with which layer it was
    accepted from (``engine``/``auto``) or ``human`` when hand-drawn or edited.
    """

    ENGINE = "engine"
    AUTO = "auto"
    HUMAN = "human"


class DetectionAnnotationItem(BaseModel):
    """One reviewed box on a detection: either a smoke box (smoke_type set)
    or a false-positive box kept for traceability (false_positive_type set)."""

    xyxyn: List[float] = Field(..., min_length=4, max_length=4)
    class_name: str
    smoke_type: Optional[SmokeType] = Field(default=None)
    false_positive_type: Optional[FalsePositiveType] = Field(default=None)
    origin: AnnotationOrigin = Field(default=AnnotationOrigin.HUMAN)

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

    @model_validator(mode="after")
    def validate_at_most_one_smoke_box(self) -> "DetectionAnnotationData":
        """One object, one box per frame.

        A plume that visually forks into two strands and rejoins is still one
        fire's smoke, boxed once. A persistent split is a second fire, so a
        second object. False-positive items are kept for traceability and are
        not capped.
        """
        smoke_count = sum(1 for item in self.annotation if item.smoke_type is not None)
        if smoke_count > 1:
            raise ValueError(
                f"At most one smoke box is allowed per detection annotation "
                f"(got {smoke_count}). A plume that forks into two strands and "
                "rejoins is one object — box it once. A persistent second plume "
                "is a separate object, with its own annotation track."
            )
        return self
