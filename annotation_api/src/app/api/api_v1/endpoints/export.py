# app/api/api_v1/endpoints/export.py

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import (
    and_,
    asc,
    desc,
    select,
    cast,
    ARRAY,
    String,
)
from sqlalchemy.sql import ColumnElement
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user
from app.db import get_session
from app.models import (
    Detection,
    DetectionAnnotation,
    DetectionAnnotationProcessingStage,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
    User,
    AnnotationType,
    FalsePositiveType,
    SmokeType,
)
from app.services.storage import s3_service

router = APIRouter()


class DetectionExportOrderBy(str, Enum):
    recorded_at = "recorded_at"
    created_at = "created_at"


class DetectionExportRow(BaseModel):
    # Detection core
    detection_id: int
    sequence_id: Optional[int]
    alert_api_id: int
    source_api: str
    recorded_at: datetime
    created_at: datetime

    # Sequence metadata
    sequence_recorded_at: Optional[datetime] = None
    sequence_last_seen_at: Optional[datetime] = None
    camera_id: int
    camera_name: str
    organisation_id: int
    organisation_name: str
    lat: float
    lon: float
    azimuth: Optional[int] = None
    is_wildfire_alertapi: Optional[AnnotationType] = None

    # Storage and image
    bucket_key: str
    image_url: Optional[str] = None

    # Model predictions
    algo_predictions_raw: Optional[Dict[str, Any]] = None

    # Sequence annotation
    sequence_has_smoke: Optional[bool] = None
    sequence_has_false_positives: Optional[bool] = None
    sequence_false_positive_types: Optional[List[str]] = None
    sequence_smoke_types: Optional[List[str]] = None
    sequence_has_missed_smoke: Optional[bool] = None
    sequence_is_unsure: Optional[bool] = None
    sequence_processing_stage: Optional[SequenceAnnotationProcessingStage] = None
    sequence_annotation: Optional[Dict[str, Any]] = None
    sequence_annotation_created_at: Optional[datetime] = None
    sequence_annotation_updated_at: Optional[datetime] = None

    # Detection annotation
    detection_processing_stage: Optional[DetectionAnnotationProcessingStage] = None
    detection_annotation: Optional[Dict[str, Any]] = None
    detection_annotation_created_at: Optional[datetime] = None
    detection_annotation_updated_at: Optional[datetime] = None


