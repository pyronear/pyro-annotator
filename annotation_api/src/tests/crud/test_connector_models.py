"""The three connector tables exist with the constraints the design relies on."""

from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.models import (
    AlertApiConnector,
    AlertApiConnectorOrganization,
    AlertApiImportCoverage,
    ImportCoverageStatus,
    SourceApi,
)


async def _connector(
    session,
    *,
    source_api=SourceApi.PYRONEAR_FRENCH_API,
    base_url="https://a.example",
):
    connector = AlertApiConnector(
        name="Test",
        base_url=base_url,
        source_api=source_api,
        login="admin",
        password_encrypted="token",
    )
    session.add(connector)
    await session.commit()
    await session.refresh(connector)
    return connector


async def test_connector_defaults(async_session):
    connector = await _connector(async_session)
    assert connector.is_enabled is True
    assert connector.trailing_days == 3
    assert connector.image_transfer is None
    assert connector.last_verified_at is None


async def test_source_api_is_unique_across_connectors(async_session):
    await _connector(async_session, base_url="https://a.example")
    with pytest.raises(IntegrityError):
        await _connector(async_session, base_url="https://b.example")
    await async_session.rollback()


async def test_base_url_is_unique(async_session):
    await _connector(async_session, base_url="https://a.example")
    with pytest.raises(IntegrityError):
        await _connector(
            async_session, base_url="https://a.example", source_api=SourceApi.CENIA
        )
    await async_session.rollback()


async def test_organization_unique_per_connector(async_session):
    connector = await _connector(async_session)
    async_session.add(
        AlertApiConnectorOrganization(
            connector_id=connector.id, organization_id=7, name="Ardeche"
        )
    )
    await async_session.commit()
    async_session.add(
        AlertApiConnectorOrganization(
            connector_id=connector.id, organization_id=7, name="Ardeche"
        )
    )
    with pytest.raises(IntegrityError):
        await async_session.commit()
    await async_session.rollback()


async def test_coverage_unique_per_connector_org_date(async_session):
    connector = await _connector(async_session)
    for _ in range(2):
        async_session.add(
            AlertApiImportCoverage(
                connector_id=connector.id,
                organization_id=7,
                covered_date=date(2026, 8, 5),
                status=ImportCoverageStatus.OK,
            )
        )
    with pytest.raises(IntegrityError):
        await async_session.commit()
    await async_session.rollback()


async def test_deleting_connector_cascades(async_session):
    connector = await _connector(async_session)
    async_session.add(
        AlertApiConnectorOrganization(
            connector_id=connector.id, organization_id=7, name="Ardeche"
        )
    )
    async_session.add(
        AlertApiImportCoverage(
            connector_id=connector.id,
            organization_id=7,
            covered_date=date(2026, 8, 5),
            status=ImportCoverageStatus.OK,
        )
    )
    await async_session.commit()

    await async_session.delete(connector)
    await async_session.commit()

    orgs = (
        (await async_session.execute(select(AlertApiConnectorOrganization)))
        .scalars()
        .all()
    )
    coverage = (
        (await async_session.execute(select(AlertApiImportCoverage))).scalars().all()
    )
    assert orgs == []
    assert coverage == []
