# app/api/api_v1/endpoints/export.py

from datetime import datetime
from typing import Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import ARRAY, String, and_, cast, func, or_, select, tuple_
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user
from app.db import get_session
from app.services.alert_skip import alert_skip_exists_clause
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
    object in the sequence annotation is the box source.

    Merges all tracks: today an FP lane holds exactly one track by import
    construction, but multi-object collocation may change that.
    """
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
    # Per-lane "last annotated" moment: sequence annotation write or any
    # detection annotation write, whichever is later. updated_at is only set
    # on updates, so fall back to created_at for never-updated annotations.
    # Pre-aggregated join rather than a correlated subquery: watermark-filtered
    # (incremental) pulls aggregate every candidate group, so per-lane-row
    # subquery execution would dominate on large tables.
    det_ann_agg = (
        select(
            Detection.sequence_id.label("sequence_id"),
            func.max(
                func.coalesce(
                    DetectionAnnotation.updated_at, DetectionAnnotation.created_at
                )
            ).label("last_written_at"),
        )
        .join(DetectionAnnotation, DetectionAnnotation.detection_id == Detection.id)
        .group_by(Detection.sequence_id)
        .subquery()
    )
    lane_annotated_at = func.greatest(
        func.coalesce(SequenceAnnotation.updated_at, SequenceAnnotation.created_at),
        det_ann_agg.c.last_written_at,
    )
    exported_lane = SequenceAnnotation.is_unsure.is_not(True)

    total_lanes = func.count(Sequence.id)
    annotated_lanes = func.count(Sequence.id).filter(
        SequenceAnnotation.processing_stage
        == SequenceAnnotationProcessingStage.ANNOTATED
    )
    exported_lanes = func.count(Sequence.id).filter(exported_lane)
    last_annotated_at = func.max(lane_annotated_at).filter(exported_lane)
    # Alert start deliberately spans ALL lanes, unsure ones included — the
    # alert began when its first object appeared, exported or not.
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
        .outerjoin(det_ann_agg, det_ann_agg.c.sequence_id == Sequence.id)
        # Skipped alerts never export. The skip overlay is alert-level, so
        # this WHERE removes whole groups only. Submit guards should keep a
        # skipped alert from ever finishing, but the export doesn't bet
        # training data on that invariant.
        .where(~alert_skip_exists_clause(Sequence))
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

    # Lane-row WHERE is equivalent to alert-level filtering only because all
    # lanes of an alert share camera/org/source by import construction; it
    # must never shrink a group unevenly or the completeness gate would lie.
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

    # Advance the cursor from the page query, not the hydrated items: a row
    # whose lanes vanished between the two statements is skipped from items
    # but must still move the cursor forward.
    next_cursor = None
    if len(page_rows) == limit:
        last_row = page_rows[-1]
        next_cursor = f"{last_row.source_api.value}:{last_row.platform_alert_id}"

    return AlertExportPage(items=items, next_cursor=next_cursor)