@router.get(
    "/detections",
    response_model=List[DetectionExportRow],
    summary="Export annotated detections",
    description=(
        "Export detection centric rows with joined sequence metadata "
        "and annotations for external processing. "
        "By default only sequences with sequence level annotation at stage annotated are exported."
    ),
)
async def export_detections(
    # Basic filters
    source_api: Optional[str] = Query(
        None,
        description=(
            "Filter by source API, for example pyronear_french, "
            "alert_wildfire, api_cenia"
        ),
    ),
    organisation_id: Optional[int] = Query(
        None, description="Filter by organisation identifier"
    ),
    organisation_name: Optional[str] = Query(
        None, description="Filter by organisation name exact match"
    ),
    camera_id: Optional[int] = Query(
        None, description="Filter by camera identifier"
    ),
    camera_name: Optional[str] = Query(
        None, description="Filter by camera name exact match"
    ),
    # External API wildfire label
    is_wildfire_alertapi: Optional[str] = Query(
        None,
        description=(
            "Filter by wildfire classification from external API "
            "wildfire_smoke, other_smoke, other, "
            "or null for unclassified"
        ),
    ),
    # Sequence annotation filters
    has_smoke: Optional[bool] = Query(
        None, description="Filter by sequence annotation has_smoke flag"
    ),
    has_false_positives: Optional[bool] = Query(
        None, description="Filter by sequence annotation has_false_positives flag"
    ),
    has_missed_smoke: Optional[bool] = Query(
        None, description="Filter by sequence annotation has_missed_smoke flag"
    ),
    is_unsure: Optional[bool] = Query(
        None, description="Filter by sequence annotation is_unsure flag"
    ),
    sequence_processing_stage: Optional[str] = Query(
        "annotated",
        description=(
            "Filter by sequence annotation processing stage, "
            "imported, ready_to_annotate, annotated. "
            "Default is annotated."
        ),
    ),
    false_positive_types: Optional[List[FalsePositiveType]] = Query(
        None,
        description=(
            "Filter by specific false positive types OR logic, "
            "sequences containing any of the specified types are kept"
        ),
    ),
    smoke_types: Optional[List[SmokeType]] = Query(
        None,
        description=(
            "Filter by specific smoke types OR logic, "
            "sequences containing any of the specified types are kept"
        ),
    ),
    # Date filters at detection level
    recorded_at_gte: Optional[datetime] = Query(
        None,
        description="Filter detections with recorded_at greater or equal to this date",
    ),
    recorded_at_lte: Optional[datetime] = Query(
        None,
        description="Filter detections with recorded_at less or equal to this date",
    ),
    # Date filters at sequence annotation level
    sequence_annotation_created_gte: Optional[datetime] = Query(
        None,
        description=(
            "Filter sequences with annotation created_at greater or equal to this date"
        ),
    ),
    sequence_annotation_created_lte: Optional[datetime] = Query(
        None,
        description=(
            "Filter sequences with annotation created_at less or equal to this date"
        ),
    ),
    # Ordering and limit
    order_by: DetectionExportOrderBy = Query(
        DetectionExportOrderBy.recorded_at,
        description="Order results by detection recorded_at or created_at",
    ),
    order_desc: bool = Query(
        True,
        description="If true order in descending order, if false order in ascending order",
    ),
    limit: int = Query(
        10_000,
        ge=1,
        le=100_000,
        description="Maximum number of rows to export in a single call",
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Number of rows to skip before starting to return results",
    ),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> List[DetectionExportRow]:
    """
    Export detection centric rows with joined sequence metadata and annotations.
    """

    stmt = (
        select(
            Detection.id.label("detection_id"),
            Detection.sequence_id.label("sequence_id"),
            Detection.alert_api_id.label("alert_api_id"),
            Detection.recorded_at.label("recorded_at"),
            Detection.created_at.label("created_at"),
            Detection.bucket_key.label("bucket_key"),
            Detection.algo_predictions.label("algo_predictions_raw"),
            Sequence.source_api.label("source_api"),
            Sequence.recorded_at.label("sequence_recorded_at"),
            Sequence.last_seen_at.label("sequence_last_seen_at"),
            Sequence.camera_id.label("camera_id"),
            Sequence.camera_name.label("camera_name"),
            Sequence.organisation_id.label("organisation_id"),
            Sequence.organisation_name.label("organisation_name"),
            Sequence.lat.label("lat"),
            Sequence.lon.label("lon"),
            Sequence.azimuth.label("azimuth"),
            Sequence.is_wildfire_alertapi.label("is_wildfire_alertapi"),
            SequenceAnnotation.has_smoke.label("sequence_has_smoke"),
            SequenceAnnotation.has_false_positives.label(
                "sequence_has_false_positives"
            ),
            SequenceAnnotation.false_positive_types.label(
                "sequence_false_positive_types"
            ),
            SequenceAnnotation.smoke_types.label("sequence_smoke_types"),
            SequenceAnnotation.has_missed_smoke.label("sequence_has_missed_smoke"),
            SequenceAnnotation.is_unsure.label("sequence_is_unsure"),
            SequenceAnnotation.processing_stage.label("sequence_processing_stage"),
            SequenceAnnotation.annotation.label("sequence_annotation"),
            SequenceAnnotation.created_at.label("sequence_annotation_created_at"),
            SequenceAnnotation.updated_at.label("sequence_annotation_updated_at"),
            DetectionAnnotation.processing_stage.label("detection_processing_stage"),
            DetectionAnnotation.annotation.label("detection_annotation"),
            DetectionAnnotation.created_at.label("detection_annotation_created_at"),
            DetectionAnnotation.updated_at.label("detection_annotation_updated_at"),
        )
        .select_from(Detection)
        .join(Sequence, Detection.sequence_id == Sequence.id)
        .outerjoin(
            SequenceAnnotation,
            SequenceAnnotation.sequence_id == Sequence.id,
        )
        .outerjoin(
            DetectionAnnotation,
            DetectionAnnotation.detection_id == Detection.id,
        )
    )

    conditions: List[ColumnElement[bool]] = []

    if source_api is not None:
        conditions.append(Sequence.source_api == source_api)

    if organisation_id is not None:
        conditions.append(Sequence.organisation_id == organisation_id)

    if organisation_name is not None:
        conditions.append(Sequence.organisation_name == organisation_name)

    if camera_id is not None:
        conditions.append(Sequence.camera_id == camera_id)

    if camera_name is not None:
        conditions.append(Sequence.camera_name == camera_name)

    if is_wildfire_alertapi is not None:
        if is_wildfire_alertapi == "null":
            conditions.append(Sequence.is_wildfire_alertapi.is_(None))
        else:
            try:
                enum_value = AnnotationType(is_wildfire_alertapi)
                conditions.append(Sequence.is_wildfire_alertapi == enum_value)
            except ValueError:
                pass

    if has_smoke is not None:
        conditions.append(SequenceAnnotation.has_smoke == has_smoke)

    if has_false_positives is not None:
        conditions.append(
            SequenceAnnotation.has_false_positives == has_false_positives
        )

    if has_missed_smoke is not None:
        conditions.append(SequenceAnnotation.has_missed_smoke == has_missed_smoke)

    if is_unsure is not None:
        conditions.append(SequenceAnnotation.is_unsure == is_unsure)

    # default filter on processing stage annotated unless user overrides
    if sequence_processing_stage is not None:
        try:
            stage_enum = SequenceAnnotationProcessingStage(sequence_processing_stage)
            conditions.append(SequenceAnnotation.processing_stage == stage_enum)
        except ValueError:
            pass

    if false_positive_types:
        fp_values = [fp.value for fp in false_positive_types]
        conditions.append(
            SequenceAnnotation.false_positive_types.op("?|")(
                cast(fp_values, ARRAY(String))
            )
        )

    if smoke_types:
        smoke_values = [st.value for st in smoke_types]
        conditions.append(
            SequenceAnnotation.smoke_types.op("?|")(
                cast(smoke_values, ARRAY(String))
            )
        )

    if recorded_at_gte is not None:
        conditions.append(Detection.recorded_at >= recorded_at_gte)

    if recorded_at_lte is not None:
        conditions.append(Detection.recorded_at <= recorded_at_lte)

    # annotation date window
    if sequence_annotation_created_gte is not None:
        conditions.append(
            SequenceAnnotation.created_at >= sequence_annotation_created_gte
        )

    if sequence_annotation_created_lte is not None:
        conditions.append(
            SequenceAnnotation.created_at <= sequence_annotation_created_lte
        )

    if conditions:
        stmt = stmt.where(and_(*conditions))

    order_column = (
        Detection.recorded_at
        if order_by == DetectionExportOrderBy.recorded_at
        else Detection.created_at
    )
    stmt = stmt.order_by(desc(order_column) if order_desc else asc(order_column))

    stmt = stmt.offset(offset).limit(limit)

    result = await session.execute(stmt)
    rows = result.mappings().all()

    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())

    export_rows: List[DetectionExportRow] = []

    for row in rows:
        data = dict(row)

        bucket_key = data.get("bucket_key")
        image_url: Optional[str] = None
        if bucket_key:
            image_url = bucket.get_public_url(bucket_key)

        data["image_url"] = image_url

        export_rows.append(DetectionExportRow(**data))

    return export_rows
