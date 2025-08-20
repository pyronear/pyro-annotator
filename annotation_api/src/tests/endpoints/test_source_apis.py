# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.


import pytest
from httpx import AsyncClient

from app.models import SourceApi


@pytest.mark.asyncio
async def test_list_source_apis_empty(async_client: AsyncClient):
    """Test listing source APIs when database is empty."""
    response = await async_client.get("/source-apis")
    assert response.status_code == 200
    data = response.json()
    assert data == []


@pytest.mark.asyncio
async def test_list_source_apis_with_sequences(async_client: AsyncClient):
    """Test listing source APIs with existing sequences."""
    # Create some test sequences with different source APIs
    sequences_data = [
        {
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
            "alert_api_id": 1001,
            "camera_name": "Camera A",
            "camera_id": 101,
            "organisation_name": "Pyronear France",
            "organisation_id": 1,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T10:00:00",
            "last_seen_at": "2024-01-15T10:30:00",
        },
        {
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,  # Duplicate source API
            "alert_api_id": 1002,
            "camera_name": "Camera B",
            "camera_id": 102,
            "organisation_name": "Pyronear France",
            "organisation_id": 1,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T11:00:00",
            "last_seen_at": "2024-01-15T11:30:00",
        },
        {
            "source_api": SourceApi.ALERT_WILDFIRE.value,
            "alert_api_id": 2001,
            "camera_name": "Camera C",
            "camera_id": 201,
            "organisation_name": "AlertWildfire Network",
            "organisation_id": 2,
            "lat": 44.0,
            "lon": 2.0,
            "recorded_at": "2024-01-14T09:00:00",
            "last_seen_at": "2024-01-14T09:30:00",
        },
        {
            "source_api": SourceApi.CENIA.value,
            "alert_api_id": 3001,
            "camera_name": "Camera D",
            "camera_id": 301,
            "organisation_name": "CENIA Chile",
            "organisation_id": 3,
            "lat": -33.4,
            "lon": -70.6,
            "recorded_at": "2024-01-16T14:00:00",
            "last_seen_at": "2024-01-16T14:30:00",
        },
    ]

    # Create sequences
    for seq_data in sequences_data:
        response = await async_client.post("/sequences", data=seq_data)
        assert response.status_code == 201

    # List source APIs
    response = await async_client.get("/source-apis")
    assert response.status_code == 200
    source_apis = response.json()

    # Should have 3 unique source APIs (no duplicates)
    assert len(source_apis) == 3

    # Find Pyronear French API
    pyronear_api = next(s for s in source_apis if s["id"] == "pyronear_french")
    assert pyronear_api["name"] == "Pyronear French"

    # Find Alert Wildfire API
    alert_api = next(s for s in source_apis if s["id"] == "alert_wildfire")
    assert alert_api["name"] == "Alert Wildfire"

    # Find API Cenia
    cenia_api = next(s for s in source_apis if s["id"] == "api_cenia")
    assert cenia_api["name"] == "API Cenia"

    # Verify that results are sorted alphabetically by source_api value
    source_api_ids = [api["id"] for api in source_apis]
    assert source_api_ids == sorted(source_api_ids), f"Source APIs should be sorted alphabetically, got: {source_api_ids}"


@pytest.mark.asyncio
async def test_list_source_apis_response_format(async_client: AsyncClient):
    """Test that source API response has correct format."""
    # Create a test sequence
    seq_data = {
        "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
        "alert_api_id": 5001,
        "camera_name": "Test Camera",
        "camera_id": 501,
        "organisation_name": "Test Organization",
        "organisation_id": 1,
        "lat": 43.5,
        "lon": 1.5,
        "recorded_at": "2024-01-15T10:00:00",
        "last_seen_at": "2024-01-15T10:30:00",
    }
    response = await async_client.post("/sequences", data=seq_data)
    assert response.status_code == 201

    # Get source APIs
    response = await async_client.get("/source-apis")
    assert response.status_code == 200
    source_apis = response.json()
    assert len(source_apis) == 1

    source_api = source_apis[0]
    # Check all required fields are present
    assert "id" in source_api
    assert "name" in source_api

    # Check field types
    assert isinstance(source_api["id"], str)
    assert isinstance(source_api["name"], str)

    # Check specific values
    assert source_api["id"] == "pyronear_french"
    assert source_api["name"] == "Pyronear French"


