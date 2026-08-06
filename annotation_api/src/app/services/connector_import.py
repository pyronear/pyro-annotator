# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Run one connector's daily import and record what it covered."""

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.models import (
    AlertApiConnector,
    AlertApiConnectorOrganization,
    AlertApiImportCoverage,
    ImportCoverageStatus,
)
from app.models import Sequence as SequenceModel
from app.models import SourceApi
from app.services.secrets import SecretKeyMissingError, decrypt_secret
from app.services.worker_auth import mint_worker_token
from scripts.data_transfer.ingestion.alert_api.runner import (
    ImportConfig,
    OrganizationStats,
    run_import,
)

logger = logging.getLogger(__name__)

__all__ = ["build_skip_ids", "import_connector"]


async def build_skip_ids(session: AsyncSession, source_api: SourceApi) -> set[int]:
    """Alert-API sequence ids we already hold for this platform.

    platform_alert_id is the alert API's own sequence id, shared by every lane of
    an alert (object-split siblings included), and indexed as
    ix_sequence_platform_alert_id — so this is one cheap query, and the result
    lets the importer skip alerts before fetching any of their detections.
    """
    result = await session.execute(
        select(SequenceModel.platform_alert_id)
        .where(SequenceModel.source_api == source_api)
        .distinct()
    )
    return {row for row in result.scalars().all() if row is not None}


def _status(stats: OrganizationStats) -> ImportCoverageStatus:
    if stats.alerts_failed and not (stats.alerts_imported or stats.alerts_skipped):
        return ImportCoverageStatus.FAILED
    if stats.alerts_failed:
        return ImportCoverageStatus.PARTIAL
    return ImportCoverageStatus.OK


async def _upsert_coverage(
    session: AsyncSession,
    *,
    connector_id: int,
    organization_id: int,
    covered_date: date,
    status: ImportCoverageStatus,
    stats: OrganizationStats,
    error: str | None,
) -> None:
    row = (
        await session.execute(
            select(AlertApiImportCoverage).where(
                AlertApiImportCoverage.connector_id == connector_id,
                AlertApiImportCoverage.organization_id == organization_id,
                AlertApiImportCoverage.covered_date == covered_date,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = AlertApiImportCoverage(
            connector_id=connector_id,
            organization_id=organization_id,
            covered_date=covered_date,
        )
    row.status = status
    row.alerts_fetched = stats.alerts_fetched
    row.alerts_imported = stats.alerts_imported
    row.alerts_skipped = stats.alerts_skipped
    row.alerts_failed = stats.alerts_failed
    row.lanes_created = stats.lanes_created
    row.error = error
    row.last_attempt_at = datetime.now(UTC)
    session.add(row)


async def import_connector(
    session: AsyncSession,
    connector: AlertApiConnector,
    *,
    today: date,
) -> None:
    """Import the connector's trailing window and write one coverage row per
    enabled organization per day.

    Never raises: a connector that cannot run must not take down the sweep for
    the others. Failures are recorded as coverage rows, which is where an
    operator will look.
    """
    organizations = (
        (
            await session.execute(
                select(AlertApiConnectorOrganization).where(
                    AlertApiConnectorOrganization.connector_id == connector.id,
                    AlertApiConnectorOrganization.is_enabled.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    if not organizations:
        logger.info("connector %s has no enabled organizations; skipping", connector.id)
        return

    try:
        password = decrypt_secret(connector.password_encrypted)
    except SecretKeyMissingError as exc:
        # No coverage rows: this is a deployment problem, not a data gap, and
        # writing "failed" cells would misattribute it to the alert API.
        logger.error("connector %s cannot be decrypted: %s", connector.id, exc)
        return

    token = await mint_worker_token(session)
    if token is None:
        logger.error("connector %s: no worker token available; skipping", connector.id)
        return

    org_ids = {org.organization_id for org in organizations}
    skip_ids = await build_skip_ids(session, connector.source_api)
    # today is excluded: the day is still in progress on the alert API.
    days = [
        today - timedelta(days=offset)
        for offset in range(connector.trailing_days, 0, -1)
    ]

    for day in days:
        config = ImportConfig(
            alert_api_url=connector.base_url,
            login=connector.login,
            password=password,
            admin_login=connector.login,
            admin_password=password,
            annotation_api_url=settings.ANNOTATION_API_INTERNAL_URL,
            annotation_api_token=token,
            date_from=day,
            date_end=day,
            source_api=connector.source_api.value,
            image_transfer=connector.image_transfer,
            organization_ids=org_ids,
            skip_platform_alert_ids=frozenset(skip_ids),
        )
        error: str | None = None
        per_org: dict[int, OrganizationStats] = {}
        try:
            result = await asyncio.to_thread(run_import, config)
            per_org = result.per_organization
            error = result.error
        except Exception as exc:  # noqa: BLE001 - recorded, not raised
            logger.exception("connector %s import failed for %s", connector.id, day)
            error = f"{type(exc).__name__}: {exc}"

        for org in organizations:
            stats = per_org.get(org.organization_id, OrganizationStats())
            status = ImportCoverageStatus.FAILED if error else _status(stats)
            await _upsert_coverage(
                session,
                connector_id=connector.id,
                organization_id=org.organization_id,
                covered_date=day,
                status=status,
                stats=stats,
                error=error,
            )
        await session.commit()

        # Alerts imported for this day must not be re-fetched on the next day in
        # the window.
        skip_ids = await build_skip_ids(session, connector.source_api)
