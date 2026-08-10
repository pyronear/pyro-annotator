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
    "AlertSkipInfo",
    "AlertSkipRequest",
    "Azimuth",
    "ClassifyDoneItem",
    "ClassifyDoneLane",
    "ClassifyQueueItem",
    "LocalizationQueueItem",
    "LocalizationQueueLane",
    "MaterializeFrameRequest",
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
    temporal_model_score: Optional[float] = Field(
        default=None,
        description="Alert-API temporal-model smoke probability for this object. NULL when the platform never scored it — not the same as a low score.",
    )
    temporal_model_version: Optional[str] = Field(
        default=None,
        description="Model release that produced temporal_model_score (e.g. '0.1.0').",
    )
    temporal_api_version: Optional[str] = Field(
        default=None,
        description="Temporal API serving-code version (image tag) that produced temporal_model_score.",
    )


class SequenceTemporalScoreUpdate(BaseModel):
    """Natural-key targeted update of the platform temporal-model columns.

    All three value fields are required but nullable. "Absent" and "null" must
    not be conflated: a sibling lane's correct value is NULL, so a refresh has
    to write NULL explicitly rather than leave the field untouched.
    """

    source_api: SourceApi
    alert_api_id: int
    temporal_model_score: Optional[float]
    temporal_model_version: Optional[str] = Field(..., max_length=32)
    temporal_api_version: Optional[str] = Field(..., max_length=32)


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
    temporal_model_score: Optional[float] = None
    temporal_model_version: Optional[str] = None
    temporal_api_version: Optional[str] = None


class SequenceUpdateBboxAuto(BaseModel):
    algo_prediction: Optional[SequenceAnnotationData] = Field(default=None)


class SequenceUpdateBboxVerified(BaseModel):
    algo_prediction: Optional[SequenceAnnotationData] = Field(default=None)


class AlertSkipInfo(BaseModel):
    """Skip metadata carried on skipped queue rows and returned by skip
    (docs/specs/2026-08-05-alert-skip-escape-hatch-design.md)."""

    skipped_at: datetime
    skipped_by: Optional[str] = None
    note: Optional[str] = None


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
    # The alert's platform temporal-model score: MAX over its lanes, which is
    # exactly the primary lane's value because siblings are NULL (see #364).
    temporal_model_score: Optional[float] = None
    lanes: List[LocalizationQueueLane]
    # Present only on skipped=true queue rows.
    skip: Optional[AlertSkipInfo] = None


class LocalizeDoneQueueItem(BaseModel):
    """One alert with at least one localized (ANNOTATED, rule-matching) smoke
    lane (localize-done queue row). Mirrors LocalizationQueueItem."""

    source_api: SourceApi
    platform_alert_id: int
    camera_name: str
    organisation_name: str
    azimuth: Optional[int]
    recorded_at: datetime
    # The alert's platform temporal-model score: MAX over its lanes, which is
    # exactly the primary lane's value because siblings are NULL (see #364).
    temporal_model_score: Optional[float] = None
    lanes: List[LocalizationQueueLane]
    annotators: List[str] = []


class ClassifyQueueItem(BaseModel):
    """One alert with at least one object awaiting classification (queue row)."""

    source_api: SourceApi
    platform_alert_id: int
    camera_name: str
    organisation_name: str
    azimuth: Optional[float] = None
    recorded_at: datetime
    # The alert's platform temporal-model score: MAX over its lanes, which is
    # exactly the primary lane's value because siblings are NULL (see #364).
    temporal_model_score: Optional[float] = None
    is_wildfire_alertapi: Optional[AnnotationType] = None
    primary_sequence_id: int
    total_objects: int
    classified_objects: int
    # Present only on skipped=true queue rows.
    skip: Optional[AlertSkipInfo] = None


class ClassifyDoneLane(BaseModel):
    """One classified object-sequence of a done alert (outcome-relevant fields only)."""

    sequence_id: int
    has_smoke: bool
    has_missed_smoke: bool
    is_unsure: bool
    smoke_types: List[str] = []
    false_positive_types: List[str] = []


class ClassifyDoneItem(BaseModel):
    """One fully classified alert (done-list row)."""

    source_api: SourceApi
    platform_alert_id: int
    camera_name: str
    organisation_name: str
    azimuth: Optional[float] = None
    recorded_at: datetime
    # The alert's platform temporal-model score: MAX over its lanes, which is
    # exactly the primary lane's value because siblings are NULL (see #364).
    temporal_model_score: Optional[float] = None
    is_wildfire_alertapi: Optional[AnnotationType] = None
    primary_sequence_id: int
    lanes: List[ClassifyDoneLane]
    annotators: List[str] = []


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


class AlertSkipRequest(BaseModel):
    """Body of POST /sequences/alert/skip."""

    source_api: SourceApi
    platform_alert_id: int
    note: Optional[str] = None


class MaterializeFrameRequest(BaseModel):
    """Issue #287: materialize one gap frame into a lane, so a human can box
    the object on a frame the detector missed it on."""

    recorded_at: datetime
