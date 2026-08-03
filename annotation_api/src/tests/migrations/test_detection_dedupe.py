"""Exercise the dedupe step of migration e1f2a3b4c5d6 against real duplicates.

The ordinary upgrade path in conftest always runs against empty tables, so the
temp-table/DELETE/UPDATE choreography that guards production data is never
executed. Here we downgrade one revision, seed the annotated-duplicate cases,
upgrade back to head, and assert survivors and annotation re-pointing.
"""

import asyncio
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"
PREV_REVISION = "d0e1f2a3b4c5"

SEED_SQL = """
INSERT INTO sequences (id, source_api, alert_api_id, platform_alert_id, camera_name,
                       camera_id, organisation_name, organisation_id, lat, lon,
                       recorded_at, created_at)
VALUES (900, 'PYRONEAR_FRENCH_API', 990001, 990001, 'cam', 1, 'org', 1, 0, 0, now(), now());

INSERT INTO detections (id, sequence_id, alert_api_id, recorded_at, created_at, bucket_key)
VALUES
    -- group A: survivor unannotated, doomed row annotated -> re-point
    (9001, 900, 1111, now(), now(), 'a1'),
    (9002, 900, 1111, now(), now(), 'a2'),
    -- group B: survivor annotated, doomed row annotated -> doomed annotation dropped
    (9011, 900, 2222, now(), now(), 'b1'),
    (9012, 900, 2222, now(), now(), 'b2'),
    -- group C: survivor unannotated, two annotated doomed rows -> keep earliest annotation
    (9021, 900, 3333, now(), now(), 'c1'),
    (9022, 900, 3333, now(), now(), 'c2'),
    (9023, 900, 3333, now(), now(), 'c3'),
    -- no duplicate: untouched
    (9031, 900, 4444, now(), now(), 'd1');

INSERT INTO detections_annotations (id, detection_id, annotation, processing_stage, created_at)
VALUES
    (8002, 9002, '{"annotation": []}'::jsonb, 'VISUAL_CHECK', now()),
    (8011, 9011, '{"annotation": []}'::jsonb, 'VISUAL_CHECK', now()),
    (8012, 9012, '{"annotation": []}'::jsonb, 'VISUAL_CHECK', now()),
    (8022, 9022, '{"annotation": []}'::jsonb, 'VISUAL_CHECK', now()),
    (8023, 9023, '{"annotation": []}'::jsonb, 'VISUAL_CHECK', now());
"""


def _alembic_config() -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    return cfg


@pytest.mark.asyncio
async def test_dedupe_keeps_earliest_detection_and_repoints_annotations(
    async_session: AsyncSession,
):
    # The session must be idle while alembic takes its ACCESS EXCLUSIVE locks,
    # so commit after every batch of session work.
    await asyncio.to_thread(command.downgrade, _alembic_config(), PREV_REVISION)

    for statement in SEED_SQL.split(";"):
        if statement.strip():
            await async_session.exec(text(statement))
    await async_session.commit()

    await asyncio.to_thread(command.upgrade, _alembic_config(), "head")

    surviving = await async_session.exec(
        text("SELECT id FROM detections WHERE sequence_id = 900 ORDER BY id")
    )
    assert [row[0] for row in surviving] == [9001, 9011, 9021, 9031]

    annotations = await async_session.exec(
        text(
            "SELECT id, detection_id FROM detections_annotations "
            "WHERE id BETWEEN 8000 AND 8999 ORDER BY id"
        )
    )
    assert [tuple(row) for row in annotations] == [
        (8002, 9001),  # group A: re-pointed to the survivor
        (8011, 9011),  # group B: survivor's own annotation kept, doomed's dropped
        (8022, 9021),  # group C: earliest of the doomed annotations, re-pointed
    ]

    constraint = await async_session.exec(
        text(
            "SELECT 1 FROM pg_constraint "
            "WHERE conname = 'uq_detection_sequence_alert_api_id'"
        )
    )
    assert constraint.first() is not None
    await async_session.commit()
