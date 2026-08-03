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
"""

from sqlalchemy import and_, or_


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
