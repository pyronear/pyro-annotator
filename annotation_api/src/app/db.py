# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

import asyncio
import logging

from sqlalchemy.ext.asyncio.engine import AsyncEngine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel, create_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.models import *  # noqa

__all__ = ["get_session", "init_db"]

logger = logging.getLogger("uvicorn.error")

# Configure connection pooling for high-performance operations
engine = AsyncEngine(
    create_engine(
        settings.POSTGRES_URL,
        echo=False,
        # Connection pool configuration for handling thousands of requests
        pool_size=20,  # Number of connections to maintain in the pool
        max_overflow=30,  # Additional connections when pool is exhausted
        pool_timeout=30,  # Seconds to wait for connection from pool
        pool_recycle=3600,  # Recycle connections after 1 hour
        pool_pre_ping=True,  # Validate connections before use
        # Async connection configuration
        connect_args={
            "command_timeout": 60,  # Timeout for individual commands
            "server_settings": {
                "jit": "off",  # Disable JIT for consistent performance
                "application_name": "pyro-annotator-api",
            },
        },
    )
)


async def get_session() -> AsyncSession:  # type: ignore[misc]
    # Configure sessionmaker with optimized settings for bulk operations
    async_session = sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        # Optimize for batch operations and reduce memory usage
        autoflush=False,  # Manual flush control for batch operations
    )
    async with async_session() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def main() -> None:
    await init_db()


if __name__ == "__main__":
    asyncio.run(main())
