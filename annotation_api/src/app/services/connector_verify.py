# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Verify a connector: prove the credential works, discover the organizations it
can see, and measure how many of them actually appear in a sample listing.

The last part matters because the whole connector design assumes one admin
account can list sequences across every organization. That assumption is reported
as a count rather than asserted as a boolean: seeing one organization on a quiet
day proves nothing, but seeing four of seven proves cross-org listing works.
"""

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import AlertApiConnector, AlertApiConnectorOrganization
from app.schemas.connector import ConnectorOrganizationRead, VerifyResult
from app.services.secrets import decrypt_secret
from scripts.data_transfer.ingestion.alert_api import client as alert_api_client

logger = logging.getLogger(__name__)

_PROBE_LIMIT = 200

__all__ = ["verify_connector"]


def _probe(
    base_url: str, login: str, password: str, sample_date: date
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Blocking: token, organizations, cameras, and one day of sequences.

    The alert API client is synchronous `requests`; the caller wraps this in a
    thread so the event loop stays free.
    """
    token = alert_api_client.get_api_access_token(
        api_endpoint=base_url, username=login, password=password
    )
    organizations = alert_api_client.list_organizations(
        api_endpoint=base_url, access_token=token
    )
    cameras = alert_api_client.list_cameras(api_endpoint=base_url, access_token=token)
    sequences = alert_api_client.list_sequences_for_date(
        api_endpoint=base_url,
        date=sample_date,
        limit=_PROBE_LIMIT,
        offset=0,
        access_token=token,
        risk_score="extreme",
    )
    return organizations, cameras, sequences


async def verify_connector(
    session: AsyncSession,
    connector: AlertApiConnector,
    *,
    today: date,
) -> VerifyResult:
    """Authenticate, upsert discovered organizations, and probe cross-org reach.

    Never raises for an unreachable or unauthorized alert API — the failure is
    recorded on the connector and returned, because this runs behind a button a
    human is watching.
    """
    sample_date = today - timedelta(days=1)
    try:
        password = decrypt_secret(connector.password_encrypted)
        organizations, cameras, sequences = await asyncio.to_thread(
            _probe, connector.base_url, connector.login, password, sample_date
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the operator verbatim
        # str(exc) is safe: the client raises on status codes and never embeds
        # the request body, so the password cannot leak into this message.
        message = f"{type(exc).__name__}: {exc}"
        connector.last_verify_error = message
        session.add(connector)
        await session.commit()
        logger.warning("connector %s verification failed: %s", connector.id, message)
        return VerifyResult(ok=False, error=message)

    existing = {
        row.organization_id: row
        for row in (
            (
                await session.execute(
                    select(AlertApiConnectorOrganization).where(
                        AlertApiConnectorOrganization.connector_id == connector.id
                    )
                )
            )
            .scalars()
            .all()
        )
    }
    for org in organizations:
        row = existing.get(org["id"])
        if row is None:
            # New organizations start disabled: discovery must never silently
            # widen what gets ingested.
            row = AlertApiConnectorOrganization(
                connector_id=connector.id,
                organization_id=org["id"],
                name=org.get("name") or str(org["id"]),
                is_enabled=False,
            )
        else:
            row.name = org.get("name") or row.name
        session.add(row)

    camera_org = {c["id"]: c.get("organization_id") for c in cameras}
    seen = {
        camera_org.get(seq.get("camera_id"))
        for seq in sequences
        if camera_org.get(seq.get("camera_id")) is not None
    }

    connector.last_verified_at = datetime.now(UTC)
    connector.last_verify_error = None
    session.add(connector)
    await session.commit()

    rows = (
        (
            await session.execute(
                select(AlertApiConnectorOrganization)
                .where(AlertApiConnectorOrganization.connector_id == connector.id)
                .order_by(AlertApiConnectorOrganization.name)
            )
        )
        .scalars()
        .all()
    )
    return VerifyResult(
        ok=True,
        organizations=[ConnectorOrganizationRead.model_validate(r) for r in rows],
        organizations_seen_in_sample=len(seen),
        organizations_total=len(organizations),
        sample_date=sample_date,
    )
