# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict

from app.models import SequenceAnnotationProcessingStage
from app.schemas.annotation_validation import SequenceAnnotationData

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


class SequenceAnnotationRead(BaseModel):
    id: int
    sequence_id: int
    has_smoke: bool
    has_false_positives: bool
    false_positive_types: List[str]
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
