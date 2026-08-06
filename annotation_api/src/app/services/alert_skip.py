# Copyright (C) 2026, Pyronear.

"""Alert-skip overlay predicate shared by queue endpoints and submit guards.

The skip is an anti-join on alert identity (source_api, platform_alert_id),
not a lane predicate — it deliberately lives outside localization_rule.py
(docs/specs/2026-08-05-alert-skip-escape-hatch-design.md).
"""

from sqlalchemy import and_, exists

from app.models import AlertSkip


def alert_skip_exists_clause(seq):
    """Correlated EXISTS: the sequence's alert has a skip row.

    ``seq`` is the Sequence class or an alias of it.
    """
    return exists().where(
        and_(
            AlertSkip.source_api == seq.source_api,
            AlertSkip.platform_alert_id == seq.platform_alert_id,
        )
    )
