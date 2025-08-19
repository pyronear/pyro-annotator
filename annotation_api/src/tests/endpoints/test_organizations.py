# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.


import pytest
from httpx import AsyncClient

from app.models import SourceApi


@pytest.mark.asyncio
async def test_list_organizations_empty(async_client: AsyncClient):
    """Test listing organizations when database is empty."""
    response = await async_client.get("/organizations")
    assert response.status_code == 200
    data = response.json()
    assert data == []


@pytest.mark.asyncio
async def test_list_organizations_with_sequences(async_client: AsyncClient):
    """Test listing organizations with existing sequences."""
    # Create some test sequences with different organizations
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
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
            "alert_api_id": 1002,
            "camera_name": "Camera B",
            "camera_id": 102,
            "organisation_name": "Pyronear France",  # Same org
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

    # List organizations
    response = await async_client.get("/organizations")
    assert response.status_code == 200
    orgs = response.json()

    # Should have 3 unique organizations
    assert len(orgs) == 3

    # Find Pyronear France
    pyronear = next(o for o in orgs if o["name"] == "Pyronear France")
    assert pyronear["id"] == 1

    # Find AlertWildfire Network
    alertwildfire = next(o for o in orgs if o["name"] == "AlertWildfire Network")
    assert alertwildfire["id"] == 2

    # Find CENIA Chile
    cenia = next(o for o in orgs if o["name"] == "CENIA Chile")
    assert cenia["id"] == 3

    # Verify ordering (alphabetical by name)
    assert orgs[0]["name"] == "AlertWildfire Network"
    assert orgs[1]["name"] == "CENIA Chile"
    assert orgs[2]["name"] == "Pyronear France"


@pytest.mark.asyncio
async def test_list_organizations_response_format(async_client: AsyncClient):
    """Test that organization response has correct format."""
    # Create a test sequence
    seq_data = {
        "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
        "alert_api_id": 5001,
        "camera_name": "Test Camera",
        "camera_id": 501,
        "organisation_name": "Format Test Organization",
        "organisation_id": 30,
        "lat": 43.5,
        "lon": 1.5,
        "recorded_at": "2024-01-15T10:00:00",
        "last_seen_at": "2024-01-15T10:30:00",
    }
    response = await async_client.post("/sequences", data=seq_data)
    assert response.status_code == 201

    # Get organizations
    response = await async_client.get("/organizations")
    assert response.status_code == 200
    orgs = response.json()
    assert len(orgs) == 1

    org = orgs[0]
    # Check all required fields are present
    assert "id" in org
    assert "name" in org

    # Check field types
    assert isinstance(org["id"], int)
    assert isinstance(org["name"], str)


@pytest.mark.asyncio
async def test_list_organizations_multiple_sources(async_client: AsyncClient):
    """Test that organizations aggregate data from different source APIs correctly."""
    # Create sequences from different sources for the same organization
    sequences_data = [
        {
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
            "alert_api_id": 6001,
            "camera_name": "Camera 1",
            "camera_id": 601,
            "organisation_name": "Multi-Source Org",
            "organisation_id": 40,
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
            "organisation_name": "Multi-Source Org",
            "organisation_id": 40,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T12:00:00",
            "last_seen_at": "2024-01-15T12:30:00",
        },
        {
            "source_api": SourceApi.CENIA.value,
            "alert_api_id": 6003,
            "camera_name": "Camera 3",
            "camera_id": 603,
            "organisation_name": "Multi-Source Org",
            "organisation_id": 40,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T14:00:00",
            "last_seen_at": "2024-01-15T14:30:00",
        },
    ]

    # Create sequences
    for seq_data in sequences_data:
        response = await async_client.post("/sequences", data=seq_data)
        assert response.status_code == 201

    # Get organizations
    response = await async_client.get("/organizations")
    assert response.status_code == 200
    orgs = response.json()

    assert len(orgs) == 1
    org = orgs[0]
    assert org["name"] == "Multi-Source Org"
    assert org["id"] == 40
