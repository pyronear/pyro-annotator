# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import Dict, Optional

from pydantic import BaseModel, Field

__all__ = ["Azimuth", "SequenceCreate", "SequenceRead", "SequenceUpdateBboxAuto", "SequenceUpdateBboxVerified"]


class Azimuth(BaseModel):
    azimuth: float = Field(
        ...,
        gt=0,
        lt=360,
        description="angle between north and direction in degrees",
        json_schema_extra={"examples": [110]},
    )


class SequenceCreate(Azimuth):
    source_api: str
    alert_api_id: int
    # recorded_at: datetime = Field(nullable=False)
    last_seen_at: datetime
    camera_name: str
    camera_id: int
    lat: float
    lon: float
    azimuth: int
    is_wildfire_alertapi: Optional[bool]
    organisation_name: Optional[str]
    organisation_id: Optional[int]


class SequenceRead(Azimuth):
    id: int
    source_api: str
    alert_api_id: int
    created_at: datetime
    # recorded_at: datetime
    last_seen_at: datetime
    camera_name: str
    camera_id: int
    lat: float
    lon: float
    azimuth: int
    is_wildfire_alertapi: Optional[bool]
    organisation_name: Optional[str]
    organisation_id: Optional[int]


class SequenceUpdateBboxAuto(BaseModel):
    algo_prediction: Optional[Dict] = Field(default=None, sa_column_kwargs={"type_": "jsonb"})


class SequenceUpdateBboxVerified(BaseModel):
    algo_prediction: Optional[Dict] = Field(default=None, sa_column_kwargs={"type_": "jsonb"})
