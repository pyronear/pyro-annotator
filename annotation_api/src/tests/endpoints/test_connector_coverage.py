"""Organization toggling stamps enabled_at once; coverage reads are windowed."""

from datetime import UTC, date, datetime, timedelta

import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.db import get_session
from app.main import app
from app.models import (
    AlertApiConnector,
    AlertApiConnectorOrganization,
    AlertApiImportCoverage,
    ImportCoverageStatus,
    SourceApi,
)
from app.services.secrets import encrypt_secret


@pytest.fixture
def secret_key(monkeypatch):
    monkeypatch.setattr(
        settings, "CONNECTOR_SECRET_KEY", Fernet.generate_key().decode()
    )


@pytest.fixture
async def connector(async_session, secret_key):
    row = AlertApiConnector(
        name="Test",
        base_url="https://a.example",
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        login="admin",
        password_encrypted=encrypt_secret("pw"),
    )
    async_session.add(row)
    await async_session.commit()
    await async_session.refresh(row)
    async_session.add(
        AlertApiConnectorOrganization(
            connector_id=row.id, organization_id=1, name="Ardeche"
        )
    )
    await async_session.commit()
    return row


async def test_enabling_an_org_stamps_enabled_at(authenticated_client, connector):
    response = await authenticated_client.patch(
        f"/connectors/{connector.id}/organizations/1", json={"is_enabled": True}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_enabled"] is True
    assert body["enabled_at"] is not None


async def test_disabling_keeps_the_original_enabled_at(authenticated_client, connector):
    first = (
        await authenticated_client.patch(
            f"/connectors/{connector.id}/organizations/1", json={"is_enabled": True}
        )
    ).json()
    await authenticated_client.patch(
        f"/connectors/{connector.id}/organizations/1", json={"is_enabled": False}
    )
    again = (
        await authenticated_client.patch(
            f"/connectors/{connector.id}/organizations/1", json={"is_enabled": True}
        )
    ).json()
    # enabled_at marks when the org FIRST entered ingestion — the heatmap uses it
    # to grey out days that predate it, so re-enabling must not move it.
    assert again["enabled_at"] == first["enabled_at"]


async def test_unknown_org_returns_404(authenticated_client, connector):
    response = await authenticated_client.patch(
        f"/connectors/{connector.id}/organizations/999", json={"is_enabled": True}
    )
    assert response.status_code == 404
    assert (
        response.json()["detail"]
        == "Organization not found on this connector; run verify first."
    )


async def test_coverage_is_filtered_by_window(
    authenticated_client, connector, async_session
):
    # 08-04 and 08-06 sit exactly on the window's bounds — they must be
    # included, proving the filter is inclusive (>=/<=), not exclusive (>/<).
    for day in (
        date(2026, 8, 1),
        date(2026, 8, 4),
        date(2026, 8, 5),
        date(2026, 8, 6),
        date(2026, 8, 9),
    ):
        async_session.add(
            AlertApiImportCoverage(
                connector_id=connector.id,
                organization_id=1,
                covered_date=day,
                status=ImportCoverageStatus.OK,
                alerts_imported=2,
            )
        )
    await async_session.commit()

    response = await authenticated_client.get(
        f"/connectors/{connector.id}/coverage",
        params={"date_from": "2026-08-04", "date_end": "2026-08-06"},
    )
    assert response.status_code == 200
    body = response.json()
    assert [cell["covered_date"] for cell in body] == [
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
    ]
    assert body[0]["alerts_imported"] == 2


async def test_coverage_defaults_to_the_last_30_days(
    authenticated_client, connector, async_session
):
    # Derive expected bounds the same way the endpoint does (datetime.now(UTC).date())
    # rather than hardcoding dates, so the test is timezone-independent.
    today = datetime.now(UTC).date()
    window_start = today - timedelta(days=29)
    just_outside_window = today - timedelta(days=30)
    for day in (just_outside_window, window_start, today):
        async_session.add(
            AlertApiImportCoverage(
                connector_id=connector.id,
                organization_id=1,
                covered_date=day,
                status=ImportCoverageStatus.OK,
                alerts_imported=1,
            )
        )
    await async_session.commit()

    response = await authenticated_client.get(f"/connectors/{connector.id}/coverage")
    assert response.status_code == 200
    covered_dates = [cell["covered_date"] for cell in response.json()]
    assert covered_dates == [window_start.isoformat(), today.isoformat()]
    assert just_outside_window.isoformat() not in covered_dates


async def test_regular_user_cannot_read_coverage(
    async_session, regular_user_token, connector
):
    async def get_test_session():
        yield async_session

    app.dependency_overrides[get_session] = get_test_session
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=f"http://api.localhost:8050{settings.API_V1_STR}",
        headers={"Authorization": f"Bearer {regular_user_token}"},
        follow_redirects=True,
        timeout=5,
    ) as client:
        response = await client.get(f"/connectors/{connector.id}/coverage")
    app.dependency_overrides.clear()
    assert response.status_code == 403
