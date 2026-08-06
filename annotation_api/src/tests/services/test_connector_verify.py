"""Verify: authenticate, discover organizations idempotently, and probe whether
the credential actually sees more than one organization's sequences."""

from datetime import date, datetime

import pytest
from cryptography.fernet import Fernet
from sqlmodel import select

from app.core.config import settings
from app.models import AlertApiConnector, AlertApiConnectorOrganization, SourceApi
from app.services import connector_verify
from app.services.connector_verify import verify_connector
from app.services.secrets import encrypt_secret

ORGS = [
    {"id": 1, "name": "Ardeche"},
    {"id": 2, "name": "Aveyron"},
    {"id": 3, "name": "Gard"},
]
CAMERAS = [
    {"id": 10, "name": "cam-a", "organization_id": 1},
    {"id": 20, "name": "cam-b", "organization_id": 2},
]
SEQUENCES = [
    {"id": 100, "camera_id": 10},
    {"id": 101, "camera_id": 20},
    {"id": 102, "camera_id": 10},
]


@pytest.fixture
def secret_key(monkeypatch):
    monkeypatch.setattr(
        settings, "CONNECTOR_SECRET_KEY", Fernet.generate_key().decode()
    )


@pytest.fixture
def alert_api(monkeypatch):
    """Stub the alert API client at the seam connector_verify imports it from."""

    def fake_token(api_endpoint, username, password):
        if password != "good":
            raise RuntimeError("401 Unauthorized")
        return "tok"

    monkeypatch.setattr(
        connector_verify.alert_api_client, "get_api_access_token", fake_token
    )
    monkeypatch.setattr(
        connector_verify.alert_api_client, "list_organizations", lambda **kw: ORGS
    )
    monkeypatch.setattr(
        connector_verify.alert_api_client, "list_cameras", lambda **kw: CAMERAS
    )
    monkeypatch.setattr(
        connector_verify.alert_api_client,
        "list_sequences_for_date",
        lambda **kw: SEQUENCES,
    )


async def _connector(session, password="good"):
    connector = AlertApiConnector(
        name="Test",
        base_url="https://a.example",
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        login="admin",
        password_encrypted=encrypt_secret(password),
    )
    session.add(connector)
    await session.commit()
    await session.refresh(connector)
    return connector


async def test_discovers_and_persists_organizations(
    async_session, alert_api, secret_key
):
    connector = await _connector(async_session)
    result = await verify_connector(async_session, connector, today=date(2026, 8, 6))

    assert result.ok is True
    assert {org.organization_id for org in result.organizations} == {1, 2, 3}
    rows = (
        (await async_session.execute(select(AlertApiConnectorOrganization)))
        .scalars()
        .all()
    )
    assert len(rows) == 3
    assert all(row.is_enabled is False for row in rows)


async def test_rediscovery_is_idempotent_and_preserves_enabled(
    async_session, alert_api, secret_key
):
    connector = await _connector(async_session)
    await verify_connector(async_session, connector, today=date(2026, 8, 6))

    row = (
        (
            await async_session.execute(
                select(AlertApiConnectorOrganization).where(
                    AlertApiConnectorOrganization.organization_id == 2
                )
            )
        )
        .scalars()
        .one()
    )
    row.is_enabled = True
    row.enabled_at = datetime(2026, 8, 1)
    async_session.add(row)
    await async_session.commit()

    await verify_connector(async_session, connector, today=date(2026, 8, 6))

    rows = (
        (await async_session.execute(select(AlertApiConnectorOrganization)))
        .scalars()
        .all()
    )
    assert len(rows) == 3, "re-verifying must not duplicate organizations"
    assert [r.is_enabled for r in rows if r.organization_id == 2] == [True]


async def test_reports_organizations_seen_in_sample(
    async_session, alert_api, secret_key
):
    connector = await _connector(async_session)
    result = await verify_connector(async_session, connector, today=date(2026, 8, 6))

    # Sequences came from cameras in organizations 1 and 2, out of 3 known.
    assert result.organizations_seen_in_sample == 2
    assert result.organizations_total == 3
    assert result.sample_date == date(2026, 8, 5)


async def test_bad_credentials_record_error_and_do_not_raise(
    async_session, alert_api, secret_key
):
    connector = await _connector(async_session, password="bad")
    result = await verify_connector(async_session, connector, today=date(2026, 8, 6))

    assert result.ok is False
    assert result.error
    # Refresh explicitly: verify_connector commits, and reading an expired
    # attribute would trigger a sync lazy load, which async SQLAlchemy forbids
    # (MissingGreenlet).
    await async_session.refresh(connector)
    assert connector.last_verify_error
    assert connector.last_verified_at is None


async def test_success_clears_previous_error(async_session, alert_api, secret_key):
    connector = await _connector(async_session)
    connector.last_verify_error = "stale failure"
    async_session.add(connector)
    await async_session.commit()

    result = await verify_connector(async_session, connector, today=date(2026, 8, 6))

    assert result.ok is True
    await async_session.refresh(connector)
    assert connector.last_verify_error is None
    assert connector.last_verified_at is not None


async def test_error_message_never_contains_the_password(
    async_session, alert_api, secret_key
):
    connector = await _connector(async_session, password="bad")
    result = await verify_connector(async_session, connector, today=date(2026, 8, 6))
    assert "bad" not in (result.error or "")
