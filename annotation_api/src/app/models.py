# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

__all__ = ["Detection", "DetectionAnnotation", "Sequence", "SequenceAnnotation"]

# -------------------- ENUMS --------------------


class DetectionAnnotationProcessingStage(str, Enum):
    IMPORTED = "imported"
    VISUAL_CHECK = "visual_check"
    LABEL_STUDIO_CHECK = "label_studio_check"
    ANNOTATED = "annotated"


class SequenceAnnotationProcessingStage(str, Enum):
    IMPORTED = "imported"
    READY_TO_ANNOTATE = "ready_to_annotate"
    ANNOTATED = "annotated"


class SourceApi(str, Enum):
    PYRONEAR_FRENCH_API = "pyronear_french"
    ALERT_WILDFIRE = "alert_wildfire"
    CENIA = "api_cenia"


class SmokeType(str, Enum):
    """
    Smoke types.
    """

    WILDFIRE = "wildfire"
    INDUSTRIAL = "industrial"
    OTHER = "other"


class FalsePositiveType(str, Enum):
    """
    False positive types.
    """

    ANTENNA = "antenna"
    BUILDING = "building"
    CLIFF = "cliff"
    DARK = "dark"
    DUST = "dust"
    HIGH_CLOUD = "high_cloud"
    LOW_CLOUD = "low_cloud"
    LENS_FLARE = "lens_flare"
    LENS_DROPLET = "lens_droplet"
    LIGHT = "light"
    RAIN = "rain"
    TRAIL = "trail"
    ROAD = "road"
    SKY = "sky"
    TREE = "tree"
    WATER_BODY = "water_body"
    OTHER = "other"


# -------------------- TABLES --------------------


class Sequence(SQLModel, table=True):
    __tablename__ = "sequences"
    __table_args__ = (
        UniqueConstraint("alert_api_id", "source_api", name="uq_sequence_alert_source"),
        Index("ix_sequence_created_at", "created_at"),
        Index("ix_sequence_recorded_at", "recorded_at"),
        Index("ix_sequence_last_seen_at", "last_seen_at"),
        Index("ix_sequence_source_api", "source_api"),
        Index("ix_sequence_camera_id", "camera_id"),
        Index("ix_sequence_organisation_id", "organisation_id"),
        Index("ix_sequence_is_wildfire", "is_wildfire_alertapi"),
    )
    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    source_api: SourceApi
    alert_api_id: int
    created_at: datetime = Field(default_factory=datetime.utcnow)
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


class SequenceAnnotation(SQLModel, table=True):
    __tablename__ = "sequences_annotations"
    __table_args__ = (
        UniqueConstraint("sequence_id", name="uq_sequence_annotation_sequence_id"),
        Index("ix_sequence_annotation_has_smoke", "has_smoke"),
        Index("ix_sequence_annotation_has_false_positives", "has_false_positives"),
        Index("ix_sequence_annotation_has_missed_smoke", "has_missed_smoke"),
        Index("ix_sequence_annotation_processing_stage", "processing_stage"),
        Index("ix_sequence_annotation_created_at", "created_at"),
        Index("ix_sequence_annotation_stage_date", "processing_stage", "created_at"),
    )
    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    sequence_id: int = Field(
        sa_column=Column(ForeignKey("sequences.id", ondelete="CASCADE"))
    )
    has_smoke: bool
    has_false_positives: bool
    false_positive_types: str
    has_missed_smoke: bool
    annotation: dict = Field(sa_column=Column(JSONB))
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = Field(default=None)
    processing_stage: SequenceAnnotationProcessingStage


class Detection(SQLModel, table=True):
    __tablename__ = "detections"
    __table_args__ = (
        UniqueConstraint("alert_api_id", "id", name="uq_detection_alert_id"),
        Index("ix_detection_sequence_id", "sequence_id"),
        Index("ix_detection_created_at", "created_at"),
        Index("ix_detection_recorded_at", "recorded_at"),
        Index("ix_detection_sequence_created", "sequence_id", "created_at"),
    )
    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    recorded_at: datetime
    alert_api_id: int
    sequence_id: Optional[int] = Field(
        default=None, sa_column=Column(ForeignKey("sequences.id", ondelete="CASCADE"))
    )
    bucket_key: str
    algo_predictions: Optional[dict] = Field(default=None, sa_column=Column(JSONB))


class DetectionAnnotation(SQLModel, table=True):
    __tablename__ = "detections_annotations"
    __table_args__ = (
        UniqueConstraint("detection_id", name="uq_detection_annotation_detection_id"),
        Index("ix_detection_annotation_processing_stage", "processing_stage"),
        Index("ix_detection_annotation_created_at", "created_at"),
        Index("ix_detection_annotation_stage_date", "processing_stage", "created_at"),
        Index("ix_detection_annotation_detection_date", "detection_id", "created_at"),
    )
    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    detection_id: int = Field(
        sa_column=Column(ForeignKey("detections.id", ondelete="CASCADE"))
    )
    annotation: dict = Field(default=None, sa_column=Column(JSONB))
    processing_stage: DetectionAnnotationProcessingStage = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = Field(default=None)
