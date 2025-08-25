import asyncio
import io
from datetime import datetime, timedelta, UTC
from typing import AsyncGenerator, Generator

import pytest
import pytest_asyncio
import requests
from botocore.exceptions import ClientError
from httpx import AsyncClient
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel, text
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import create_access_token
from app.core.config import settings
from app.crud import UserCRUD
from app.db import engine, get_session
from app.main import app
from app.models import Detection, Sequence, User
from app.schemas.user import UserCreate
from app.services.storage import s3_service

dt_format = "%Y-%m-%dT%H:%M:%S.%f"
now = datetime.now(UTC)

DET_TABLE = [
    {
        "id": 1,
        "created_at": now - timedelta(days=2),
        "sequence_id": 1,
        "alert_api_id": 1,
        "recorded_at": now - timedelta(days=4),
        "bucket_key": "seq1_img1.jpg",
        "algo_predictions": {
            "predictions": [
                {
                    "xyxyn": [0.12, 0.13, 0.45, 0.48],
                    "confidence": 0.87,
                    "class_name": "smoke",
                }
            ]
        },
    },
    {
        "id": 2,
        "created_at": now - timedelta(days=1),
        "sequence_id": 1,
        "alert_api_id": 1,
        "recorded_at": now - timedelta(days=3),
        "bucket_key": "seq1_img2.jpg",
        "algo_predictions": {
            "predictions": [
                {
                    "xyxyn": [0.2, 0.25, 0.5, 0.55],
                    "confidence": 0.91,
                    "class_name": "fire",
                }
            ]
        },
    },
    {
        "id": 3,
        "created_at": now,
        "sequence_id": 2,
        "alert_api_id": 1,
        "recorded_at": now - timedelta(days=2),
        "bucket_key": "seq2_img1.jpg",
        "algo_predictions": {
            "predictions": [
                {
                    "xyxyn": [0.05, 0.05, 0.3, 0.35],
                    "confidence": 0.76,
                    "class_name": "smoke",
                },
                {
                    "xyxyn": [0.6, 0.65, 0.85, 0.9],
                    "confidence": 0.80,
                    "class_name": "fire",
                },
            ]
        },
    },
]

SEQ_TABLE = [
    {
        "id": 1,
        "source_api": "pyronear_french",
        "alert_api_id": 1,
        "created_at": now - timedelta(days=1),
        "recorded_at": now - timedelta(days=1),
        "last_seen_at": now,
        "camera_name": "habile",
        "camera_id": 1,
        "is_wildfire_alertapi": True,
        "organisation_name": "habile",
        "lat": 0.0,
        "lon": 0.0,
        "organisation_id": 1,
    },
    {
        "id": 2,
        "source_api": "pyronear_french",
        "alert_api_id": 2,
        "created_at": now - timedelta(hours=12),
        "recorded_at": now - timedelta(hours=12),
        "last_seen_at": now - timedelta(hours=6),
        "camera_name": "test_camera_2",
        "camera_id": 2,
        "is_wildfire_alertapi": False,
        "organisation_name": "test_org",
        "lat": 1.0,
        "lon": 1.0,
        "organisation_id": 2,
    },
]



@pytest_asyncio.fixture(scope="function")
async def async_client(
    async_session: AsyncSession,
) -> AsyncGenerator[AsyncClient, None]:
    from httpx import ASGITransport

    # Override the get_session dependency to use the test session
    async def get_test_session():
        yield async_session

    app.dependency_overrides[get_session] = get_test_session

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=f"http://api.localhost:8050{settings.API_V1_STR}",
        follow_redirects=True,
        timeout=5,
    ) as client:
        yield client

    # Clean up the override
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(scope="function")
async def async_session() -> AsyncSession:
    async with engine.begin() as conn:
        # Drop all tables first to ensure clean schema
        await conn.run_sync(SQLModel.metadata.drop_all)
        # Then recreate with current schema including all fields
        await conn.run_sync(SQLModel.metadata.create_all)

    async_session_maker = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session_maker() as session:
        # Clean up tables without a transaction block
        for table in reversed(SQLModel.metadata.sorted_tables):
            await session.exec(table.delete())
            if hasattr(table.c, "id"):
                await session.exec(
                    text(f"ALTER SEQUENCE {table.name}_id_seq RESTART WITH 1")
                )
        await session.commit()

        yield session

        # Clean up after test
        for table in reversed(SQLModel.metadata.sorted_tables):
            await session.exec(table.delete())
        await session.commit()
        
        # Dispose engine to force connection pool cleanup between tests
        # This prevents "Event loop is closed" errors when running multiple tests
        await engine.dispose()


@pytest.fixture(scope="session")
def mock_img():
    # Get Pyronear logo
    return requests.get(
        "https://avatars.githubusercontent.com/u/61667887?s=200&v=4", timeout=5
    ).content


