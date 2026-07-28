import importlib.util
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app.models import Sequence, SourceApi
from app.services.alert_identity import (
    ALERT_ID_BASE,
    decode_candidate,
    resolve_platform_alert_id,
)

_MIGRATION_PATH = (
    Path(__file__).parents[2]
    / "migrations"
    / "versions"
    / "2026_07_28_1000-c9d0e1f2a3b4_add_platform_alert_id.py"
)


def _load_backfill_sql() -> str:
    spec = importlib.util.spec_from_file_location("mig_platform_alert", _MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.BACKFILL


def test_decode_candidate_below_base_is_none():
    assert decode_candidate(170_000) is None


def test_decode_candidate_synthetic():
    # sid=170_000, object_index=2
    assert decode_candidate(ALERT_ID_BASE + 170_000 * 1000 + 2) == 170_000


@pytest.mark.asyncio
async def test_resolve_identity_for_non_platform_source(sequence_session):
    # alert_wildfire never uses the synthetic scheme, even >= 1e9
    got = await resolve_platform_alert_id(
        sequence_session, SourceApi.ALERT_WILDFIRE, ALERT_ID_BASE + 5_000
    )
    assert got == ALERT_ID_BASE + 5_000


@pytest.mark.asyncio
async def test_resolve_decodes_when_primary_exists(sequence_session):
    primary = (
        (
            await sequence_session.execute(
                select(Sequence).where(
                    Sequence.source_api == SourceApi.PYRONEAR_FRENCH_API
                )
            )
        )
        .scalars()
        .first()
    )
    synthetic = ALERT_ID_BASE + primary.alert_api_id * 1000 + 1
    got = await resolve_platform_alert_id(
        sequence_session, SourceApi.PYRONEAR_FRENCH_API, synthetic
    )
    assert got == primary.alert_api_id


@pytest.mark.asyncio
async def test_resolve_identity_when_no_primary(sequence_session):
    # crc32-style id >= 1e9 with no matching primary -> identity (singleton)
    orphan = ALERT_ID_BASE + 999_999_123
    got = await resolve_platform_alert_id(
        sequence_session, SourceApi.PYRONEAR_FRENCH_API, orphan
    )
    assert got == orphan


def _seq(id_, source_api, alert_api_id, platform_alert_id=0):
    now = datetime.now(UTC)
    return Sequence(
        id=id_,
        source_api=source_api,
        alert_api_id=alert_api_id,
        platform_alert_id=platform_alert_id,
        created_at=now,
        recorded_at=now,
        last_seen_at=now,
        camera_name=f"cam_{id_}",
        camera_id=id_,
        lat=0.0,
        lon=0.0,
        organisation_name="org",
        organisation_id=1,
    )


@pytest.mark.asyncio
async def test_backfill_sql_cases(async_session):
    rows = [
        # pyronear_french primary -> identity
        _seq(101, SourceApi.PYRONEAR_FRENCH_API, 170_000),
        # its synthetic sibling -> decoded to 170_000
        _seq(102, SourceApi.PYRONEAR_FRENCH_API, ALERT_ID_BASE + 170_000 * 1000 + 1),
        # crc32-style >= 1e9 with no primary (500_000 absent) -> identity
        _seq(103, SourceApi.PYRONEAR_FRENCH_API, 1_500_000_000),
        # api_cenia primary + sibling -> sibling decodes
        _seq(104, SourceApi.CENIA, 55),
        _seq(105, SourceApi.CENIA, ALERT_ID_BASE + 55 * 1000 + 2),
        # same numeric id under a non-platform source -> identity
        _seq(106, SourceApi.ALERT_WILDFIRE, ALERT_ID_BASE + 55 * 1000 + 2),
    ]
    for row in rows:
        async_session.add(row)
    await async_session.commit()

    await async_session.execute(text(_load_backfill_sql()))
    await async_session.commit()
    async_session.expire_all()

    expected = {
        101: 170_000,
        102: 170_000,
        103: 1_500_000_000,
        104: 55,
        105: 55,
        106: ALERT_ID_BASE + 55 * 1000 + 2,
    }
    got = {
        s.id: s.platform_alert_id
        for s in (
            (await async_session.execute(select(Sequence).where(Sequence.id >= 101)))
            .scalars()
            .all()
        )
    }
    assert got == expected
