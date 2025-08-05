# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict

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
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "source_api": "pyronear_french",
                    "alert_api_id": 12345,
                    "recorded_at": "2024-01-15T14:30:00",
                    "last_seen_at": "2024-01-15T14:35:00",
                    "camera_name": "CAM_MOUNTAIN_01",
                    "camera_id": 101,
                    "lat": 43.6047,
                    "lon": 1.4442,
                    "azimuth": 125,
                    "is_wildfire_alertapi": True,
                    "organisation_name": "Pyronear France",
                    "organisation_id": 1,
                },
                {
                    "source_api": "alert_wildfire",
                    "alert_api_id": 67890,
                    "recorded_at": "2024-01-15T15:00:00",
                    "last_seen_at": "2024-01-15T15:05:00",
                    "camera_name": "ALERTCAM_FOREST_02",
                    "camera_id": 202,
                    "lat": 37.7749,
                    "lon": -122.4194,
                    "azimuth": 270,
                    "is_wildfire_alertapi": False,
                    "organisation_name": "AlertWildfire Network",
                    "organisation_id": 2,
                },
            ]
        }
    )

    source_api: SourceApi = Field(
        ...,
        description="External API source that provided this sequence data. Identifies the platform or service origin for tracking and processing.",
        examples=["pyronear_french", "alert_wildfire", "api_cenia"],
    )
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
    source_api: SourceApi = Field(
        ...,
        description="External API source that provided this sequence data. Identifies the platform or service origin for tracking and processing.",
        examples=["pyronear_french", "alert_wildfire", "api_cenia"],
    )
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
