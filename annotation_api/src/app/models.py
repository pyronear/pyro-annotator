from datetime import UTC, date as date_type, datetime
from enum import Enum
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
    Enum as SQLEnum,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

__all__ = [
    "AlertSkip",
    "Detection",
    "DetectionAnnotation",
    "Sequence",
    "SequenceAnnotation",
    "SequenceGroup",
    "User",
    "AnnotationType",
]

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
    SEQ_ANNOTATION_DONE = "seq_annotation_done"  # Sequence annotation finished locally and ready to upload/share
    ANNOTATED = (
        "annotated"  # Sequence has been fully annotated and validated (final state)
    )


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
    UNLABELED = "unlabeled"  # False positive discarded by auto-annotation without a specific category assigned


class AnnotationType(str, Enum):
    """
    Classification of annotation types from external wildfire detection APIs.

    These values correspond to the classification provided by platform APIs
    to indicate the type of detection (wildfire smoke vs other sources).
    Used to maintain the original classification from external systems.
    """

    WILDFIRE_SMOKE = "wildfire_smoke"  # Confirmed wildfire smoke detection
    OTHER_SMOKE = "other_smoke"  # Smoke from non-wildfire sources (industrial, controlled burns, etc.)
    OTHER = "other"  # Other type of detection or false positive


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
        # Alert identity is the composite (source_api, platform_alert_id);
        # matches the migration-created index exactly (keeps autogenerate quiet).
        Index("ix_sequence_platform_alert_id", "source_api", "platform_alert_id"),
    )
    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    source_api: SourceApi
    # BigInteger: synthetic sibling ids (1_000_000_000 + platform_sid * 1000 +
    # object_index) overflow int32 once platform sids pass ~1.15M.
    alert_api_id: int = Field(sa_type=BigInteger)
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
    is_wildfire_alertapi: Optional[AnnotationType] = Field(
        default=None, sa_column=Column(SQLEnum(AnnotationType))
    )
    organisation_name: str
    organisation_id: int
    # Membership in a SequenceGroup. NULL until `assign_groups` runs (which
    # discovers groups by `(camera_id, azimuth, IoU > 0.3)`). Set NULL on
    # group deletion so the sequence survives.
    sequence_group_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            ForeignKey("sequence_groups.id", ondelete="SET NULL"),
            index=True,
        ),
    )
    # Sticky flag set when an annotator manually removed this sequence
    # from a group. assign_groups must skip these so the next import
    # doesn't silently re-attach a known outlier.
    is_group_excluded: bool = Field(default=False)
    # Groups object-split siblings of one platform alert. Identity of the
    # alert is ALWAYS the composite (source_api, platform_alert_id) — indexed
    # via ix_sequence_platform_alert_id in __table_args__.
    # Equals alert_api_id for non-split sequences (singleton alerts).
    platform_alert_id: int = Field(sa_type=BigInteger)
    # Sweep bookkeeping: set when the auto-annotate job was deferred.
    auto_annotate_enqueued_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    # Set by the worker when auto_predictions are written (queue gate 2).
    auto_annotated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )


