"""procrastinate worker: runs the ONNX smoke detector over a sequence's
detections and writes the immutable ``detection.auto_predictions`` field.

Reworked model: the worker produces read-only model output; the human ground
truth is seeded from it at submit (it never writes detection annotations).
"""

import logging
from io import BytesIO

from PIL import Image
from procrastinate import App, PsycopgConnector
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.db import engine
from app.models import Detection
from app.services.smoke_detector import SmokeDetector
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
        annotated = 0
        for det in detections:
            try:
                image_bytes = bucket.download_file(det.bucket_key)
                preds = detector.predict(Image.open(BytesIO(image_bytes)))
            except Exception as exc:  # noqa: BLE001
                logger.warning("auto-annotate detection %s failed: %s", det.id, exc)
                continue
            # Immutable model output (AlgoPredictions shape); replaced wholesale
            # on re-run, so re-running is idempotent.
            det.auto_predictions = {
                "predictions": [
                    {
                        "xyxyn": [float(x1), float(y1), float(x2), float(y2)],
                        "confidence": float(conf),
                        "class_name": "smoke",
                    }
                    for (x1, y1, x2, y2, conf) in preds
                ]
            }
            session.add(det)
            annotated += 1
        await session.commit()
    logger.info(
        "auto-annotated sequence %s (%d/%d detections)",
        sequence_id,
        annotated,
        len(detections),
    )
