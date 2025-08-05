# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models import SourceApi
from app.schemas.annotation_validation import SequenceAnnotationData

__all__ = [
    "Azimuth",
    "SequenceCreate",
    "SequenceRead",
    "SequenceUpdateBboxAuto",
    "SequenceUpdateBboxVerified",
]


class Azimuth(BaseModel):
    azimuth: float = Field(
        ...,
        gt=0,
        lt=360,
        description="angle between north and direction in degrees",
        json_schema_extra={"examples": [110]},
    )


class SequenceCreate(Azimuth):
    source_api: SourceApi
    alert_api_id: int
    recorded_at: datetime
    last_seen_at: datetime
    camera_name: str
    camera_id: int
    lat: float
    lon: float
    azimuth: Optional[int] = Field(default=None)
    is_wildfire_alertapi: Optional[bool] = Field(default=None)
    organisation_name: str
    organisation_id: int


class SequenceRead(Azimuth):
    id: int
    source_api: SourceApi
    alert_api_id: int
    created_at: datetime
    recorded_at: datetime
    last_seen_at: datetime
    camera_name: str
    camera_id: int
    lat: float
    lon: float
    azimuth: Optional[int]
    is_wildfire_alertapi: Optional[bool]
    organisation_name: str
    organisation_id: int


class SequenceUpdateBboxAuto(BaseModel):
    algo_prediction: Optional[SequenceAnnotationData] = Field(default=None)


class SequenceUpdateBboxVerified(BaseModel):
    algo_prediction: Optional[SequenceAnnotationData] = Field(default=None)
