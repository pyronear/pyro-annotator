from datetime import UTC, datetime
from enum import Enum
from typing import List, Optional

from sqlalchemy import Column, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

__all__ = ["Detection", "DetectionAnnotation", "Sequence", "SequenceAnnotation", "User"]

# -------------------- ENUMS --------------------


class DetectionAnnotationProcessingStage(str, Enum):
    """
    Processing stages for detection annotations in the wildfire detection workflow.

    These stages represent the progression of a detection annotation through the
    quality control and validation process, from initial import to final annotation.
    """

    IMPORTED = (
        "imported"  # Initial stage when annotation is imported from external source
    )
    VISUAL_CHECK = "visual_check"  # Human visual verification of detection accuracy
    BBOX_ANNOTATION = (
        "bbox_annotation"  # Manual bounding box drawing around smoke regions
    )
    ANNOTATED = "annotated"  # Final stage with complete human annotation and validation


class SequenceAnnotationProcessingStage(str, Enum):
    """
    Processing stages for sequence annotations in the wildfire monitoring workflow.

    These stages track the lifecycle of sequence annotations from initial data
    import through preparation and final human annotation completion.
    """

    IMPORTED = "imported"  # Initial stage when sequence is imported from source API
    READY_TO_ANNOTATE = "ready_to_annotate"  # Sequence has been processed and is ready for human annotation
    ANNOTATED = "annotated"  # Sequence has been fully annotated with smoke/false positive classifications


class SourceApi(str, Enum):
    """
    Source APIs that provide wildfire detection data to the annotation system.

    These represent the different external platforms and services that feed
    detection data into the Pyronear annotation pipeline for analysis.
    """

    PYRONEAR_FRENCH_API = (
        "pyronear_french"  # Pyronear's main French wildfire detection platform
    )
    ALERT_WILDFIRE = "alert_wildfire"  # AlertWildfire camera network data source
    CENIA = "api_cenia"  # CENIA (Chile) forest fire detection system


class SmokeType(str, Enum):
    """
    Classification of smoke types detected in wildfire monitoring imagery.

    Used to categorize the source and nature of smoke detected in camera
    feeds for accurate wildfire identification and false positive reduction.
    """

    WILDFIRE = "wildfire"  # Smoke from actual wildfire - highest priority for emergency response
    INDUSTRIAL = (
        "industrial"  # Smoke from industrial sources (factories, power plants, etc.)
    )
    OTHER = (
        "other"  # Smoke from other sources (controlled burns, agricultural fires, etc.)
    )


class FalsePositiveType(str, Enum):
    """
    Classification of false positive types in wildfire detection imagery.

    These categories help identify common sources of false alarms in AI-based
    wildfire detection systems, enabling better model training and filtering.
    Used by human annotators to classify why a detection was incorrectly
    identified as smoke or fire.
    """

    ANTENNA = (
        "antenna"  # Communication towers, radio antennas mistaken for smoke plumes
    )
    BUILDING = "building"  # Structures, rooftops, or architectural features misidentified as fire
    CLIFF = (
        "cliff"  # Rock faces, cliffs, or geological features causing false detections
    )
    DARK = "dark"  # Dark shadows or areas with poor lighting causing detection errors
    DUST = "dust"  # Dust clouds from construction, vehicles, or natural sources
    HIGH_CLOUD = "high_cloud"  # High altitude clouds mistaken for smoke
    LOW_CLOUD = "low_cloud"  # Low hanging fog or clouds resembling smoke plumes
    LENS_FLARE = "lens_flare"  # Camera lens flare from sun or bright lights
    LENS_DROPLET = "lens_droplet"  # Water droplets on camera lens creating artifacts
    LIGHT = "light"  # Bright lights, reflections, or glare causing false positives
    RAIN = "rain"  # Rain, precipitation, or water spray mistaken for smoke
    TRAIL = "trail"  # Vehicle exhaust, contrails, or other linear features
    ROAD = "road"  # Roads, pathways, or infrastructure misidentified as fire
    SKY = "sky"  # Sky patterns, color variations, or atmospheric effects
    TREE = "tree"  # Trees, vegetation, or forest canopy causing false detections
    WATER_BODY = "water_body"  # Lakes, rivers, or water surfaces with reflections
    OTHER = (
        "other"  # Any other source of false positive not covered by specific categories
    )


