"""The import job: window, organization filter, and coverage bookkeeping."""

from datetime import date, datetime

import pytest
from cryptography.fernet import Fernet
from sqlmodel import select

from app.core.config import settings
from app.models import (
    AlertApiConnector,
    AlertApiConnectorOrganization,
    AlertApiImportCoverage,
    ImportCoverageStatus,
    SourceApi,
)
from app.services import connector_import
from app.services.connector_import import import_connector
from app.services.secrets import encrypt_secret
from scripts.data_transfer.ingestion.alert_api.runner import (
    ImportResult,
    OrganizationStats,
)


async def _fake_token(session):
    return "worker-token"


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
        trailing_days=2,
    )
    async_session.add(row)
    await async_session.commit()
    await async_session.refresh(row)
    async_session.add(
        AlertApiConnectorOrganization(
            connector_id=row.id,
            organization_id=1,
            name="Ardeche",
            is_enabled=True,
            enabled_at=datetime(2026, 1, 1),
        )
    )
    async_session.add(
        AlertApiConnectorOrganization(
            connector_id=row.id, organization_id=2, name="Aveyron", is_enabled=False
        )
    )
    await async_session.commit()
    return row


@pytest.fixture
def captured(monkeypatch):
    """Capture every ImportConfig run_import is called with."""
    calls = []

    def fake_run_import(config):
        calls.append(config)
        return ImportResult(
            per_organization={
                1: OrganizationStats(
                    alerts_fetched=5,
                    alerts_imported=3,
                    alerts_skipped=2,
                    lanes_created=4,
                )
            }
        )

    monkeypatch.setattr(connector_import, "run_import", fake_run_import)
    monkeypatch.setattr(connector_import, "mint_worker_token", _fake_token)
    return calls


async def test_runs_one_import_per_day_in_the_window(
    async_session, connector, captured
):
    await import_connector(async_session, connector, today=date(2026, 8, 6))
    # trailing_days=2 -> Aug 4 and Aug 5. Today is never imported: the day is
    # still in progress on the alert API.
    assert [c.date_from for c in captured] == [date(2026, 8, 4), date(2026, 8, 5)]
    assert all(c.date_from == c.date_end for c in captured)


async def test_passes_only_enabled_organizations(async_session, connector, captured):
    await import_connector(async_session, connector, today=date(2026, 8, 6))
    assert captured[0].organization_ids == {1}


async def test_passes_the_minted_worker_token_to_every_days_config(
    async_session, connector, captured
):
    await import_connector(async_session, connector, today=date(2026, 8, 6))
    assert len(captured) == 2
    assert all(c.annotation_api_token == "worker-token" for c in captured)


async def test_writes_a_coverage_row_per_enabled_org_per_day(
    async_session, connector, captured
):
    await import_connector(async_session, connector, today=date(2026, 8, 6))
    rows = (await async_session.execute(select(AlertApiImportCoverage))).scalars().all()
    assert {(r.organization_id, r.covered_date) for r in rows} == {
        (1, date(2026, 8, 4)),
        (1, date(2026, 8, 5)),
    }
    assert rows[0].status == ImportCoverageStatus.OK
    assert rows[0].alerts_imported == 3
    assert rows[0].lanes_created == 4


async def test_org_with_no_alerts_gets_an_ok_row_with_zeroes(
    async_session, connector, monkeypatch
):
    monkeypatch.setattr(connector_import, "mint_worker_token", _fake_token)
    monkeypatch.setattr(
        connector_import, "run_import", lambda config: ImportResult(per_organization={})
    )
    await import_connector(async_session, connector, today=date(2026, 8, 6))
    rows = (await async_session.execute(select(AlertApiImportCoverage))).scalars().all()
    assert len(rows) == 2
    assert all(r.status == ImportCoverageStatus.OK for r in rows)
    assert all(r.alerts_fetched == 0 for r in rows)


async def test_connector_failure_marks_every_enabled_org_failed(
    async_session, connector, monkeypatch
):
    monkeypatch.setattr(connector_import, "mint_worker_token", _fake_token)

    def boom(config):
        raise RuntimeError("alert API down")

    monkeypatch.setattr(connector_import, "run_import", boom)
    await import_connector(async_session, connector, today=date(2026, 8, 6))

    rows = (await async_session.execute(select(AlertApiImportCoverage))).scalars().all()
    assert len(rows) == 2
    assert all(r.status == ImportCoverageStatus.FAILED for r in rows)
    assert all("alert API down" in (r.error or "") for r in rows)


async def test_partial_status_when_some_alerts_failed(
    async_session, connector, monkeypatch
):
    monkeypatch.setattr(connector_import, "mint_worker_token", _fake_token)
    monkeypatch.setattr(
        connector_import,
        "run_import",
        lambda config: ImportResult(
            per_organization={
                1: OrganizationStats(
                    alerts_fetched=5, alerts_imported=3, alerts_failed=2
                )
            }
        ),
    )
    await import_connector(async_session, connector, today=date(2026, 8, 6))
    rows = (await async_session.execute(select(AlertApiImportCoverage))).scalars().all()
    assert all(r.status == ImportCoverageStatus.PARTIAL for r in rows)


async def test_rerunning_the_same_day_updates_rather_than_duplicates(
    async_session, connector, captured
):
    await import_connector(async_session, connector, today=date(2026, 8, 6))
    await import_connector(async_session, connector, today=date(2026, 8, 6))
    rows = (await async_session.execute(select(AlertApiImportCoverage))).scalars().all()
    assert len(rows) == 2


async def test_missing_secret_key_skips_without_writing_coverage(
    async_session, connector, monkeypatch
):
    monkeypatch.setattr(settings, "CONNECTOR_SECRET_KEY", "")
    monkeypatch.setattr(connector_import, "mint_worker_token", _fake_token)
    await import_connector(async_session, connector, today=date(2026, 8, 6))
    rows = (await async_session.execute(select(AlertApiImportCoverage))).scalars().all()
    assert rows == []


async def test_connector_with_no_enabled_orgs_does_nothing(
    async_session, connector, captured
):
    orgs = (
        (await async_session.execute(select(AlertApiConnectorOrganization)))
        .scalars()
        .all()
    )
    for org in orgs:
        org.is_enabled = False
        async_session.add(org)
    await async_session.commit()

    await import_connector(async_session, connector, today=date(2026, 8, 6))
    assert captured == []


async def test_missing_worker_token_skips_without_importing(
    async_session, connector, monkeypatch
):
    """The worker user not existing yet (e.g. a cold-boot race with the API's
    seeding) must stop before any alert-API call — never fall back to a
    plaintext credential."""
    calls = []

    async def no_token(session):
        return None

    def fake_run_import(config):
        calls.append(config)
        return ImportResult(per_organization={})

    monkeypatch.setattr(connector_import, "mint_worker_token", no_token)
    monkeypatch.setattr(connector_import, "run_import", fake_run_import)

    await import_connector(async_session, connector, today=date(2026, 8, 6))

    assert calls == []
    rows = (await async_session.execute(select(AlertApiImportCoverage))).scalars().all()
    assert rows == []


async def test_db_failure_mid_loop_does_not_propagate(
    async_session, connector, captured, monkeypatch
):
    """A DB-layer failure (here: the coverage commit) anywhere in the
    function — not just around run_import — must be swallowed, not raised."""

    async def boom_commit():
        raise RuntimeError("db down")

    monkeypatch.setattr(async_session, "commit", boom_commit)

    await import_connector(async_session, connector, today=date(2026, 8, 6))

    # The first day's run_import call happened before the commit failed.
    assert len(captured) == 1
