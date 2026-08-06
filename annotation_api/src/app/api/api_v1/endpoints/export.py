# app/api/api_v1/endpoints/export.py

from datetime import datetime
from typing import Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import ARRAY, String, and_, cast, func, or_, select, tuple_
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user
from app.db import get_session
from app.models import (
    Detection,
    DetectionAnnotation,
    FalsePositiveType,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
    SmokeType,
    SourceApi,
    User,
)
from app.services.storage import s3_service

router = APIRouter()


class BoxExport(BaseModel):
    """One annotated box. Exactly one of smoke_type / false_positive_types is set."""

    xyxyn: List[float]
    smoke_type: Optional[SmokeType] = None
    false_positive_types: Optional[List[FalsePositiveType]] = None
    origin: str


class FrameExport(BaseModel):
    detection_id: int
    recorded_at: datetime
    bucket_key: str
    image_url: Optional[str] = None
    boxes: List[BoxExport]


class ObjectExport(BaseModel):
    sequence_id: int
    record_kind: Literal["smoke", "false_positive"]
    smoke_types: List[SmokeType]
    false_positive_types: List[FalsePositiveType]
    frames: List[FrameExport]


class AlertExportItem(BaseModel):
    source_api: SourceApi
    platform_alert_id: int
    camera_id: int
    camera_name: str
    organisation_id: int
    organisation_name: str
    lat: float
    lon: float
    azimuth: Optional[int] = None
    recorded_at: datetime
    last_annotated_at: datetime
    objects: List[ObjectExport]


class AlertExportPage(BaseModel):
    items: List[AlertExportItem]
    next_cursor: Optional[str] = None


def _parse_cursor(cursor: str) -> Tuple[SourceApi, int]:
    source_str, sep, id_str = cursor.partition(":")
    try:
        if not sep:
            raise ValueError
        return SourceApi(source_str), int(id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Malformed cursor, expected '<source_api>:<platform_alert_id>'",
        )


def _smoke_lane_boxes(det_ann: Optional[DetectionAnnotation]) -> List[BoxExport]:
    """Boxes for a smoke lane frame come from its detection annotation."""
    if det_ann is None:
        return []
    boxes: List[BoxExport] = []
    for item in (det_ann.annotation or {}).get("annotation", []):
        fp_type = item.get("false_positive_type")
        boxes.append(
            BoxExport(
                xyxyn=item["xyxyn"],
                smoke_type=item.get("smoke_type"),
                false_positive_types=[FalsePositiveType(fp_type)] if fp_type else None,
                origin=item.get("origin", "human"),
            )
        )
    return boxes


def _fp_lane_bboxes_by_detection(
    seq_ann: SequenceAnnotation,
) -> Dict[int, List[List[float]]]:
    """FP lanes have no detection-annotation boxes; the importer's tracked
    object in the sequence annotation is the box source."""
    by_detection: Dict[int, List[List[float]]] = {}
    for track in (seq_ann.annotation or {}).get("sequences_bbox", []):
        for bbox in track.get("bboxes", []):
            by_detection.setdefault(bbox["detection_id"], []).append(bbox["xyxyn"])
    return by_detection


