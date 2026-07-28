# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Per-alert auto-annotate gating (spec: smoke-localization entry point).

An alert (source_api, platform_alert_id) is ready when EVERY sibling sequence
has an annotation at a done stage. Then each smoke lane (has_smoke, not
unsure) still at seq_annotation_done and not yet enqueued gets
``auto_annotate_enqueued_at`` stamped; the worker defers one job per returned
id.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, case, func, or_, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import (
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
)

# in_review is legacy compatibility (no live writers); see issue #207.
DONE_STAGES = (
    SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
    SequenceAnnotationProcessingStage.IN_REVIEW,
    SequenceAnnotationProcessingStage.ANNOTATED,
)

# Reconciliation: a lane stamped this long ago whose auto_annotated_at never
# landed is considered lost (defer failed after commit, job crashed, worker
# died) and is re-enqueued. auto_annotate_sequence is idempotent
# (whole-replace), so re-running is safe.
RETRY_STALE_AFTER = timedelta(hours=1)


def complete_alerts_subquery():
    """(source_api, platform_alert_id) pairs where every sibling has a
    done-stage annotation. The outer join makes annotation-less siblings
    count as not-done (NULL stage falls into the CASE else)."""
    return (
        select(Sequence.source_api, Sequence.platform_alert_id)
        .outerjoin(SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id)
        .group_by(Sequence.source_api, Sequence.platform_alert_id)
        .having(
            func.count()
            == func.sum(
                case((SequenceAnnotation.processing_stage.in_(DONE_STAGES), 1), else_=0)
            )
        )
        .subquery()
    )


async def schedule_pending_auto_annotate(session: AsyncSession) -> list[int]:
    now = datetime.now(UTC)
    complete = complete_alerts_subquery()
    lanes = (
        (
            await session.execute(
                select(Sequence)
                .join(
                    SequenceAnnotation,
                    SequenceAnnotation.sequence_id == Sequence.id,
                )
                .join(
                    complete,
                    and_(
                        complete.c.source_api == Sequence.source_api,
                        complete.c.platform_alert_id == Sequence.platform_alert_id,
                    ),
                )
                .where(
                    SequenceAnnotation.processing_stage
                    == SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
                    SequenceAnnotation.has_smoke.is_(True),
                    SequenceAnnotation.is_unsure.is_(False),
                    or_(
                        Sequence.auto_annotate_enqueued_at.is_(None),
                        # Lost-job reconciliation (see RETRY_STALE_AFTER).
                        and_(
                            Sequence.auto_annotated_at.is_(None),
                            Sequence.auto_annotate_enqueued_at
                            < now - RETRY_STALE_AFTER,
                        ),
                    ),
                )
                .order_by(Sequence.id)
            )
        )
        .scalars()
        .all()
    )
    lane_ids = [lane.id for lane in lanes]
    for lane in lanes:
        lane.auto_annotate_enqueued_at = now
        session.add(lane)
    await session.commit()
    return lane_ids