@pytest_asyncio.fixture(scope="function")
async def test_user(async_session: AsyncSession) -> User:
    """Create a test user in the database."""
    user_crud = UserCRUD(async_session)
    user_create = UserCreate(
        username=settings.AUTH_USERNAME,
        email=f"{settings.AUTH_USERNAME}@test.com",
        password=settings.AUTH_PASSWORD,
        is_active=True,
        is_superuser=True,
    )
    user = await user_crud.create_user(user_create)
    return user


@pytest_asyncio.fixture(scope="function")
async def regular_user(async_session: AsyncSession) -> User:
    """Create a regular (non-admin) user for authorization testing."""
    user_crud = UserCRUD(async_session)
    user_create = UserCreate(
        username="regularuser",
        email="regular@test.com",
        password="testpassword123",
        is_active=True,
        is_superuser=False,  # Regular user, not admin
    )
    user = await user_crud.create_user(user_create)
    return user


@pytest_asyncio.fixture(scope="function")
async def inactive_user(async_session: AsyncSession) -> User:
    """Create an inactive user for status testing."""
    user_crud = UserCRUD(async_session)
    user_create = UserCreate(
        username="inactiveuser",
        email="inactive@test.com",
        password="testpassword123",
        is_active=False,  # Inactive user
        is_superuser=False,
    )
    user = await user_crud.create_user(user_create)
    return user


@pytest_asyncio.fixture(scope="function")
async def auth_token(test_user: User) -> str:
    """Generate an authentication token for testing."""
    return create_access_token(
        data={"sub": test_user.username, "user_id": test_user.id}
    )


@pytest_asyncio.fixture(scope="function")
async def regular_user_token(regular_user: User) -> str:
    """Generate an authentication token for regular user."""
    return create_access_token(
        data={"sub": regular_user.username, "user_id": regular_user.id}
    )


@pytest_asyncio.fixture(scope="function")
async def inactive_user_token(inactive_user: User) -> str:
    """Generate an authentication token for inactive user."""
    return create_access_token(
        data={"sub": inactive_user.username, "user_id": inactive_user.id}
    )


@pytest_asyncio.fixture(scope="function")
async def authenticated_client(
    async_session: AsyncSession,
    auth_token: str,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an authenticated HTTP client for testing."""
    from httpx import ASGITransport

    # Override the get_session dependency to use the test session
    async def get_test_session():
        yield async_session

    app.dependency_overrides[get_session] = get_test_session

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=f"http://api.localhost:8050{settings.API_V1_STR}",
        headers={"Authorization": f"Bearer {auth_token}"},
        follow_redirects=True,
        timeout=5,
    ) as client:
        yield client

    # Clean up the override
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(scope="function")
async def detection_session(sequence_session: AsyncSession):
    # sequence_session already contains the sequences we need
    for entry in DET_TABLE:
        sequence_session.add(Detection(**entry))
    await sequence_session.commit()
    # Update the detection index count
    await sequence_session.exec(
        text(
            f"ALTER SEQUENCE {Detection.__tablename__}_id_seq RESTART WITH {max(entry['id'] for entry in DET_TABLE) + 1}"
        )
    )
    await sequence_session.commit()
    # Create bucket files with actual image data
    mock_image_data = requests.get(
        "https://avatars.githubusercontent.com/u/61667887?s=200&v=4", timeout=5
    ).content

    for entry in DET_TABLE:
        bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
        bucket.upload_file(entry["bucket_key"], io.BytesIO(mock_image_data))
    yield sequence_session
    await sequence_session.rollback()
    # Delete bucket files
    try:
        for entry in DET_TABLE:
            bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
            bucket.delete_file(entry["bucket_key"])
    except ClientError:
        pass


@pytest_asyncio.fixture(scope="function")
async def sequence_session(async_session: AsyncSession):
    for entry in SEQ_TABLE:
        async_session.add(Sequence(**entry))
    await async_session.commit()
    # Update the sequence index count
    await async_session.exec(
        text(
            f"ALTER SEQUENCE {Sequence.__tablename__}_id_seq RESTART WITH {max(entry['id'] for entry in SEQ_TABLE) + 1}"
        )
    )
    await async_session.commit()

    yield async_session
    await async_session.rollback()


def pytest_configure():
    # Table
    pytest.detection_table = [
        {
            k: datetime.strftime(v, dt_format) if isinstance(v, datetime) else v
            for k, v in entry.items()
        }
        for entry in DET_TABLE
    ]
    pytest.sequence_table = [
        {
            k: datetime.strftime(v, dt_format) if isinstance(v, datetime) else v
            for k, v in entry.items()
        }
        for entry in SEQ_TABLE
    ]