class SequenceGroup(SQLModel, table=True):
    """Recurring real-world entity at one camera angle (a persistent fire,
    a recurring antenna FP, …). Sequences join a group when their
    representative bbox overlaps the group's reference bbox enough.

    A group carries at most one label (smoke OR false positive, never both).
    Labels are only ever written by human actions (classify propagation,
    bulk apply) — the assignment sweep manages membership only. Once a group
    is validated its membership freezes: later matching sequences open a
    fresh group instead.
    """

    __tablename__ = "sequence_groups"
    __table_args__ = (
        Index("ix_sequence_groups_camera_azimuth", "camera_id", "azimuth"),
        # Mutually-exclusive label: at most one of smoke_type / fp_type set.
        CheckConstraint(
            "smoke_type IS NULL OR false_positive_type IS NULL",
            name="ck_sequence_group_label_xor",
        ),
        # labeled_at must be set iff a label is present.
        CheckConstraint(
            "(labeled_at IS NULL) = "
            "(smoke_type IS NULL AND false_positive_type IS NULL)",
            name="ck_sequence_group_labeled_at_consistency",
        ),
    )

    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    camera_id: int
    azimuth: int
    # Defines the group's region in the image. Set from the first member's
    # representative bbox at group creation, never mutated, so the group
    # stays self-defining even if all original members are pruned.
    representative_bbox: dict = Field(sa_column=Column(JSONB))
    # Carried label. Stored as the enum value (string) for now; validated by
    # the API schemas against SmokeType / FalsePositiveType.
    smoke_type: Optional[str] = Field(default=None)
    false_positive_type: Optional[str] = Field(default=None)
    is_unsure: bool = Field(default=False)
    # Set to True once an annotator has reviewed the group and confirmed
    # membership is correct. Annotation propagation to other members only
    # kicks in for validated groups.
    is_validated: bool = Field(default=False)
    # Who confirmed group membership (the "Reviewed" action) and when.
    # NULL for groups validated before attribution existed.
    validated_by_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(ForeignKey("users.id", ondelete="SET NULL")),
    )
    validated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    labeled_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    labeled_by_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(ForeignKey("users.id", ondelete="SET NULL")),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    updated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )


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
        # GIN index for efficient JSONB operations on smoke_types array
        Index(
            "ix_sequence_annotation_smoke_types",
            "smoke_types",
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
    smoke_types: List[str] = Field(default_factory=list, sa_column=Column(JSONB))
    has_missed_smoke: bool
    is_unsure: Optional[bool] = Field(default=False)
    annotation: dict = Field(sa_column=Column(JSONB))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    # Server-owned: stamped on every UPDATE, never supplied by clients (#216).
    updated_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
    processing_stage: SequenceAnnotationProcessingStage


class Detection(SQLModel, table=True):
    __tablename__ = "detections"
    __table_args__ = (
        UniqueConstraint(
            "sequence_id", "alert_api_id", name="uq_detection_sequence_alert_api_id"
        ),
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
    alert_api_id: int = Field(sa_type=BigInteger)
    sequence_id: Optional[int] = Field(
        default=None, sa_column=Column(ForeignKey("sequences.id", ondelete="CASCADE"))
    )
    bucket_key: str
    algo_predictions: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    # Immutable local auto-annotation model output (read-only reference; the human
    # ground-truth annotation is seeded from it at submit, never edited in place).
    auto_predictions: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    # Sibling boxes seen on the same image but not part of the tracked sequence.
    # Stored read-only for the UI so annotators can spot missed smoke; never fed
    # into auto-annotation.
    others_bboxes: Optional[dict] = Field(default=None, sa_column=Column(JSONB))


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
    # Server-owned: stamped on every UPDATE, never supplied by clients (#216).
    updated_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )


class User(SQLModel, table=True):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("username", name="uq_user_username"),
        Index("ix_user_username", "username"),
    )
    id: int = Field(
        default=None,
        primary_key=True,
        sa_column_kwargs={"autoincrement": True},
    )
    username: str = Field(max_length=50)
    hashed_password: str
    is_active: bool = Field(default=True)
    is_superuser: bool = Field(default=False)
    can_localize: bool = Field(default=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    updated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )


class ImportCoverageStatus(str, Enum):
    """Outcome of one (connector, organization, day) import attempt."""

    OK = "ok"  # imported cleanly, including days with zero alerts
    PARTIAL = "partial"  # some alerts failed, some succeeded or were skipped
    FAILED = "failed"  # nothing imported: connector errored, or all alerts failed


class AlertApiConnector(SQLModel, table=True):
    """A credentialed link to one alert API, imported daily by the worker."""

    __tablename__ = "alert_api_connectors"
    __table_args__ = (
        UniqueConstraint("base_url", name="uq_connector_base_url"),
        # Sequence identity is (alert_api_id, source_api) and alert identity is
        # (source_api, platform_alert_id). Two connectors sharing a source_api
        # would let alert ids from different platforms collide.
        UniqueConstraint("source_api", name="uq_connector_source_api"),
    )

    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    name: str = Field(max_length=100)
    base_url: str = Field(max_length=255)
    source_api: SourceApi
    login: str = Field(max_length=100)
    # Fernet token — see app.services.secrets. Never serialized to clients.
    password_encrypted: str
    is_enabled: bool = Field(default=True)
    # Days re-imported on every run. This is also the catch-up mechanism: a
    # missed run is recovered by the next run's window.
    trailing_days: int = Field(default=3)
    # "url" / "bucket-copy" / None = the importer's per-source auto-detect.
    image_transfer: Optional[str] = Field(default=None, max_length=20)
    last_verified_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    last_verify_error: Optional[str] = Field(default=None)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    updated_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )


