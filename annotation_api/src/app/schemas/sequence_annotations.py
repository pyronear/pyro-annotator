# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict, field_validator

from app.models import SequenceAnnotationProcessingStage
from app.schemas.annotation_validation import SequenceAnnotationData
from app.schemas.user import ContributorRead

__all__ = [
    "SequenceAnnotationCreate",
    "SequenceAnnotationRead",
    "SequenceAnnotationUpdate",
]


class SequenceAnnotationCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "sequence_id": 789,
                    "has_missed_smoke": False,
                    "annotation": {
                        "sequences_bbox": [
                            {
                                "is_smoke": True,
                                "false_positive_types": [],
                                "bboxes": [
                                    {"detection_id": 123, "xyxyn": [0.1, 0.2, 0.4, 0.6]}
                                ],
                            }
                        ]
                    },
                    "processing_stage": "ready_to_annotate",
                    "created_at": "2024-01-15T12:00:00",
                },
                {
                    "sequence_id": 890,
                    "has_missed_smoke": True,
                    "annotation": {
                        "sequences_bbox": [
                            {
                                "is_smoke": False,
                                "false_positive_types": ["high_cloud", "lens_flare"],
                                "bboxes": [],
                            }
                        ]
                    },
                    "processing_stage": "annotated",
                    "created_at": "2024-01-15T13:30:00",
                },
            ]
        }
    )

    sequence_id: int
    has_missed_smoke: bool
    is_unsure: bool = False
    annotation: SequenceAnnotationData
    processing_stage: SequenceAnnotationProcessingStage = Field(
        ...,
        description="Current processing stage in the sequence annotation workflow. Tracks progress from import through annotation completion.",
        examples=["imported", "ready_to_annotate", "annotated"],
    )
    
    # Optional configuration parameters for automatic annotation generation
    confidence_threshold: Optional[float] = Field(
        default=0.0,
        description="Minimum AI prediction confidence (0.0-1.0). Used when auto-generating annotations.",
        ge=0.0,
        le=1.0,
    )
    iou_threshold: Optional[float] = Field(
        default=0.3,
        description="Minimum IoU for clustering overlapping boxes (0.0-1.0). Used when auto-generating annotations.",
        ge=0.0,
        le=1.0,
    )
    min_cluster_size: Optional[int] = Field(
        default=1,
        description="Minimum number of boxes required per cluster. Used when auto-generating annotations.",
        ge=1,
    )


class SequenceAnnotationRead(BaseModel):
    id: int
    sequence_id: int
    has_smoke: bool
    has_false_positives: bool
    false_positive_types: List[str]
    smoke_types: List[str]
    has_missed_smoke: bool
    is_unsure: bool
    annotation: SequenceAnnotationData
    processing_stage: SequenceAnnotationProcessingStage = Field(
        ...,
        description="Current processing stage in the sequence annotation workflow. Tracks progress from import through annotation completion.",
        examples=["imported", "ready_to_annotate", "annotated"],
    )
    created_at: datetime
    updated_at: Optional[datetime]
    contributors: Optional[List[ContributorRead]] = Field(
        default=None,
        description="List of users who have contributed to this sequence annotation",
    )


class SequenceAnnotationUpdate(BaseModel):
    has_missed_smoke: Optional[bool] = None
    is_unsure: Optional[bool] = None
    annotation: Optional[SequenceAnnotationData] = None
    processing_stage: Optional[SequenceAnnotationProcessingStage] = Field(
        None,
        description="Updated processing stage in the sequence annotation workflow. Use to advance or modify the current stage.",
        examples=["ready_to_annotate", "annotated"],
    )
    updated_at: Optional[datetime] = None
    
    # Optional configuration parameters for automatic annotation generation
    confidence_threshold: Optional[float] = Field(
        default=None,
        description="Minimum AI prediction confidence (0.0-1.0). Used when auto-generating annotations.",
        ge=0.0,
        le=1.0,
    )
    iou_threshold: Optional[float] = Field(
        default=None,
        description="Minimum IoU for clustering overlapping boxes (0.0-1.0). Used when auto-generating annotations.",
        ge=0.0,
        le=1.0,
    )
    min_cluster_size: Optional[int] = Field(
        default=None,
        description="Minimum number of boxes required per cluster. Used when auto-generating annotations.",
        ge=1,
    )