@router.get(
    "/alerts",
    response_model=AlertExportPage,
    summary="Export annotated alerts",
    description=(
        "Alert-centric export of finished annotation work for ML training. "
        "Only alerts whose every lane is at stage annotated are returned; "
        "unsure lanes are omitted. Keyset-paginated via cursor."
    ),
)
async def export_alerts(
    cursor: Optional[str] = Query(
        None,
        description="Resume token from a previous page's next_cursor",
    ),
    limit: int = Query(100, ge=1, le=500, description="Maximum alerts per page"),
    source_api: Optional[SourceApi] = Query(None, description="Filter by source API"),
    organisation_id: Optional[int] = Query(
        None, description="Filter by organisation id"
    ),
    organisation_name: Optional[str] = Query(
        None, description="Filter by organisation name exact match"
    ),
    camera_id: Optional[int] = Query(None, description="Filter by camera id"),
    camera_name: Optional[str] = Query(
        None, description="Filter by camera name exact match"
    ),
    recorded_at_gte: Optional[datetime] = Query(
        None, description="Alert recorded_at greater or equal to this date"
    ),
    recorded_at_lte: Optional[datetime] = Query(
        None, description="Alert recorded_at less or equal to this date"
    ),
    annotation_updated_gte: Optional[datetime] = Query(
        None,
        description=(
            "Incremental-sync watermark: alerts whose last_annotated_at is "
            "greater or equal to this date"
        ),
    ),
    smoke_types: Optional[List[SmokeType]] = Query(
        None,
        description="Keep alerts with at least one lane containing any of these smoke types",
    ),
    false_positive_types: Optional[List[FalsePositiveType]] = Query(
        None,
        description="Keep alerts with at least one lane containing any of these false positive types",
    ),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AlertExportPage:
    # Per-lane "last annotated" moment: sequence annotation update or any
    # detection annotation update, whichever is later.
    det_ann_max = (
        select(func.max(DetectionAnnotation.updated_at))
        .join(Detection, Detection.id == DetectionAnnotation.detection_id)
        .where(Detection.sequence_id == Sequence.id)
        .correlate(Sequence)
        .scalar_subquery()
    )
    lane_annotated_at = func.greatest(SequenceAnnotation.updated_at, det_ann_max)
    exported_lane = SequenceAnnotation.is_unsure.is_not(True)

    total_lanes = func.count(Sequence.id)
    annotated_lanes = func.count(Sequence.id).filter(
        SequenceAnnotation.processing_stage
        == SequenceAnnotationProcessingStage.ANNOTATED
    )
    exported_lanes = func.count(Sequence.id).filter(exported_lane)
    last_annotated_at = func.max(lane_annotated_at).filter(exported_lane)
    alert_recorded_at = func.min(Sequence.recorded_at)

    stmt = (
        select(
            Sequence.source_api.label("source_api"),
            Sequence.platform_alert_id.label("platform_alert_id"),
            alert_recorded_at.label("recorded_at"),
            last_annotated_at.label("last_annotated_at"),
        )
        .select_from(Sequence)
        .outerjoin(SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id)
        .group_by(Sequence.source_api, Sequence.platform_alert_id)
        .having(annotated_lanes == total_lanes)
        .having(exported_lanes > 0)
        .order_by(Sequence.source_api, Sequence.platform_alert_id)
        .limit(limit)
    )

    if cursor is not None:
        cursor_source, cursor_id = _parse_cursor(cursor)
        stmt = stmt.where(
            or_(
                Sequence.source_api > cursor_source,
                and_(
                    Sequence.source_api == cursor_source,
                    Sequence.platform_alert_id > cursor_id,
                ),
            )
        )

    if source_api is not None:
        stmt = stmt.where(Sequence.source_api == source_api)
    if organisation_id is not None:
        stmt = stmt.where(Sequence.organisation_id == organisation_id)
    if organisation_name is not None:
        stmt = stmt.where(Sequence.organisation_name == organisation_name)
    if camera_id is not None:
        stmt = stmt.where(Sequence.camera_id == camera_id)
    if camera_name is not None:
        stmt = stmt.where(Sequence.camera_name == camera_name)

    if recorded_at_gte is not None:
        stmt = stmt.having(alert_recorded_at >= recorded_at_gte)
    if recorded_at_lte is not None:
        stmt = stmt.having(alert_recorded_at <= recorded_at_lte)
    if annotation_updated_gte is not None:
        stmt = stmt.having(last_annotated_at >= annotation_updated_gte)

    if smoke_types:
        smoke_values = [st.value for st in smoke_types]
        stmt = stmt.having(
            func.bool_or(
                and_(
                    exported_lane,
                    SequenceAnnotation.smoke_types.op("?|")(
                        cast(smoke_values, ARRAY(String))
                    ),
                )
            ).is_(True)
        )
    if false_positive_types:
        fp_values = [fp.value for fp in false_positive_types]
        stmt = stmt.having(
            func.bool_or(
                and_(
                    exported_lane,
                    SequenceAnnotation.false_positive_types.op("?|")(
                        cast(fp_values, ARRAY(String))
                    ),
                )
            ).is_(True)
        )

    page_rows = (await session.execute(stmt)).all()
    if not page_rows:
        return AlertExportPage(items=[], next_cursor=None)

    keys = [(row.source_api, row.platform_alert_id) for row in page_rows]

    lane_rows = (
        await session.execute(
            select(Sequence, SequenceAnnotation)
            .join(SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id)
            .where(tuple_(Sequence.source_api, Sequence.platform_alert_id).in_(keys))
            .where(SequenceAnnotation.is_unsure.is_not(True))
            .order_by(Sequence.id)
        )
    ).all()

    seq_ids = [seq.id for seq, _ in lane_rows]
    det_rows = (
        await session.execute(
            select(Detection, DetectionAnnotation)
            .outerjoin(
                DetectionAnnotation, DetectionAnnotation.detection_id == Detection.id
            )
            .where(Detection.sequence_id.in_(seq_ids))
            .order_by(Detection.sequence_id, Detection.recorded_at, Detection.id)
        )
    ).all()

    dets_by_sequence: Dict[
        int, List[Tuple[Detection, Optional[DetectionAnnotation]]]
    ] = {}
    for det, det_ann in det_rows:
        dets_by_sequence.setdefault(det.sequence_id, []).append((det, det_ann))

    lanes_by_key: Dict[tuple, List[Tuple[Sequence, SequenceAnnotation]]] = {}
    for seq, seq_ann in lane_rows:
        lanes_by_key.setdefault((seq.source_api, seq.platform_alert_id), []).append(
            (seq, seq_ann)
        )

    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())

    items: List[AlertExportItem] = []
    for row in page_rows:
        lanes = lanes_by_key.get((row.source_api, row.platform_alert_id), [])
        if not lanes:
            continue
        first_seq = lanes[0][0]

        objects: List[ObjectExport] = []
        for seq, seq_ann in lanes:
            is_smoke_lane = bool(seq_ann.has_smoke)
            fp_bboxes = {} if is_smoke_lane else _fp_lane_bboxes_by_detection(seq_ann)
            lane_fp_types = [
                FalsePositiveType(v) for v in (seq_ann.false_positive_types or [])
            ]

            frames: List[FrameExport] = []
            for det, det_ann in dets_by_sequence.get(seq.id, []):
                if is_smoke_lane:
                    boxes = _smoke_lane_boxes(det_ann)
                else:
                    boxes = [
                        BoxExport(
                            xyxyn=xyxyn,
                            smoke_type=None,
                            false_positive_types=lane_fp_types,
                            origin="engine",
                        )
                        for xyxyn in fp_bboxes.get(det.id, [])
                    ]
                frames.append(
                    FrameExport(
                        detection_id=det.id,
                        recorded_at=det.recorded_at,
                        bucket_key=det.bucket_key,
                        image_url=(
                            bucket.generate_presigned_url(det.bucket_key)
                            if det.bucket_key
                            else None
                        ),
                        boxes=boxes,
                    )
                )

            objects.append(
                ObjectExport(
                    sequence_id=seq.id,
                    record_kind="smoke" if is_smoke_lane else "false_positive",
                    smoke_types=[SmokeType(v) for v in (seq_ann.smoke_types or [])],
                    false_positive_types=lane_fp_types,
                    frames=frames,
                )
            )

        items.append(
            AlertExportItem(
                source_api=row.source_api,
                platform_alert_id=row.platform_alert_id,
                camera_id=first_seq.camera_id,
                camera_name=first_seq.camera_name,
                organisation_id=first_seq.organisation_id,
                organisation_name=first_seq.organisation_name,
                lat=first_seq.lat,
                lon=first_seq.lon,
                azimuth=first_seq.azimuth,
                recorded_at=row.recorded_at,
                last_annotated_at=row.last_annotated_at,
                objects=objects,
            )
        )

    next_cursor = None
    if len(page_rows) == limit and items:
        last = items[-1]
        next_cursor = f"{last.source_api.value}:{last.platform_alert_id}"

    return AlertExportPage(items=items, next_cursor=next_cursor)
