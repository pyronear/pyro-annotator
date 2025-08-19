# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.


import pytest
from httpx import AsyncClient

from app.models import SourceApi


@pytest.mark.asyncio
async def test_list_cameras_empty(async_client: AsyncClient):
    """Test listing cameras when database is empty."""
    response = await async_client.get("/cameras")
    assert response.status_code == 200
    data = response.json()
    assert data == []


@pytest.mark.asyncio
async def test_list_cameras_with_sequences(async_client: AsyncClient):
    """Test listing cameras with existing sequences."""
    # Create some test sequences with different cameras
    sequences_data = [
        {
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
            "alert_api_id": 1001,
            "camera_name": "Camera Alpha",
            "camera_id": 101,
            "organisation_name": "Test Org 1",
            "organisation_id": 1,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T10:00:00",
            "last_seen_at": "2024-01-15T10:30:00",
        },
        {
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
            "alert_api_id": 1002,
            "camera_name": "Camera Alpha",  # Same camera
            "camera_id": 101,
            "organisation_name": "Test Org 1",
            "organisation_id": 1,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T11:00:00",
            "last_seen_at": "2024-01-15T11:30:00",
        },
        {
            "source_api": SourceApi.ALERT_WILDFIRE.value,
            "alert_api_id": 2001,
            "camera_name": "Camera Beta",
            "camera_id": 201,
            "organisation_name": "Test Org 2",
            "organisation_id": 2,
            "lat": 44.0,
            "lon": 2.0,
            "recorded_at": "2024-01-14T09:00:00",
            "last_seen_at": "2024-01-14T09:30:00",
        },
    ]

    # Create sequences
    for seq_data in sequences_data:
        response = await async_client.post("/sequences", data=seq_data)
        assert response.status_code == 201

    # List cameras
    response = await async_client.get("/cameras")
    assert response.status_code == 200
    cameras = response.json()

    # Should have 2 unique cameras
    assert len(cameras) == 2

    # Find Camera Alpha
    camera_alpha = next(c for c in cameras if c["name"] == "Camera Alpha")
    assert camera_alpha["id"] == 101

    # Find Camera Beta
    camera_beta = next(c for c in cameras if c["name"] == "Camera Beta")
    assert camera_beta["id"] == 201

    # Verify ordering (alphabetical by name)
    assert cameras[0]["name"] == "Camera Alpha"
    assert cameras[1]["name"] == "Camera Beta"


@pytest.mark.asyncio
async def test_list_cameras_response_format(async_client: AsyncClient):
    """Test that camera response has correct format."""
    # Create a test sequence
    seq_data = {
        "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
        "alert_api_id": 5001,
        "camera_name": "Format Test Camera",
        "camera_id": 501,
        "organisation_name": "Test Org",
        "organisation_id": 1,
        "lat": 43.5,
        "lon": 1.5,
        "recorded_at": "2024-01-15T10:00:00",
        "last_seen_at": "2024-01-15T10:30:00",
    }
    response = await async_client.post("/sequences", data=seq_data)
    assert response.status_code == 201

    # Get cameras
    response = await async_client.get("/cameras")
    assert response.status_code == 200
    cameras = response.json()
    assert len(cameras) == 1

    camera = cameras[0]
    # Check all required fields are present
    assert "id" in camera
    assert "name" in camera

    # Check field types
    assert isinstance(camera["id"], int)
    assert isinstance(camera["name"], str)
