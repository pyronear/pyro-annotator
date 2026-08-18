# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models import ImportCoverageStatus, SourceApi

__all__ = [
    "ConnectorCreate",
    "ConnectorOrganizationRead",
    "ConnectorOrganizationUpdate",
    "ConnectorRead",
    "ConnectorTestRequest",
    "ConnectorTestResult",
    "ConnectorUpdate",
    "CoverageCellRead",
    "VerifyResult",
]

ImageTransfer = Literal["url", "bucket-copy"]


class ConnectorCreate(BaseModel):
    name: str = Field(max_length=100)
    base_url: str = Field(max_length=255)
    source_api: SourceApi
    login: str = Field(max_length=100)
    password: str = Field(min_length=1)
    is_enabled: bool = True
    trailing_days: int = Field(default=3, ge=1, le=30)
    image_transfer: Optional[ImageTransfer] = None


class ConnectorUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    base_url: Optional[str] = Field(default=None, max_length=255)
    login: Optional[str] = Field(default=None, max_length=100)
    # Omitted means "leave the stored credential alone".
    password: Optional[str] = Field(default=None, min_length=1)
    is_enabled: Optional[bool] = None
    trailing_days: Optional[int] = Field(default=None, ge=1, le=30)
    image_transfer: Optional[ImageTransfer] = None


class ConnectorRead(BaseModel):
    """Read model. Deliberately has no password field of any kind."""

    id: int
    name: str
    base_url: str
    source_api: SourceApi
    login: str
    has_password: bool
    is_enabled: bool
    trailing_days: int
    image_transfer: Optional[str]
    last_verified_at: Optional[datetime]
    last_verify_error: Optional[str]
    organizations_total: int = 0
    organizations_enabled: int = 0

    model_config = ConfigDict(from_attributes=True)


class ConnectorOrganizationRead(BaseModel):
    id: int
    organization_id: int
    name: str
    is_enabled: bool
    enabled_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


class ConnectorOrganizationUpdate(BaseModel):
    is_enabled: bool


class CoverageCellRead(BaseModel):
    organization_id: int
    covered_date: date
    status: ImportCoverageStatus
    alerts_fetched: int
    alerts_imported: int
    alerts_skipped: int
    alerts_failed: int
    lanes_created: int
    error: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class ConnectorTestRequest(BaseModel):
    """Stateless pre-save credential check. The plaintext password lives only
    in this request body — never logged, never persisted."""

    base_url: str = Field(max_length=255)
    login: str = Field(max_length=100)
    password: str = Field(min_length=1)


class ConnectorTestResult(BaseModel):
    ok: bool
    error: Optional[str] = None
    organizations_total: int = 0


class VerifyResult(BaseModel):
    ok: bool
    error: Optional[str] = None
    organizations: list[ConnectorOrganizationRead] = []
    # Cross-organization probe: how many distinct organizations appeared in a
    # sample listing, out of how many the connector can see. Reported as a count,
    # not a boolean — one organization on a quiet day proves nothing.
    organizations_seen_in_sample: int = 0
    organizations_total: int = 0
    sample_date: Optional[date] = None
