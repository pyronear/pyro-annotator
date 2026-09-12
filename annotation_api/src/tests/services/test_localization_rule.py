from datetime import datetime

import pytest
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import (
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
    SourceApi,
)
from app.services.localization_rule import (
    needs_localization,
    needs_localization_clause,
)

NOW = datetime(2026, 1, 1, 0, 0, 0)

# (has_smoke, has_missed_smoke, is_unsure, smoke_types, expected)
TRUTH_TABLE = [
    # Only wildfire is boxed.
    (True, False, False, ["wildfire"], True),
    (True, False, False, ["industrial"], False),
    (True, False, False, ["other"], False),
    (True, False, False, ["industrial", "wildfire"], True),  # mixed keeps wildfire
    # An empty or absent type list is UNKNOWN, never wildfire.
    (True, False, False, [], False),
    (True, False, False, None, False),
    # Missed smoke localizes whatever the type: nothing has typed it yet.
    (False, True, False, [], True),
    (False, True, False, ["industrial"], True),
    (True, True, False, ["industrial"], True),
    (True, True, False, ["wildfire"], True),
    # FP-only lanes never localize.
    (False, False, False, [], False),
    (False, False, False, ["wildfire"], False),  # stale types, no smoke flag
    # Unsure withholds every combination.
    (True, False, True, ["wildfire"], False),
    (False, True, True, [], False),
    (True, True, True, ["wildfire"], False),
    (False, False, True, [], False),
]


@pytest.mark.parametrize(
    ("has_smoke", "has_missed_smoke", "is_unsure", "smoke_types", "expected"),
    TRUTH_TABLE,
)
def test_needs_localization_truth_table(
    has_smoke, has_missed_smoke, is_unsure, smoke_types, expected
):
    assert (
        needs_localization(has_smoke, has_missed_smoke, is_unsure, smoke_types)
        is expected
    )


def test_needs_localization_requires_smoke_types():
    """The 4th argument has no default: a stale 3-arg caller must fail loudly
    rather than silently fall back to the any-smoke behaviour."""
    with pytest.raises(TypeError):
        needs_localization(True, False, False)


@pytest.mark.asyncio
async def test_sql_clause_matches_python_rule(async_session: AsyncSession):
    """The two forms must agree row for row.

    They cannot share code, so the only guard against drift is running the
    same truth table through Postgres. A mismatch here is what silently
    empties or floods the localization queue.
    """
    expected_ids = []
    for idx, (has_smoke, missed, unsure, types, expected) in enumerate(TRUTH_TABLE):
        seq = Sequence(
            source_api=SourceApi.PYRONEAR_FRENCH_API,
            alert_api_id=900_000 + idx,
            platform_alert_id=900_000 + idx,
            created_at=NOW,
            recorded_at=NOW,
            last_seen_at=NOW,
            camera_name="cam",
            camera_id=1,
            lat=0.0,
            lon=0.0,
            organisation_name="org",
            organisation_id=1,
        )
        async_session.add(seq)
        await async_session.flush()
        ann = SequenceAnnotation(
            sequence_id=seq.id,
            has_smoke=has_smoke,
            has_false_positives=False,
            false_positive_types=[],
            # verbatim, so the None row really stores SQL NULL
            smoke_types=types,
            has_missed_smoke=missed,
            is_unsure=unsure,
            annotation={"sequences_bbox": []},
            processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
        )
        async_session.add(ann)
        await async_session.flush()
        if expected:
            expected_ids.append(ann.id)

    result = await async_session.execute(
        select(SequenceAnnotation.id).where(
            needs_localization_clause(SequenceAnnotation)
        )
    )
    assert sorted(result.scalars().all()) == sorted(expected_ids)
