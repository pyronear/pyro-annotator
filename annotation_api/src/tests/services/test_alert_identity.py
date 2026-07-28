import pytest
from sqlalchemy import select

from app.models import Sequence, SourceApi
from app.services.alert_identity import (
    ALERT_ID_BASE,
    decode_candidate,
    resolve_platform_alert_id,
)


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
