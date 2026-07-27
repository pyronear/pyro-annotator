"""procrastinate worker: runs the ONNX smoke detector over a sequence's
detections and writes the immutable ``detection.auto_predictions`` field.

Gap-fill model (mirrors ``make auto-annotate``): the engine predictions
(``algo_predictions``) sometimes miss the object on some frames. We aggregate
every detection's engine boxes, cluster them into persistent objects, then run
the high-recall sensitive detector per frame and keep only predictions that
overlap a persistent object. This fills the frames engine missed and drops
false positives that don't line up with any confirmed object. The result is
read-only reference; the human ground truth is seeded from it at submit.
"""

import logging
from io import BytesIO
from typing import Sequence

import numpy as np
from PIL import Image
from procrastinate import App, PsycopgConnector
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.crud import UserCRUD
from app.db import engine
from app.models import Detection
from app.services.group_assignment import assign_ungrouped_sequences
from app.services.smoke_detector import (
    SmokeDetector,
    group_and_merge_boxes,
    keep_boxes_overlapping,
)
from app.services.storage import s3_service

logger = logging.getLogger(__name__)

app = App(connector=PsycopgConnector(conninfo=settings.procrastinate_dsn))

_detector: SmokeDetector | None = None


def get_detector() -> SmokeDetector:
    global _detector
    if _detector is None:
        _detector = SmokeDetector(
            model_path=settings.AUTOANNOTATE_MODEL_PATH,
            conf=settings.AUTOANNOTATE_CONF,
            iou=settings.AUTOANNOTATE_IOU,
            imgsz=settings.AUTOANNOTATE_IMGSZ,
        )
    return _detector


def engine_seed_boxes(detections: Sequence[Detection]) -> np.ndarray:
    """Aggregate every detection's engine (algo_predictions) boxes into a single
    ``(N, 5)`` ``[x1, y1, x2, y2, conf]`` array — the anchor that localizes the
    sequence's real objects."""
    rows = []
    for det in detections:
        for p in (det.algo_predictions or {}).get("predictions", []):
            x1, y1, x2, y2 = p["xyxyn"]
            rows.append([x1, y1, x2, y2, p.get("confidence", 1.0)])
    return np.array(rows, dtype=np.float64) if rows else np.zeros((0, 5))


@app.task(name="auto_annotate_sequence")
async def auto_annotate_sequence(sequence_id: int) -> None:
    detector = get_detector()
    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
    async with AsyncSession(engine) as session:
        detections = (
            (
                await session.execute(
                    select(Detection).where(Detection.sequence_id == sequence_id)
                )
            )
            .scalars()
            .all()
        )

        # Aggregate engine predictions across the sequence and cluster them into
        # persistent objects. Every member box of every group is an anchor: a
        # sensitive-model prediction is kept only if it overlaps one of them.
        _, groups = group_and_merge_boxes(
            engine_seed_boxes(detections),
            iou_nms=settings.AUTOANNOTATE_GROUP_IOU_NMS,
            threshold=settings.AUTOANNOTATE_GROUP_IOU_ASSIGN,
        )
        anchor = (
            np.vstack([g[:, :4] for g in groups.values()])
            if groups
            else np.zeros((0, 4))
        )

        annotated = 0
        for det in detections:
            try:
                image_bytes = bucket.download_file(det.bucket_key)
                preds = detector.predict(Image.open(BytesIO(image_bytes)))
            except Exception as exc:  # noqa: BLE001
                logger.warning("auto-annotate detection %s failed: %s", det.id, exc)
                continue
            # Keep only predictions overlapping an engine-confirmed object; write
            # them (immutable, whole-replace -> re-running is idempotent).
            kept = keep_boxes_overlapping(preds, anchor)
            det.auto_predictions = {
                "predictions": [
                    {
                        "xyxyn": [float(x1), float(y1), float(x2), float(y2)],
                        "confidence": float(conf),
                        "class_name": "smoke",
                    }
                    for (x1, y1, x2, y2, conf) in kept
                ]
            }
            session.add(det)
            annotated += 1
        await session.commit()
    logger.info(
        "auto-annotated sequence %s (%d/%d detections, %d anchor boxes)",
        sequence_id,
        annotated,
        len(detections),
        anchor.shape[0],
    )


@app.periodic(cron="*/5 * * * *")
@app.task(name="assign_sequence_groups", queueing_lock="assign_sequence_groups")
async def assign_sequence_groups(timestamp: int) -> None:
    """Periodic sweep: assign every ungrouped, fully-imported sequence to a
    sequence group (see ``app.services.group_assignment``). Inherited
    annotations are attributed to the admin user, which the API seeds at
    startup from AUTH_USERNAME."""
    async with AsyncSession(engine) as session:
        admin = await UserCRUD(session).get_by_username(settings.AUTH_USERNAME)
        if admin is None:
            logger.warning(
                "assign_sequence_groups: admin user %r not found; skipping run",
                settings.AUTH_USERNAME,
            )
            return
        result = await assign_ungrouped_sequences(session, user_id=admin.id)
    if result.already_running:
        logger.info("assign_sequence_groups: another run in progress; skipped")
        return
    logger.info(
        "assign_sequence_groups: processed=%d new_groups=%d joined=%d "
        "inherited=%d skipped_no_bbox=%d",
        result.processed,
        result.new_groups,
        result.joined_existing,
        result.inherited_annotations,
        result.skipped_no_bbox,
    )
