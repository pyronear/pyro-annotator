"""The worker authenticates to its own API with a self-minted JWT — no password
in its environment, and no dependency on the API having seeded users first.

The third test is a PINNING test. app.api.dependencies.get_current_user is an
alias for get_current_active_user (see that module), so the worker user MUST be
seeded active (app/main.py) for a minted token to be accepted by the sequence and
detection endpoints — login stays blocked separately, by the random discarded
password (see test_worker_user_cannot_login in test_user_seeding.py). If the
worker seed is ever flipped back to inactive, or the sequence endpoint's auth
dependency changes shape, this test fails instead of nightly imports silently
breaking.
"""

from datetime import UTC, datetime, timedelta

from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import verify_token
from app.core.config import settings
from app.db import get_session
from app.main import app
from app.services.worker_auth import mint_worker_token

_now = datetime.now(UTC)

# Copied from a known-good payload in src/tests/endpoints/test_sequence.py
# (test_create_sequence, ~line 20-33) — SequenceCreate is strict and the
# endpoint parses these as Form fields, not a JSON body.
SEQUENCE_PAYLOAD = {
    "source_api": "pyronear_french",
    "alert_api_id": "100",
    "camera_name": "test_cam",
    "camera_id": "1",
    "organisation_name": "test_org",
    "organisation_id": "1",
    "is_wildfire_alertapi": "wildfire_smoke",
    "azimuth": "90",
    "lat": "0.0",
    "lon": "0.0",
    "created_at": (_now - timedelta(days=1)).isoformat(),
    "recorded_at": (_now - timedelta(days=1)).isoformat(),
    "last_seen_at": _now.isoformat(),
}


async def test_returns_none_when_worker_user_absent(async_session):
    assert await mint_worker_token(async_session) is None


async def test_mints_a_token_for_the_worker_user(async_session, worker_user):
    token = await mint_worker_token(async_session)
    assert token is not None
    payload = verify_token(token)
    assert payload.user_id == worker_user.id
    assert payload.username == worker_user.username


async def test_worker_token_can_create_a_sequence(async_session, worker_user):
    """PINNING TEST — see the module docstring. Do not delete this to make a
    refactor pass; if it fails, the worker needs a different identity."""
    token = await mint_worker_token(async_session)

    async def get_test_session():
        yield async_session

    app.dependency_overrides[get_session] = get_test_session
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=f"http://api.localhost:8050{settings.API_V1_STR}",
        headers={"Authorization": f"Bearer {token}"},
        follow_redirects=True,
        timeout=5,
    ) as client:
        response = await client.post("/sequences/", data=SEQUENCE_PAYLOAD)
    app.dependency_overrides.clear()

    assert response.status_code in (200, 201), (
        f"Worker-minted token was rejected ({response.status_code}): {response.text}. "
        "Either the worker seed was flipped back to inactive, or the sequence "
        "endpoint's auth dependency changed — see this module's docstring."
    )
