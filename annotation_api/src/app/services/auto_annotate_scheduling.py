# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Per-alert auto-annotate gating (spec: smoke-localization entry point).

An alert (source_api, platform_alert_id) is ready when EVERY sibling sequence
has an annotation at a done stage. Then each lane matching the localization
rule (see `localization_rule`) still at seq_annotation_done and not yet
enqueued gets ``auto_annotate_enqueued_at`` stamped; the worker defers one job
per returned id.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, case, func, or_, select, tuple_
from sqlalchemy.orm import aliased
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import (
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
)
from app.services.localization_rule import needs_localization_clause

DONE_STAGES = (
    SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
    SequenceAnnotationProcessingStage.ANNOTATED,
)

# Reconciliation: a lane stamped this long ago whose auto_annotated_at never
# landed is considered lost (defer failed after commit, job crashed, worker
# died) and is re-enqueued. auto_annotate_sequence is idempotent
# (whole-replace), so re-running is safe.
RETRY_STALE_AFTER = timedelta(hours=1)


def complete_alerts_subquery(candidates=None):
    """(source_api, platform_alert_id) pairs where every sibling has a
    done-stage annotation. The outer join makes annotation-less siblings
    count as not-done (NULL stage falls into the CASE else).

    ``candidates`` (a select of (source_api, platform_alert_id)) restricts the
    grouping before it aggregates, so the scan is proportional to the caller's
    working set rather than all history (#215). Purely a cost bound — callers
    must only pass a set that already contains every alert they can act on."""
    query = select(Sequence.source_api, Sequence.platform_alert_id).outerjoin(
        SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id
    )
    if candidates is not None:
        query = query.where(
            tuple_(Sequence.source_api, Sequence.platform_alert_id).in_(candidates)
        )
    return (
        query.group_by(Sequence.source_api, Sequence.platform_alert_id)
        .having(
            func.count()
            == func.sum(
                case((SequenceAnnotation.processing_stage.in_(DONE_STAGES), 1), else_=0)
            )
        )
        .subquery()
    )


def _pending_ready_lane(seq, ann, now):
    """Lane matching the localization rule (see `localization_rule`) still
    awaiting auto-annotation: at seq_annotation_done and either never enqueued
    or lost (see RETRY_STALE_AFTER). Parameterized over (possibly aliased)
    Sequence/SequenceAnnotation."""
    return and_(
        ann.processing_stage == SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
        needs_localization_clause(ann),
        or_(
            seq.auto_annotate_enqueued_at.is_(None),
            # Lost-job reconciliation (see RETRY_STALE_AFTER).
            and_(
                seq.auto_annotated_at.is_(None),
                seq.auto_annotate_enqueued_at < now - RETRY_STALE_AFTER,
            ),
        ),
    )


async def schedule_pending_auto_annotate(session: AsyncSession) -> list[int]:
    now = datetime.now(UTC)
    # Only alerts with at least one pending lane can produce work; restricting
    # the completeness aggregation to them keeps the sweep proportional to the
    # active working set instead of all history (#215).
    cand_seq = aliased(Sequence)
    cand_ann = aliased(SequenceAnnotation)
    candidates = (
        select(cand_seq.source_api, cand_seq.platform_alert_id)
        .join(cand_ann, cand_ann.sequence_id == cand_seq.id)
        .where(_pending_ready_lane(cand_seq, cand_ann, now))
    )
    complete = complete_alerts_subquery(candidates)
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
                .where(_pending_ready_lane(Sequence, SequenceAnnotation, now))
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
