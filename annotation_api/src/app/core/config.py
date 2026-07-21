# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

import os

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

    # Authentication
    AUTH_USERNAME: str = os.environ.get("AUTH_USERNAME", "admin")
    AUTH_PASSWORD: str = os.environ.get("AUTH_PASSWORD", "admin")
    JWT_SECRET: str = os.environ.get(
        "JWT_SECRET", "your-secret-key-change-in-production"
    )
    ACCESS_TOKEN_EXPIRE_HOURS: int = int(
        os.environ.get("ACCESS_TOKEN_EXPIRE_HOURS", "24")
    )

    # Script Authentication (for import scripts)
    ANNOTATOR_LOGIN: str = os.environ.get("ANNOTATOR_LOGIN", "admin")
    ANNOTATOR_PASSWORD: str = os.environ.get("ANNOTATOR_PASSWORD", "admin")

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
    S3_PROXY_URL: str = os.environ.get("S3_PROXY_URL", "")
    S3_URL_EXPIRATION: int = int(os.environ.get("S3_URL_EXPIRATION") or 24 * 3600)
    S3_BUCKET_NAME: str = os.environ.get("S3_BUCKET_NAME", "annotation-api")

    # Platform (used to derive source bucket name for server-side S3 copies)
    PLATFORM_SERVER_NAME: str = os.environ.get(
        "PLATFORM_SERVER_NAME", "ovh-alert-api-prod-v2"
    )

    # Auto-annotate model (baked into the image; see Dockerfile)
    AUTOANNOTATE_MODEL_PATH: str = os.environ.get(
        "AUTOANNOTATE_MODEL_PATH", "/app/models/yolo11s_sensitive-detector"
    )
    AUTOANNOTATE_MODEL_NAME: str = os.environ.get(
        "AUTOANNOTATE_MODEL_NAME", "yolo11s_sensitive-detector"
    )
    AUTOANNOTATE_MODEL_VERSION: str = os.environ.get(
        "AUTOANNOTATE_MODEL_VERSION", "onnx-main"
    )
    AUTOANNOTATE_CONF: float = float(os.environ.get("AUTOANNOTATE_CONF", "0.01"))
    AUTOANNOTATE_IOU: float = float(os.environ.get("AUTOANNOTATE_IOU", "0.0"))
    AUTOANNOTATE_IMGSZ: int = int(os.environ.get("AUTOANNOTATE_IMGSZ", "1024"))
    # Clustering thresholds for the gap-fill anchor (mirror `make auto-annotate`):
    # aggregated engine boxes are clustered into persistent objects, then only
    # sensitive-model predictions overlapping an object are kept.
    AUTOANNOTATE_GROUP_IOU_NMS: float = float(
        os.environ.get("AUTOANNOTATE_GROUP_IOU_NMS", "0.0")
    )
    AUTOANNOTATE_GROUP_IOU_ASSIGN: float = float(
        os.environ.get("AUTOANNOTATE_GROUP_IOU_ASSIGN", "0.0")
    )

    @property
    def procrastinate_dsn(self) -> str:
        """Plain libpq DSN for procrastinate/psycopg (no SQLAlchemy driver suffix)."""
        return self.POSTGRES_URL.replace("+asyncpg", "").replace("+psycopg", "")

    DEBUG: bool = os.environ.get("DEBUG", "").lower() != "false"
    LOGO_URL: str = ""

    model_config = SettingsConfigDict(case_sensitive=True)


settings = Settings()
