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
from app.schemas.connector import (
    ConnectorOrganizationRead,
    ConnectorTestResult,
    VerifyResult,
)
from app.services.secrets import decrypt_secret
from scripts.data_transfer.ingestion.alert_api import client as alert_api_client

logger = logging.getLogger(__name__)

_PROBE_LIMIT = 200

# _probe makes 4 sequential HTTP calls: the token exchange (client.py's own
# 5s timeout) plus three list endpoints, each bounded at 30s by api_get's
# timeout. 95s covers that worst-case sum with a small buffer, so a probe
# where every call is legitimately slow-but-working still completes; a probe
# against a host that black-holes packets was previously unbounded (the
# asyncio default-executor thread it occupies would never return) and is now
# bounded here too.
_PROBE_TIMEOUT_SECONDS = 100

# The pre-save credential check makes 2 sequential HTTP calls (token exchange,
# 5s bound; one list endpoint, 30s bound). 25s keeps the backend's answer
# ahead of the frontend's global 30s axios timeout, so the browser never
# gives up before the server has spoken.
_TEST_TIMEOUT_SECONDS = 25

__all__ = ["check_connector_credentials", "verify_connector"]


def _require_list(call: str, response: Any) -> None:
    """`api_get` only raises when the body fails to parse as JSON — a non-2xx
    response with a valid JSON error body (e.g. {"detail": "..."}) comes back
    as a dict where a list is expected. Fail with the alert API's own detail:
    for a non-admin credential that detail is "Incompatible token scope.",
    the one hint telling the operator to swap in an admin account."""
    if not isinstance(response, list):
        detail = response.get("detail") if isinstance(response, dict) else None
        raise ValueError(
            f"alert API returned an unexpected {call} response"
            + (f": {detail}" if detail else "")
        )


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


def _probe_credentials(base_url: str, login: str, password: str) -> int:
    """Blocking: token exchange, then the organizations listing — the two
    calls that cover both real failure modes (wrong password, org-scoped
    credential). No sequence probe: that stays verify's job."""
    token = alert_api_client.get_api_access_token(
        api_endpoint=base_url, username=login, password=password
    )
    organizations = alert_api_client.list_organizations(
        api_endpoint=base_url, access_token=token
    )
    _require_list("organizations", organizations)
    return len(organizations)


async def check_connector_credentials(
    base_url: str, login: str, password: str
) -> ConnectorTestResult:
    """Stateless pre-save credential check: no DB, nothing persisted, never
    raises for an unreachable or unauthorized alert API — this runs behind a
    button a human is watching."""
    try:
        organizations_total = await asyncio.wait_for(
            asyncio.to_thread(_probe_credentials, base_url, login, password),
            timeout=_TEST_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the operator verbatim
        return ConnectorTestResult(ok=False, error=f"{type(exc).__name__}: {exc}")
    return ConnectorTestResult(ok=True, organizations_total=organizations_total)


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
        organizations, cameras, sequences = await asyncio.wait_for(
            asyncio.to_thread(
                _probe, connector.base_url, connector.login, password, sample_date
            ),
            timeout=_PROBE_TIMEOUT_SECONDS,
        )
        for call, response in (
            ("organizations", organizations),
            ("cameras", cameras),
            ("sequences", sequences),
        ):
            _require_list(call, response)

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
                # New organizations start disabled: discovery must never
                # silently widen what gets ingested.
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
    except Exception as exc:  # noqa: BLE001 - surfaced to the operator verbatim
        # str(exc) is safe: the client raises on status codes and never embeds
        # the request body, so the password cannot leak into this message.
        await session.rollback()
        message = f"{type(exc).__name__}: {exc}"
        connector.last_verify_error = message
        session.add(connector)
        await session.commit()
        logger.warning("connector %s verification failed: %s", connector.id, message)
        return VerifyResult(ok=False, error=message)

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