@pytest.mark.asyncio
async def test_list_source_apis_all_types(async_client: AsyncClient):
    """Test that all known source API types are handled correctly."""
    # Create sequences for each source API type
    sequences_data = [
        {
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
            "alert_api_id": 6001,
            "camera_name": "Camera 1",
            "camera_id": 601,
            "organisation_name": "Org 1",
            "organisation_id": 1,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T10:00:00",
            "last_seen_at": "2024-01-15T10:30:00",
        },
        {
            "source_api": SourceApi.ALERT_WILDFIRE.value,
            "alert_api_id": 6002,
            "camera_name": "Camera 2",
            "camera_id": 602,
            "organisation_name": "Org 2",
            "organisation_id": 2,
            "lat": 44.0,
            "lon": 2.0,
            "recorded_at": "2024-01-15T12:00:00",
            "last_seen_at": "2024-01-15T12:30:00",
        },
        {
            "source_api": SourceApi.CENIA.value,
            "alert_api_id": 6003,
            "camera_name": "Camera 3",
            "camera_id": 603,
            "organisation_name": "Org 3",
            "organisation_id": 3,
            "lat": -33.4,
            "lon": -70.6,
            "recorded_at": "2024-01-15T14:00:00",
            "last_seen_at": "2024-01-15T14:30:00",
        },
    ]

    # Create sequences
    for seq_data in sequences_data:
        response = await async_client.post("/sequences", data=seq_data)
        assert response.status_code == 201

    # Get source APIs
    response = await async_client.get("/source-apis")
    assert response.status_code == 200
    source_apis = response.json()

    # Should have all 3 types
    assert len(source_apis) == 3

    # Create mapping for easier verification
    api_map = {api["id"]: api["name"] for api in source_apis}

    # Verify all expected mappings
    assert api_map["pyronear_french"] == "Pyronear French"
    assert api_map["alert_wildfire"] == "Alert Wildfire"
    assert api_map["api_cenia"] == "API Cenia"


@pytest.mark.asyncio
async def test_list_source_apis_deduplication(async_client: AsyncClient):
    """Test that duplicate source APIs are properly deduplicated."""
    # Create multiple sequences with the same source API
    sequences_data = [
        {
            "source_api": SourceApi.ALERT_WILDFIRE.value,
            "alert_api_id": 7001,
            "camera_name": "Camera 1",
            "camera_id": 701,
            "organisation_name": "Org 1",
            "organisation_id": 1,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T10:00:00",
            "last_seen_at": "2024-01-15T10:30:00",
        },
        {
            "source_api": SourceApi.ALERT_WILDFIRE.value,  # Same source API
            "alert_api_id": 7002,
            "camera_name": "Camera 2",
            "camera_id": 702,
            "organisation_name": "Org 1",
            "organisation_id": 1,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T11:00:00",
            "last_seen_at": "2024-01-15T11:30:00",
        },
        {
            "source_api": SourceApi.ALERT_WILDFIRE.value,  # Same source API again
            "alert_api_id": 7003,
            "camera_name": "Camera 3",
            "camera_id": 703,
            "organisation_name": "Org 2",
            "organisation_id": 2,
            "lat": 44.0,
            "lon": 2.0,
            "recorded_at": "2024-01-15T12:00:00",
            "last_seen_at": "2024-01-15T12:30:00",
        },
    ]

    # Create sequences
    for seq_data in sequences_data:
        response = await async_client.post("/sequences", data=seq_data)
        assert response.status_code == 201

    # Get source APIs
    response = await async_client.get("/source-apis")
    assert response.status_code == 200
    source_apis = response.json()

    # Should have only 1 unique source API despite 3 sequences
    assert len(source_apis) == 1
    assert source_apis[0]["id"] == "alert_wildfire"
    assert source_apis[0]["name"] == "Alert Wildfire"