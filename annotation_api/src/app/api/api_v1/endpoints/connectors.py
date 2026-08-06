# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import get_current_superuser
from app.db import get_session
from app.models import AlertApiConnector, AlertApiConnectorOrganization, User
from app.schemas.connector import ConnectorCreate, ConnectorRead, ConnectorUpdate
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
