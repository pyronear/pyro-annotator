from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

now = datetime.utcnow()


@pytest.mark.asyncio
async def test_create_sequence(async_client: AsyncClient):
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "100",
        "camera_name": "test_cam",
        "camera_id": "1",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "is_wildfire_alertapi": "true",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "created_at": (now - timedelta(days=1)).isoformat(),
        "last_seen_at": now.isoformat(),
    }

    response = await async_client.post("/sequences", data=payload)
    assert response.status_code == 201
    sequence = response.json()
    assert "id" in sequence
    assert sequence["source_api"] == payload["source_api"]
    assert sequence["is_wildfire_alertapi"] is True
    assert sequence["camera_name"] == payload["camera_name"]


@pytest.mark.asyncio
async def test_get_sequence(async_client: AsyncClient):
    sequence_id = 1
    response = await async_client.get(f"/sequences/{sequence_id}")
    if response.status_code == 200:
        seq = response.json()
        assert seq["id"] == sequence_id
        assert "camera_name" in seq
    else:
        assert response.status_code in (404, 422)


@pytest.mark.asyncio
async def test_list_sequences(async_client: AsyncClient):
    response = await async_client.get("/sequences")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_delete_sequence(async_client: AsyncClient, sequence_session):
    sequence_id = 1
    delete_response = await async_client.delete(f"/sequences/{sequence_id}")
    assert delete_response.status_code in (204, 404)

    get_response = await async_client.get(f"/sequences/{sequence_id}")
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_create_sequence_without_is_wildfire_alertapi(async_client: AsyncClient):
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "101",
        "camera_name": "test_cam_no_wildfire",
        "camera_id": "101",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "created_at": (now - timedelta(days=1)).isoformat(),
        "last_seen_at": now.isoformat(),
    }

    response = await async_client.post("/sequences", data=payload)
    assert response.status_code == 201
    sequence = response.json()
    assert "id" in sequence
    assert sequence["source_api"] == payload["source_api"]
    assert sequence["is_wildfire_alertapi"] is None
    assert sequence["camera_name"] == payload["camera_name"]


@pytest.mark.asyncio
async def test_create_sequence_with_is_wildfire_alertapi_true(
    async_client: AsyncClient,
):
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "102",
        "camera_name": "test_cam_true",
        "camera_id": "102",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "is_wildfire_alertapi": "true",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "created_at": (now - timedelta(days=1)).isoformat(),
        "last_seen_at": now.isoformat(),
    }

    response = await async_client.post("/sequences", data=payload)
    assert response.status_code == 201
    sequence = response.json()
    assert "id" in sequence
    assert sequence["source_api"] == payload["source_api"]
    assert sequence["is_wildfire_alertapi"] is True
    assert sequence["camera_name"] == payload["camera_name"]


@pytest.mark.asyncio
async def test_create_sequence_with_is_wildfire_alertapi_false(
    async_client: AsyncClient,
):
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "103",
        "camera_name": "test_cam_false",
        "camera_id": "103",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "is_wildfire_alertapi": "false",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "created_at": (now - timedelta(days=1)).isoformat(),
        "last_seen_at": now.isoformat(),
    }

    response = await async_client.post("/sequences", data=payload)
    assert response.status_code == 201
    sequence = response.json()
    assert "id" in sequence
    assert sequence["source_api"] == payload["source_api"]
    assert sequence["is_wildfire_alertapi"] is False
    assert sequence["camera_name"] == payload["camera_name"]


@pytest.mark.asyncio
async def test_create_duplicate_sequence_unique_constraint(async_client: AsyncClient):
    """Test that creating sequences with duplicate (alert_api_id, source_api) fails due to unique constraint."""
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "999",
        "camera_name": "test_duplicate_cam",
        "camera_id": "999",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "created_at": (now - timedelta(days=1)).isoformat(),
        "last_seen_at": now.isoformat(),
    }

    # First sequence should be created successfully
    response1 = await async_client.post("/sequences", data=payload)
    assert response1.status_code == 201
    sequence1 = response1.json()
    assert "id" in sequence1

    # Second sequence with same alert_api_id and source_api should fail
    payload2 = payload.copy()
    payload2["camera_name"] = (
        "different_camera"  # Different camera but same alert_api_id + source_api
    )
    payload2["camera_id"] = "998"

    response2 = await async_client.post("/sequences", data=payload2)
    # Should return 422 (validation error) or 409 (conflict) due to unique constraint violation
    assert response2.status_code in (
        409,
        422,
        500,
    )  # Different frameworks may return different status codes

    # Verify the first sequence still exists and is accessible
    sequence1_id = sequence1["id"]
    get_response = await async_client.get(f"/sequences/{sequence1_id}")
    assert get_response.status_code == 200
    retrieved_sequence = get_response.json()
    assert retrieved_sequence["alert_api_id"] == int(payload["alert_api_id"])
    assert retrieved_sequence["source_api"] == payload["source_api"]


@pytest.mark.asyncio
async def test_create_sequence_different_source_api_same_alert_id(
    async_client: AsyncClient,
):
    """Test that sequences with same alert_api_id but different source_api can be created."""
    base_payload = {
        "alert_api_id": "888",
        "camera_name": "test_different_source",
        "camera_id": "888",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "created_at": (now - timedelta(days=1)).isoformat(),
        "last_seen_at": now.isoformat(),
    }

    # Create sequence with pyronear_french source
    payload1 = base_payload.copy()
    payload1["source_api"] = "pyronear_french"

    response1 = await async_client.post("/sequences", data=payload1)
    assert response1.status_code == 201
    sequence1 = response1.json()
    assert sequence1["source_api"] == "pyronear_french"

    # Create sequence with alert_wildfire source (same alert_api_id, different source_api)
    payload2 = base_payload.copy()
    payload2["source_api"] = "alert_wildfire"
    payload2["camera_name"] = "different_source_camera"
    payload2["camera_id"] = "887"

    response2 = await async_client.post("/sequences", data=payload2)
    assert response2.status_code == 201
    sequence2 = response2.json()
    assert sequence2["source_api"] == "alert_wildfire"

    # Both sequences should have the same alert_api_id but different source_api
    assert sequence1["alert_api_id"] == sequence2["alert_api_id"]
    assert sequence1["source_api"] != sequence2["source_api"]
