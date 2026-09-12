# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Localization rule (spec: multi-object alert collocation, sub-project 1).

A lane needs localization when it carries WILDFIRE smoke on its own tracked
object, or smoke outside any proposed track (has_missed_smoke), and is not
unsure:

    ((has_smoke AND wildfire in smoke_types) OR has_missed_smoke)
        AND NOT is_unsure

Only wildfire is boxed. Industrial and other smoke are classified and done —
they are not training targets for the detector, so spending localization
effort on them buys nothing.

``has_missed_smoke`` localizes whatever its type: the annotator flagged smoke
no proposed track covers, so nothing has assigned it a type yet. An empty
``smoke_types`` means UNKNOWN, not wildfire, and does not localize on its own.

Single source of truth for the auto-annotate sweep, the localization queue,
the submit exit guard, and the GET /sequences needs_localization filter. The
rule exists in two forms because SQL clauses and Python booleans cannot share
code; keep them in lockstep.

The module also owns the complementary question of whether a lane is SETTLED
— see `unsettled_unsure_clause`. Needing localization is about one lane's own
work; being unsettled is about what a lane does to its siblings.
"""

from collections.abc import Iterable

from sqlalchemy import and_, func, or_

from app.models import SequenceAnnotationProcessingStage, SmokeType


def needs_localization(
    has_smoke: bool,
    has_missed_smoke: bool,
    is_unsure: bool,
    smoke_types: Iterable[str] | None,
) -> bool:
    """Python form of the rule.

    ``smoke_types`` has no default on purpose: a caller that forgets it fails
    loudly instead of silently reverting to the any-smoke behaviour.
    """
    has_wildfire = SmokeType.WILDFIRE.value in (smoke_types or ())
    return ((has_smoke and has_wildfire) or has_missed_smoke) and not is_unsure


def needs_localization_clause(ann):
    """SQL form of the rule over a (possibly aliased) SequenceAnnotation.

    ``@>`` is the JSONB containment operator, served by the GIN index on
    smoke_types (see SequenceAnnotation.__table_args__). Wrapped in
    ``coalesce`` because the column is nullable and NULL @> x is NULL, which
    would drop the row from an OR instead of reading as false.
    """
    has_wildfire = func.coalesce(
        ann.smoke_types.op("@>")(func.jsonb_build_array(SmokeType.WILDFIRE.value)),
        False,
    )
    return and_(
        or_(
            and_(ann.has_smoke.is_(True), has_wildfire),
            ann.has_missed_smoke.is_(True),
        ),
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
