# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import datetime

import pytest
from httpx import AsyncClient

from app.models import SourceApi


@pytest.mark.asyncio
async def test_list_organizations_empty(test_app_client: AsyncClient):
    """Test listing organizations when database is empty."""
    response = await test_app_client.get("/api/v1/organizations")
    assert response.status_code == 200
    data = response.json()
    assert data == []


@pytest.mark.asyncio
async def test_list_organizations_with_sequences(test_app_client: AsyncClient):
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
        response = await test_app_client.post("/api/v1/sequences", data=seq_data)
        assert response.status_code == 201

    # List organizations
    response = await test_app_client.get("/api/v1/organizations")
    assert response.status_code == 200
    orgs = response.json()

    # Should have 3 unique organizations
    assert len(orgs) == 3

    # Find Pyronear France
    pyronear = next(o for o in orgs if o["name"] == "Pyronear France")
    assert pyronear["id"] == 1
    assert pyronear["sequence_count"] == 2
    assert pyronear["latest_sequence_date"] == "2024-01-15T11:00:00"

    # Find AlertWildfire Network
    alertwildfire = next(o for o in orgs if o["name"] == "AlertWildfire Network")
    assert alertwildfire["id"] == 2
    assert alertwildfire["sequence_count"] == 1
    assert alertwildfire["latest_sequence_date"] == "2024-01-14T09:00:00"

    # Find CENIA Chile
    cenia = next(o for o in orgs if o["name"] == "CENIA Chile")
    assert cenia["id"] == 3
    assert cenia["sequence_count"] == 1
    assert cenia["latest_sequence_date"] == "2024-01-16T14:00:00"

    # Verify ordering (alphabetical by name)
    assert orgs[0]["name"] == "AlertWildfire Network"
    assert orgs[1]["name"] == "CENIA Chile"
    assert orgs[2]["name"] == "Pyronear France"


@pytest.mark.asyncio
async def test_list_organizations_with_search(test_app_client: AsyncClient):
    """Test listing organizations with search filter."""
    # Create test sequences
    sequences_data = [
        {
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
            "alert_api_id": 3001,
            "camera_name": "Camera 1",
            "camera_id": 301,
            "organisation_name": "Forest Protection Agency",
            "organisation_id": 10,
            "lat": 43.5,
            "lon": 1.5,
            "recorded_at": "2024-01-15T10:00:00",
            "last_seen_at": "2024-01-15T10:30:00",
        },
        {
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
            "alert_api_id": 3002,
            "camera_name": "Camera 2",
            "camera_id": 302,
            "organisation_name": "Forest Watch International",
            "organisation_id": 11,
            "lat": 43.0,
            "lon": 1.5,
            "recorded_at": "2024-01-15T11:00:00",
            "last_seen_at": "2024-01-15T11:30:00",
        },
        {
            "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
            "alert_api_id": 3003,
            "camera_name": "Camera 3",
            "camera_id": 303,
            "organisation_name": "National Park Service",
            "organisation_id": 12,
            "lat": 43.5,
            "lon": 2.0,
            "recorded_at": "2024-01-15T12:00:00",
            "last_seen_at": "2024-01-15T12:30:00",
        },
    ]

    # Create sequences
    for seq_data in sequences_data:
        response = await test_app_client.post("/api/v1/sequences", data=seq_data)
        assert response.status_code == 201

    # Search for "Forest"
    response = await test_app_client.get("/api/v1/organizations", params={"search": "Forest"})
    assert response.status_code == 200
    orgs = response.json()
    assert len(orgs) == 2
    assert all("Forest" in o["name"] for o in orgs)

    # Search for "International"
    response = await test_app_client.get("/api/v1/organizations", params={"search": "International"})
    assert response.status_code == 200
    orgs = response.json()
    assert len(orgs) == 1
    assert orgs[0]["name"] == "Forest Watch International"

    # Search for non-existent organization
    response = await test_app_client.get("/api/v1/organizations", params={"search": "NonExistent"})
    assert response.status_code == 200
    orgs = response.json()
    assert len(orgs) == 0


@pytest.mark.asyncio
async def test_list_organizations_case_insensitive_search(test_app_client: AsyncClient):
    """Test that organization search is case-insensitive."""
    # Create a test sequence
    seq_data = {
        "source_api": SourceApi.PYRONEAR_FRENCH_API.value,
        "alert_api_id": 4001,
        "camera_name": "Test Camera",
        "camera_id": 401,
        "organisation_name": "Test Organization Name",
        "organisation_id": 20,
        "lat": 43.5,
        "lon": 1.5,
        "recorded_at": "2024-01-15T10:00:00",
        "last_seen_at": "2024-01-15T10:30:00",
    }
    response = await test_app_client.post("/api/v1/sequences", data=seq_data)
    assert response.status_code == 201

    # Test different case variations
    search_terms = ["test", "TEST", "Test", "organization", "ORGANIZATION", "Organization"]
    for term in search_terms:
        response = await test_app_client.get("/api/v1/organizations", params={"search": term})
        assert response.status_code == 200
        orgs = response.json()
        assert len(orgs) == 1
        assert orgs[0]["name"] == "Test Organization Name"


@pytest.mark.asyncio
async def test_list_organizations_response_format(test_app_client: AsyncClient):
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
    response = await test_app_client.post("/api/v1/sequences", data=seq_data)
    assert response.status_code == 201

    # Get organizations
    response = await test_app_client.get("/api/v1/organizations")
    assert response.status_code == 200
    orgs = response.json()
    assert len(orgs) == 1

    org = orgs[0]
    # Check all required fields are present
    assert "id" in org
    assert "name" in org
    assert "sequence_count" in org
    assert "latest_sequence_date" in org

    # Check field types
    assert isinstance(org["id"], int)
    assert isinstance(org["name"], str)
    assert isinstance(org["sequence_count"], int)
    assert isinstance(org["latest_sequence_date"], str)

    # Verify date format
    datetime.fromisoformat(org["latest_sequence_date"])


@pytest.mark.asyncio
async def test_list_organizations_multiple_sources(test_app_client: AsyncClient):
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
        response = await test_app_client.post("/api/v1/sequences", data=seq_data)
        assert response.status_code == 201

    # Get organizations
    response = await test_app_client.get("/api/v1/organizations")
    assert response.status_code == 200
    orgs = response.json()

    assert len(orgs) == 1
    org = orgs[0]
    assert org["name"] == "Multi-Source Org"
    assert org["id"] == 40
    assert org["sequence_count"] == 3
    assert org["latest_sequence_date"] == "2024-01-15T14:00:00"