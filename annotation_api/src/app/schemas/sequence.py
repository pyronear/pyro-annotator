# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.


from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict

from app.models import SourceApi, AnnotationType, SmokeType
from app.schemas.annotation_validation import SequenceAnnotationData
from app.schemas.sequence_annotations import SequenceAnnotationRead

__all__ = [
    "AddObjectRequest",
    "AlertDetail",
    "AlertLane",
    "Azimuth",
    "ClassifyQueueItem",
    "LocalizationQueueItem",
    "LocalizationQueueLane",
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
                    "is_wildfire_alertapi": "wildfire_smoke",
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
                    "is_wildfire_alertapi": "other",
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
    is_wildfire_alertapi: Optional[AnnotationType] = Field(
        default=None,
        description="Classification from external API: 'wildfire_smoke' (confirmed wildfire), 'other_smoke' (non-wildfire smoke), 'other' (false positive or other detection)",
        examples=["wildfire_smoke", "other_smoke", "other", None],
    )
    organisation_name: str
    organisation_id: int
    platform_alert_id: Optional[int] = Field(
        default=None,
        description="Platform alert grouping id. Defaults server-side: decoded from a synthetic alert_api_id when the primary exists (platform sources), else alert_api_id.",
    )


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
    is_wildfire_alertapi: Optional[AnnotationType]
    organisation_name: str
    organisation_id: int
    platform_alert_id: int
    sequence_group_id: Optional[int] = None


class SequenceUpdateBboxAuto(BaseModel):
    algo_prediction: Optional[SequenceAnnotationData] = Field(default=None)


class SequenceUpdateBboxVerified(BaseModel):
    algo_prediction: Optional[SequenceAnnotationData] = Field(default=None)


class LocalizationQueueLane(BaseModel):
    """One object-sequence of an alert, as shown in the Localize queue."""

    sequence_id: int
    alert_api_id: int
    has_smoke: bool
    has_missed_smoke: bool
    is_unsure: bool
    processing_stage: str
    smoke_types: List[str]
    total_detections: int
    annotated_detections: int
    auto_annotated_at: Optional[datetime]


class LocalizationQueueItem(BaseModel):
    """One alert ready for smoke localization (queue row)."""

    source_api: SourceApi
    platform_alert_id: int
    camera_name: str
    organisation_name: str
    azimuth: Optional[int]
    recorded_at: datetime
    lanes: List[LocalizationQueueLane]


class ClassifyQueueItem(BaseModel):
    """One alert with at least one object awaiting classification (queue row)."""

    source_api: SourceApi
    platform_alert_id: int
    camera_name: str
    organisation_name: str
    azimuth: Optional[float] = None
    recorded_at: datetime
    is_wildfire_alertapi: Optional[AnnotationType] = None
    primary_sequence_id: int
    total_objects: int
    classified_objects: int


class AlertLane(BaseModel):
    """One object-sequence of an alert (lane in the detail view)."""

    sequence: SequenceRead
    annotation: Optional[SequenceAnnotationRead] = None


class AlertDetail(BaseModel):
    """All sibling lanes of one alert, ordered by alert_api_id."""

    source_api: SourceApi
    platform_alert_id: int
    camera_name: str
    organisation_name: str
    recorded_at: datetime
    lanes: List[AlertLane]


class AddObjectRequest(BaseModel):
    """Missed smoke: add a real object (spec: multi-object alert
    collocation, supersedes the carrier-lane pseudo-object). Spawns a new
    sibling lane for one plume the AI missed entirely."""

    source_api: SourceApi
    platform_alert_id: int
    smoke_type: SmokeType