class AlertApiConnectorOrganization(SQLModel, table=True):
    """An organization discovered on a connector's alert API."""

    __tablename__ = "alert_api_connector_organizations"
    __table_args__ = (
        UniqueConstraint("connector_id", "organization_id", name="uq_connector_org"),
    )

    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    connector_id: int = Field(
        sa_column=Column(ForeignKey("alert_api_connectors.id", ondelete="CASCADE"))
    )
    # The organization's id on the REMOTE alert API, not a local FK.
    organization_id: int
    name: str = Field(max_length=200)
    is_enabled: bool = Field(default=False)
    enabled_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )


class AlertApiImportCoverage(SQLModel, table=True):
    """One row per heatmap cell: what a connector imported for one organization
    on one day.

    A day with zero alerts still gets a row (status ok, counts 0) — that is what
    separates "we looked, nothing was there" from "we never got there".
    """

    __tablename__ = "alert_api_import_coverage"
    __table_args__ = (
        UniqueConstraint(
            "connector_id",
            "organization_id",
            "covered_date",
            name="uq_coverage_connector_org_date",
        ),
        Index("ix_coverage_connector_date", "connector_id", "covered_date"),
    )

    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    connector_id: int = Field(
        sa_column=Column(ForeignKey("alert_api_connectors.id", ondelete="CASCADE"))
    )
    organization_id: int
    covered_date: date_type
    status: ImportCoverageStatus
    alerts_fetched: int = Field(default=0)
    alerts_imported: int = Field(default=0)
    alerts_skipped: int = Field(default=0)
    alerts_failed: int = Field(default=0)
    # Object-split fan-out: one alert can become several annotation sequences.
    lanes_created: int = Field(default=0)
    error: Optional[str] = Field(default=None)
    last_attempt_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )


class SequenceAnnotationContribution(SQLModel, table=True):
    __tablename__ = "sequence_annotation_contributions"
    __table_args__ = (
        Index("ix_seq_contrib_annotation_user", "sequence_annotation_id", "user_id"),
        Index("ix_seq_contrib_user_time", "user_id", "contributed_at"),
    )

    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    sequence_annotation_id: int = Field(
        sa_column=Column(ForeignKey("sequences_annotations.id", ondelete="CASCADE"))
    )
    user_id: int = Field(sa_column=Column(ForeignKey("users.id", ondelete="CASCADE")))
    contributed_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )


class AlertSkip(SQLModel, table=True):
    """Overlay marking a whole alert (source_api, platform_alert_id) as skipped.

    Skip = insert a row, unskip = delete it; lane state is never touched, so
    unskip returns the alert to exactly where it was
    (docs/specs/2026-08-05-alert-skip-escape-hatch-design.md).
    """

    __tablename__ = "alert_skips"
    __table_args__ = (
        UniqueConstraint("source_api", "platform_alert_id", name="uq_alert_skip_alert"),
    )

    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    source_api: SourceApi
    platform_alert_id: int = Field(sa_type=BigInteger)
    skipped_by_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(ForeignKey("users.id", ondelete="SET NULL")),
    )
    skipped_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    note: Optional[str] = Field(default=None)


class DetectionAnnotationContribution(SQLModel, table=True):
    __tablename__ = "detection_annotation_contributions"
    __table_args__ = (
        Index("ix_det_contrib_annotation_user", "detection_annotation_id", "user_id"),
        Index("ix_det_contrib_user_time", "user_id", "contributed_at"),
    )

    id: int = Field(
        default=None, primary_key=True, sa_column_kwargs={"autoincrement": True}
    )
    detection_annotation_id: int = Field(
        sa_column=Column(ForeignKey("detections_annotations.id", ondelete="CASCADE"))
    )
    user_id: int = Field(sa_column=Column(ForeignKey("users.id", ondelete="CASCADE")))
    contributed_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
