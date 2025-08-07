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
        "recorded_at": (now - timedelta(days=1)).isoformat(),
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
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data
    assert "page" in data
    assert "pages" in data
    assert "size" in data
    assert isinstance(data["items"], list)


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
        "recorded_at": (now - timedelta(days=1)).isoformat(),
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
        "recorded_at": (now - timedelta(days=1)).isoformat(),
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
async def test_list_sequences_with_include_annotation(async_client: AsyncClient):
    """Test including annotation data in sequences response"""
    response = await async_client.get("/sequences?include_annotation=true")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data
    assert "page" in data
    assert isinstance(data["items"], list)
    
    # Check that annotation field exists (can be null for sequences without annotations)
    if data["items"]:
        first_item = data["items"][0]
        assert "annotation" in first_item
        # If annotation exists, verify it has the expected fields
        if first_item["annotation"]:
            annotation = first_item["annotation"]
            assert "id" in annotation
            assert "processing_stage" in annotation
            assert "has_smoke" in annotation
            assert "has_false_positives" in annotation
            assert "has_missed_smoke" in annotation
            assert "annotation" in annotation


@pytest.mark.asyncio
async def test_list_sequences_filter_by_processing_stage(async_client: AsyncClient):
    """Test filtering sequences by processing stage"""
    # Test filtering by specific processing stage
    response = await async_client.get("/sequences?processing_stage=imported")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data
    
    # Test filtering by no_annotation
    response = await async_client.get("/sequences?processing_stage=no_annotation")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data


@pytest.mark.asyncio
async def test_list_sequences_filter_by_annotation_fields(async_client: AsyncClient):
    """Test filtering sequences by annotation fields like has_smoke, has_false_positives"""
    # Test filtering by has_smoke
    response = await async_client.get("/sequences?has_smoke=true")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data
    
    # Test filtering by has_false_positives
    response = await async_client.get("/sequences?has_false_positives=false")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data
    
    # Test filtering by has_missed_smoke
    response = await async_client.get("/sequences?has_missed_smoke=false")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data


@pytest.mark.asyncio
async def test_list_sequences_combined_filters(async_client: AsyncClient):
    """Test combining annotation inclusion with filtering"""
    response = await async_client.get("/sequences?include_annotation=true&processing_stage=annotated&has_smoke=true")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data
    
    # Verify that sequences with annotations have the expected fields
    for item in data["items"]:
        assert "annotation" in item
        if item["annotation"]:
            assert item["annotation"]["processing_stage"] == "annotated"
            assert item["annotation"]["has_smoke"] == True


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
        "recorded_at": (now - timedelta(days=1)).isoformat(),
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
        "recorded_at": (now - timedelta(days=1)).isoformat(),
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
        "recorded_at": (now - timedelta(days=1)).isoformat(),
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


@pytest.mark.asyncio
async def test_list_sequences_has_annotation_filter(
    async_client: AsyncClient, sequence_session
):
    """Test filtering sequences by presence of annotations."""
    # First, create some sequences
    sequences_data = [
        {
            "source_api": "pyronear_french",
            "alert_api_id": str(2000 + i),
            "camera_name": f"test_cam_{i}",
            "camera_id": str(1000 + i),
            "organisation_name": "test_org",
            "organisation_id": "1",
            "lat": "0.0",
            "lon": "0.0",
            "created_at": (now - timedelta(days=1)).isoformat(),
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat(),
        }
        for i in range(3)
    ]

    sequence_ids = []
    for seq_data in sequences_data:
        response = await async_client.post("/sequences", data=seq_data)
        assert response.status_code == 201
        sequence_ids.append(response.json()["id"])

    # Create annotations for the first two sequences only
    for i in range(2):
        annotation_payload = {
            "sequence_id": sequence_ids[i],
            "has_missed_smoke": False,
            "annotation": {
                "sequences_bbox": [
                    {
                        "is_smoke": True,
                        "gif_key_main": f"gifs/sequence_1/main_{i}.gif",
                        "gif_key_crop": f"gifs/sequence_1/crop_{i}.gif",
                        "false_positive_types": [],
                        "bboxes": [],
                    }
                ]
            },
            "processing_stage": "imported",
            "created_at": datetime.utcnow().isoformat(),
        }
        response = await async_client.post(
            "/annotations/sequences/", json=annotation_payload
        )
        assert response.status_code == 201

    # Test 1: Get sequences WITHOUT annotations (should only get the third sequence)
    response = await async_client.get("/sequences?has_annotation=false")
    assert response.status_code == 200
    data = response.json()
    sequences_without_annotations = data["items"]

    # Should have at least our third sequence (might have others from other tests)
    assert any(seq["id"] == sequence_ids[2] for seq in sequences_without_annotations)
    # The first two sequences should NOT be in the results
    assert not any(
        seq["id"] == sequence_ids[0] for seq in sequences_without_annotations
    )
    assert not any(
        seq["id"] == sequence_ids[1] for seq in sequences_without_annotations
    )

    # Test 2: Get sequences WITH annotations (should get the first two sequences)
    response = await async_client.get("/sequences?has_annotation=true")
    assert response.status_code == 200
    data = response.json()
    sequences_with_annotations = data["items"]

    # Should have our first two sequences
    assert any(seq["id"] == sequence_ids[0] for seq in sequences_with_annotations)
    assert any(seq["id"] == sequence_ids[1] for seq in sequences_with_annotations)
    # The third sequence should NOT be in the results
    assert not any(seq["id"] == sequence_ids[2] for seq in sequences_with_annotations)

    # Test 3: Default behavior (no filter) - should get all sequences
    response = await async_client.get("/sequences")
    assert response.status_code == 200
    data = response.json()
    all_sequences = data["items"]

    # All three sequences should be present
    for seq_id in sequence_ids:
        assert any(seq["id"] == seq_id for seq in all_sequences)