# -------------------- TABLES --------------------


class Sequence(SQLModel, table=True):
    __tablename__ = "sequences"
    __table_args__ = (
        UniqueConstraint("alert_api_id", "source_api", name="uq_sequence_alert_source"),
        # Single column indices
        Index("ix_sequence_created_at", "created_at"),
        Index("ix_sequence_recorded_at", "recorded_at"),
        Index("ix_sequence_last_seen_at", "last_seen_at"),
        Index("ix_sequence_source_api", "source_api"),
        Index("ix_sequence_camera_id", "camera_id"),
        Index("ix_sequence_camera_name", "camera_name"),
        Index("ix_sequence_organisation_id", "organisation_id"),
        Index("ix_sequence_organisation_name", "organisation_name"),
        Index("ix_sequence_is_wildfire", "is_wildfire_alertapi"),
        # Composite indices for common filter combinations
        Index("ix_sequence_source_camera", "source_api", "camera_name"),
        Index("ix_sequence_source_org", "source_api", "organisation_name"),
        Index("ix_sequence_source_wildfire", "source_api", "is_wildfire_alertapi"),
        Index("ix_sequence_camera_org", "camera_name", "organisation_name"),
        Index(
            "ix_sequence_source_camera_org",
            "source_api",
            "camera_name",
            "organisation_name",
        ),
        Index(
            "ix_sequence_source_camera_wildfire",
            "source_api",
            "camera_name",
            "is_wildfire_alertapi",
        ),
        Index(
            "ix_sequence_source_org_wildfire",
            "source_api",
            "organisation_name",
            "is_wildfire_alertapi",
        ),
        Index(
            "ix_sequence_full_filter",
            "source_api",
            "camera_name",
            "organisation_name",
            "is_wildfire_alertapi",
        ),
    )
    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    source_api: SourceApi
    alert_api_id: int
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    recorded_at: datetime = Field(sa_column=Column(DateTime(timezone=True)))
    last_seen_at: datetime = Field(sa_column=Column(DateTime(timezone=True)))
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
        Index("ix_sequence_annotation_is_unsure", "is_unsure"),
        Index("ix_sequence_annotation_processing_stage", "processing_stage"),
        Index("ix_sequence_annotation_created_at", "created_at"),
        Index("ix_sequence_annotation_stage_date", "processing_stage", "created_at"),
        # GIN index for efficient JSONB operations on false_positive_types array
        Index(
            "ix_sequence_annotation_fp_types",
            "false_positive_types",
            postgresql_using="gin",
        ),
    )
    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    sequence_id: int = Field(
        sa_column=Column(ForeignKey("sequences.id", ondelete="CASCADE"))
    )
    has_smoke: bool
    has_false_positives: bool
    false_positive_types: List[str] = Field(
        default_factory=list, sa_column=Column(JSONB)
    )
    has_missed_smoke: bool
    is_unsure: Optional[bool] = Field(default=False)
    annotation: dict = Field(sa_column=Column(JSONB))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    updated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
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
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    recorded_at: datetime = Field(sa_column=Column(DateTime(timezone=True)))
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
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    updated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )


class User(SQLModel, table=True):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("username", name="uq_user_username"),
        UniqueConstraint("email", name="uq_user_email"),
        Index("ix_user_username", "username"),
        Index("ix_user_email", "email"),
    )
    id: int = Field(
        default=None,
        primary_key=True,
        sa_column_kwargs={"autoincrement": True},
    )
    username: str = Field(max_length=50)
    email: str = Field(max_length=255)
    hashed_password: str
    is_active: bool = Field(default=True)
    is_superuser: bool = Field(default=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    updated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
