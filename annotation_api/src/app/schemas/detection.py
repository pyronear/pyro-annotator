# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.annotation_validation import AlgoPredictions

__all__ = [
    "DetectionCreate",
    "DetectionCreateFromBucketKey",
    "DetectionCreateFromUrl",
    "DetectionRead",
    "DetectionUrl",
    "DetectionWithUrl",
]


class DetectionCreate(BaseModel):
    sequence_id: Optional[int]
    recorded_at: datetime
    alert_api_id: int
    bucket_key: str
    algo_predictions: AlgoPredictions
    others_bboxes: Optional[AlgoPredictions] = None
    auto_predictions: Optional[AlgoPredictions] = None


class DetectionCreateFromUrl(BaseModel):
    source_url: str
    sequence_id: Optional[int]
    recorded_at: datetime
    alert_api_id: int
    algo_predictions: AlgoPredictions
    others_bboxes: Optional[AlgoPredictions] = None
    auto_predictions: Optional[AlgoPredictions] = None


class DetectionCreateFromBucketKey(BaseModel):
    source_key: str = Field(
        ..., min_length=1, description="Object key within the source bucket"
    )
    sequence_id: int = Field(..., ge=1, description="Annotation API sequence id")
    recorded_at: datetime
    alert_api_id: int
    algo_predictions: AlgoPredictions
    others_bboxes: Optional[AlgoPredictions] = None
    auto_predictions: Optional[AlgoPredictions] = None


class DetectionRead(BaseModel):
    id: int
    sequence_id: Optional[int]
    recorded_at: datetime
    alert_api_id: int
    bucket_key: str
    algo_predictions: AlgoPredictions
    others_bboxes: Optional[AlgoPredictions] = None
    auto_predictions: Optional[AlgoPredictions] = None
    created_at: datetime


class DetectionUrl(BaseModel):
    url: str = Field(..., description="temporary URL to access the media content")


class DetectionWithUrl(DetectionCreate):
    url: str = Field(..., description="temporary URL to access the media content")
