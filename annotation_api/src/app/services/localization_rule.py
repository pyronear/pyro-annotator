# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Localization rule (spec: multi-object alert collocation, sub-project 1).

A lane needs localization when it has smoke anywhere — its own tracked object
(has_smoke) or smoke outside any proposed track (has_missed_smoke) — and is
not unsure:

    (has_smoke OR has_missed_smoke) AND NOT is_unsure

Single source of truth for the auto-annotate sweep, the localization queue,
the submit exit guard, and the GET /sequences needs_localization filter. The
rule exists in two forms because SQL clauses and Python booleans cannot share
code; keep them in lockstep.

The module also owns the complementary question of whether a lane is SETTLED
— see `unsettled_unsure_clause`. Needing localization is about one lane's own
work; being unsettled is about what a lane does to its siblings.
"""

from sqlalchemy import and_, or_

from app.models import SequenceAnnotationProcessingStage


def needs_localization(
    has_smoke: bool, has_missed_smoke: bool, is_unsure: bool
) -> bool:
    """Python form of the rule."""
    return (has_smoke or has_missed_smoke) and not is_unsure


def needs_localization_clause(ann):
    """SQL form of the rule over a (possibly aliased) SequenceAnnotation."""
    return and_(
        or_(ann.has_smoke.is_(True), ann.has_missed_smoke.is_(True)),
        ann.is_unsure.is_(False),
    )


def unsettled_unsure_clause(ann):
    """A lane still marked unsure and parked awaiting a decision. Such a
    lane withholds its whole alert from localization (spec: 2026-08-05
    unsure lanes gate the localize queue) — an alert is not ready to be
    boxed while one of its objects is undecided. Settling it as undecidable
    moves it to annotated with is_unsure kept, which this clause excludes.
    Parameterized over a (possibly aliased) SequenceAnnotation."""
    return and_(
        ann.is_unsure.is_(True),
        ann.processing_stage == SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
    )
