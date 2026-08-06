# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import get_current_superuser
from app.db import get_session
from app.models import (
    AlertApiConnector,
    AlertApiConnectorOrganization,
    AlertApiImportCoverage,
    User,
)
from app.schemas.connector import (
    ConnectorCreate,
    ConnectorOrganizationRead,
    ConnectorOrganizationUpdate,
    ConnectorRead,
    ConnectorUpdate,
    CoverageCellRead,
    VerifyResult,
)
from app.services.connector_verify import verify_connector
from app.services.secrets import SecretKeyMissingError, encrypt_secret

router = APIRouter()


async def _to_read(
    session: AsyncSession, connector: AlertApiConnector
) -> ConnectorRead:
    counts = (
        await session.execute(
            select(
                func.count(AlertApiConnectorOrganization.id),
                func.count(AlertApiConnectorOrganization.id).filter(
                    AlertApiConnectorOrganization.is_enabled.is_(True)
                ),
            ).where(AlertApiConnectorOrganization.connector_id == connector.id)
        )
    ).one()
    return ConnectorRead(
        id=connector.id,
        name=connector.name,
        base_url=connector.base_url,
        source_api=connector.source_api,
        login=connector.login,
        has_password=bool(connector.password_encrypted),
        is_enabled=connector.is_enabled,
        trailing_days=connector.trailing_days,
        image_transfer=connector.image_transfer,
        last_verified_at=connector.last_verified_at,
        last_verify_error=connector.last_verify_error,
        organizations_total=counts[0],
        organizations_enabled=counts[1],
    )


async def _get_or_404(session: AsyncSession, connector_id: int) -> AlertApiConnector:
    connector = await session.get(AlertApiConnector, connector_id)
    if connector is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connector not found"
        )
    return connector


def _encrypt_or_400(password: str) -> str:
    try:
        return encrypt_secret(password)
    except SecretKeyMissingError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/", response_model=list[ConnectorRead])
async def list_connectors(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> list[ConnectorRead]:
    """List every configured alert API connector."""
    connectors = (
        (
            await session.execute(
                select(AlertApiConnector).order_by(AlertApiConnector.name)
            )
        )
        .scalars()
        .all()
    )
    return [await _to_read(session, connector) for connector in connectors]


@router.post("/", response_model=ConnectorRead, status_code=status.HTTP_201_CREATED)
async def create_connector(
    payload: ConnectorCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> ConnectorRead:
    """Register an alert API. The password is encrypted before it is stored and
    is never returned."""
    connector = AlertApiConnector(
        name=payload.name,
        base_url=payload.base_url,
        source_api=payload.source_api,
        login=payload.login,
        password_encrypted=_encrypt_or_400(payload.password),
        is_enabled=payload.is_enabled,
        trailing_days=payload.trailing_days,
        image_transfer=payload.image_transfer,
    )
    session.add(connector)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A connector already exists for this base URL or source API. "
                "Each source API may be claimed by only one connector."
            ),
        )
    await session.refresh(connector)
    return await _to_read(session, connector)


@router.patch("/{connector_id}", response_model=ConnectorRead)
async def update_connector(
    connector_id: int,
    payload: ConnectorUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> ConnectorRead:
    """Update a connector. Omitting `password` leaves the stored one intact."""
    connector = await _get_or_404(session, connector_id)
    fields = payload.model_dump(exclude_unset=True)
    password = fields.pop("password", None)
    if password is not None:
        connector.password_encrypted = _encrypt_or_400(password)
    for key, value in fields.items():
        setattr(connector, key, value)
    session.add(connector)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A connector already exists for this base URL.",
        )
    await session.refresh(connector)
    return await _to_read(session, connector)


@router.delete("/{connector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connector(
    connector_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> None:
    """Delete a connector, its discovered organizations, and its coverage."""
    connector = await _get_or_404(session, connector_id)
    await session.delete(connector)
    await session.commit()


@router.post("/{connector_id}/verify", response_model=VerifyResult)
async def verify(
    connector_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> VerifyResult:
    """Test the credential, discover organizations, and report how many of them
    actually appear in a one-day sample listing."""
    connector = await _get_or_404(session, connector_id)
    return await verify_connector(session, connector, today=datetime.now(UTC).date())


@router.get(
    "/{connector_id}/organizations", response_model=list[ConnectorOrganizationRead]
)
async def list_connector_organizations(
    connector_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> list[AlertApiConnectorOrganization]:
    """Organizations discovered on this connector, in name order."""
    await _get_or_404(session, connector_id)
    result = await session.execute(
        select(AlertApiConnectorOrganization)
        .where(AlertApiConnectorOrganization.connector_id == connector_id)
        .order_by(AlertApiConnectorOrganization.name)
    )
    return list(result.scalars().all())


@router.patch(
    "/{connector_id}/organizations/{organization_id}",
    response_model=ConnectorOrganizationRead,
)
async def update_connector_organization(
    connector_id: int,
    organization_id: int,
    payload: ConnectorOrganizationUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> AlertApiConnectorOrganization:
    """Include or exclude one organization from the daily import."""
    await _get_or_404(session, connector_id)
    row = (
        await session.execute(
            select(AlertApiConnectorOrganization).where(
                AlertApiConnectorOrganization.connector_id == connector_id,
                AlertApiConnectorOrganization.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found on this connector; run verify first.",
        )
    row.is_enabled = payload.is_enabled
    # enabled_at marks when this organization FIRST entered ingestion. The
    # heatmap greys out days before it, so it must never be moved once set.
    if payload.is_enabled and row.enabled_at is None:
        row.enabled_at = datetime.now(UTC)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


@router.get("/{connector_id}/coverage", response_model=list[CoverageCellRead])
async def read_coverage(
    connector_id: int,
    date_from: date | None = None,
    date_end: date | None = None,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> list[AlertApiImportCoverage]:
    """Coverage cells for the heatmap. Defaults to the last 30 days."""
    await _get_or_404(session, connector_id)
    today = datetime.now(UTC).date()
    date_end = date_end or today
    date_from = date_from or (date_end - timedelta(days=29))
    result = await session.execute(
        select(AlertApiImportCoverage)
        .where(
            AlertApiImportCoverage.connector_id == connector_id,
            AlertApiImportCoverage.covered_date >= date_from,
            AlertApiImportCoverage.covered_date <= date_end,
        )
        .order_by(
            AlertApiImportCoverage.organization_id, AlertApiImportCoverage.covered_date
        )
    )
    return list(result.scalars().all())
