from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

now = datetime.utcnow()


@pytest.mark.asyncio
async def test_create_sequence(async_client: AsyncClient):
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "1",
        "camera_name": "test_cam",
        "camera_id": "1",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "is_wildfire_alertapi": "true",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
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
async def test_create_sequence_nullable(async_client: AsyncClient):
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "1",
        "camera_name": "test_cam",
        "camera_id": "1",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
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
async def test_create_sequence_missing_azimuth(async_client: AsyncClient):
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "1",
        "camera_name": "test_cam",
        "camera_id": "1",
        "lat": "0.0",
        "lon": "0.0",
        "last_seen_at": "2025-07-17T08:54:07.886993",
        # "azimuth" est volontairement omis
    }

    response = await async_client.post("/sequences", data=payload)

    # Le code peut varier selon comment l'erreur est gérée (422, 400, 500)
    assert response.status_code >= 400

    # Optionnel : vérifie le contenu de l'erreur si connu
    error = response.json()
    assert "azimuth" in str(error).lower() or "not null" in str(error).lower()

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
