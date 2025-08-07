# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

import os
import secrets
from typing import Union

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

__all__ = ["settings"]


class Settings(BaseSettings):
    # State
    PROJECT_NAME: str = "pyro-annotator - Annotation API"
    PROJECT_DESCRIPTION: str = "API for managing platform annotations"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    CORS_ORIGIN: str = "*"
    SUPPORT_EMAIL: str = os.environ.get("SUPPORT_EMAIL", "support@pyronear.org")
    # DB
    POSTGRES_URL: str = os.environ["POSTGRES_URL"]

    @field_validator("POSTGRES_URL")
    @classmethod
    def sqlachmey_uri(cls, v: str) -> str:
        # Fix for SqlAlchemy 1.4+
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+asyncpg://", 1)
        return v

    # DB conversion
    MAX_BOXES_PER_DETECTION: int = 5
    DECIMALS_PER_COORD: int = 3
    MAX_BBOX_STR_LENGTH: int = (
        2
        + MAX_BOXES_PER_DETECTION * (2 + 5 * (2 + DECIMALS_PER_COORD) + 4 * 2)
        + (MAX_BOXES_PER_DETECTION - 1) * 2
    )

    # Storage
    S3_ACCESS_KEY: str = os.environ["S3_ACCESS_KEY"]
    S3_SECRET_KEY: str = os.environ["S3_SECRET_KEY"]
    S3_REGION: str = os.environ["S3_REGION"]
    S3_ENDPOINT_URL: str = os.environ["S3_ENDPOINT_URL"]
    S3_URL_EXPIRATION: int = int(os.environ.get("S3_URL_EXPIRATION") or 24 * 3600)

    DEBUG: bool = os.environ.get("DEBUG", "").lower() != "false"
    LOGO_URL: str = ""

    model_config = SettingsConfigDict(case_sensitive=True)


settings = Settings()
