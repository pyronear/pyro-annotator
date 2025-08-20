import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

now = datetime.utcnow()

@pytest.mark.asyncio
async def test_create_sequence(authenticated_client: AsyncClient):
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
        "last_seen_at": now.isoformat()
    }

    response = await authenticated_client.post("/sequences", data=payload)
    assert response.status_code == 201
    sequence = response.json()
    assert "id" in sequence
    assert sequence["source_api"] == payload["source_api"]
    assert sequence["is_wildfire_alertapi"] is True
    assert sequence["camera_name"] == payload["camera_name"]

@pytest.mark.asyncio
async def test_get_sequence(authenticated_client: AsyncClient):
    sequence_id = 1
    response = await authenticated_client.get(f"/sequences/{sequence_id}")
    if response.status_code == 200:
        seq = response.json()
        assert seq["id"] == sequence_id
        assert "camera_name" in seq
    else:
        assert response.status_code in (404, 422)

@pytest.mark.asyncio
async def test_list_sequences(authenticated_client: AsyncClient):
    response = await authenticated_client.get("/sequences")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data
    assert "page" in data
    assert "pages" in data
    assert "size" in data
    assert isinstance(data["items"], list)

@pytest.mark.asyncio
async def test_delete_sequence(authenticated_client: AsyncClient, sequence_session):
    sequence_id = 1
    delete_response = await authenticated_client.delete(f"/sequences/{sequence_id}")
    assert delete_response.status_code in (204, 404)

    get_response = await authenticated_client.get(f"/sequences/{sequence_id}")
    assert get_response.status_code == 404

@pytest.mark.asyncio
async def test_create_sequence_without_is_wildfire_alertapi(authenticated_client: AsyncClient):
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
        "last_seen_at": now.isoformat()
    }

    response = await authenticated_client.post("/sequences", data=payload)
    assert response.status_code == 201
    sequence = response.json()
    assert "id" in sequence
    assert sequence["source_api"] == payload["source_api"]
    assert sequence["is_wildfire_alertapi"] is None
    assert sequence["camera_name"] == payload["camera_name"]

@pytest.mark.asyncio
async def test_create_sequence_with_is_wildfire_alertapi_true(
    authenticated_client: AsyncClient,
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
        "last_seen_at": now.isoformat()
    }

    response = await authenticated_client.post("/sequences", data=payload)
    assert response.status_code == 201
    sequence = response.json()
    assert "id" in sequence
    assert sequence["source_api"] == payload["source_api"]
    assert sequence["is_wildfire_alertapi"] is True
    assert sequence["camera_name"] == payload["camera_name"]

@pytest.mark.asyncio
async def test_list_sequences_with_include_annotation(authenticated_client: AsyncClient):
    """Test including annotation data in sequences response"""
    response = await authenticated_client.get("/sequences?include_annotation=true")
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
async def test_list_sequences_filter_by_processing_stage(authenticated_client: AsyncClient):
    """Test filtering sequences by processing stage"""
    # Test filtering by specific processing stage
    response = await authenticated_client.get("/sequences?processing_stage=imported")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data

    # Test filtering by no_annotation
    response = await authenticated_client.get("/sequences?processing_stage=no_annotation")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data

@pytest.mark.asyncio
async def test_list_sequences_filter_by_annotation_fields(authenticated_client: AsyncClient):
    """Test filtering sequences by annotation fields like has_smoke, has_false_positives"""
    # Test filtering by has_smoke
    response = await authenticated_client.get("/sequences?has_smoke=true")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data

    # Test filtering by has_false_positives
    response = await authenticated_client.get("/sequences?has_false_positives=false")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data

    # Test filtering by has_missed_smoke
    response = await authenticated_client.get("/sequences?has_missed_smoke=false")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data

@pytest.mark.asyncio
async def test_list_sequences_combined_filters(authenticated_client: AsyncClient):
    """Test combining annotation inclusion with filtering"""
    response = await authenticated_client.get(
        "/sequences?include_annotation=true&processing_stage=annotated&has_smoke=true"
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data

    # Verify that sequences with annotations have the expected fields
    for item in data["items"]:
        assert "annotation" in item
        if item["annotation"]:
            assert item["annotation"]["processing_stage"] == "annotated"
            assert item["annotation"]["has_smoke"] is True

@pytest.mark.asyncio
async def test_create_sequence_with_is_wildfire_alertapi_false(
    authenticated_client: AsyncClient,
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
        "last_seen_at": now.isoformat()
    }

    response = await authenticated_client.post("/sequences", data=payload)
    assert response.status_code == 201
    sequence = response.json()
    assert "id" in sequence
    assert sequence["source_api"] == payload["source_api"]
    assert sequence["is_wildfire_alertapi"] is False
    assert sequence["camera_name"] == payload["camera_name"]

@pytest.mark.asyncio
async def test_create_duplicate_sequence_unique_constraint(authenticated_client: AsyncClient):
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
        "last_seen_at": now.isoformat()
    }

    # First sequence should be created successfully
    response1 = await authenticated_client.post("/sequences", data=payload)
    assert response1.status_code == 201
    sequence1 = response1.json()
    assert "id" in sequence1

    # Second sequence with same alert_api_id and source_api should fail
    payload2 = payload.copy()
    payload2["camera_name"] = (
        "different_camera"  # Different camera but same alert_api_id + source_api
    )
    payload2["camera_id"] = "998"

    response2 = await authenticated_client.post("/sequences", data=payload2)
    # Should return 422 (validation error) or 409 (conflict) due to unique constraint violation
    assert response2.status_code in (
        409,
        422,
        500,
    )  # Different frameworks may return different status codes

    # Verify the first sequence still exists and is accessible
    sequence1_id = sequence1["id"]
    get_response = await authenticated_client.get(f"/sequences/{sequence1_id}")
    assert get_response.status_code == 200
    retrieved_sequence = get_response.json()
    assert retrieved_sequence["alert_api_id"] == int(payload["alert_api_id"])
    assert retrieved_sequence["source_api"] == payload["source_api"]

@pytest.mark.asyncio
async def test_create_sequence_different_source_api_same_alert_id(
    authenticated_client: AsyncClient,
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
        "last_seen_at": now.isoformat()
    }

    # Create sequence with pyronear_french source
    payload1 = base_payload.copy()
    payload1["source_api"] = "pyronear_french"

    response1 = await authenticated_client.post("/sequences", data=payload1)
    assert response1.status_code == 201
    sequence1 = response1.json()
    assert sequence1["source_api"] == "pyronear_french"

    # Create sequence with alert_wildfire source (same alert_api_id, different source_api)
    payload2 = base_payload.copy()
    payload2["source_api"] = "alert_wildfire"
    payload2["camera_name"] = "different_source_camera"
    payload2["camera_id"] = "887"

    response2 = await authenticated_client.post("/sequences", data=payload2)
    assert response2.status_code == 201
    sequence2 = response2.json()
    assert sequence2["source_api"] == "alert_wildfire"

    # Both sequences should have the same alert_api_id but different source_api
    assert sequence1["alert_api_id"] == sequence2["alert_api_id"]
    assert sequence1["source_api"] != sequence2["source_api"]

@pytest.mark.asyncio
async def test_list_sequences_has_annotation_filter(
    authenticated_client: AsyncClient, sequence_session
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
            "last_seen_at": now.isoformat()
        }
        for i in range(3)
    ]

    sequence_ids = []
    for seq_data in sequences_data:
        response = await authenticated_client.post("/sequences", data=seq_data)
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
                        "false_positive_types": [],
                        "bboxes": []
                    }
                ]
            },
            "processing_stage": "imported",
            "created_at": datetime.utcnow().isoformat()
        }
        response = await authenticated_client.post(
            "/annotations/sequences/", json=annotation_payload
        )
        assert response.status_code == 201

    # Test 1: Get sequences WITHOUT annotations (should only get the third sequence)
    response = await authenticated_client.get("/sequences?has_annotation=false")
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
    response = await authenticated_client.get("/sequences?has_annotation=true")
    assert response.status_code == 200
    data = response.json()
    sequences_with_annotations = data["items"]

    # Should have our first two sequences
    assert any(seq["id"] == sequence_ids[0] for seq in sequences_with_annotations)
    assert any(seq["id"] == sequence_ids[1] for seq in sequences_with_annotations)
    # The third sequence should NOT be in the results
    assert not any(seq["id"] == sequence_ids[2] for seq in sequences_with_annotations)

    # Test 3: Default behavior (no filter) - should get all sequences
    response = await authenticated_client.get("/sequences")
    assert response.status_code == 200
    data = response.json()
    all_sequences = data["items"]

    # All three sequences should be present
    for seq_id in sequence_ids:
        assert any(seq["id"] == seq_id for seq in all_sequences)

@pytest.mark.asyncio
async def test_list_sequences_filter_by_camera_name(authenticated_client: AsyncClient):
    """Test filtering sequences by camera name."""
    # Create test sequences with different camera names
    test_sequences = [
        {
            "source_api": "pyronear_french",
            "alert_api_id": "7001",
            "camera_name": "Station North Alpha",
            "camera_id": "701",
            "organisation_name": "Test Org",
            "organisation_id": "1",
            "lat": "43.5",
            "lon": "1.5",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        },
        {
            "source_api": "pyronear_french",
            "alert_api_id": "7002",
            "camera_name": "Station South Beta",
            "camera_id": "702",
            "organisation_name": "Test Org",
            "organisation_id": "1",
            "lat": "43.0",
            "lon": "1.5",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        },
        {
            "source_api": "pyronear_french",
            "alert_api_id": "7003",
            "camera_name": "Tower East Gamma",
            "camera_id": "703",
            "organisation_name": "Test Org",
            "organisation_id": "1",
            "lat": "43.5",
            "lon": "2.0",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        }
    ]

    # Create sequences
    sequence_ids = []
    for seq_data in test_sequences:
        response = await authenticated_client.post("/sequences", data=seq_data)
        assert response.status_code == 201
        sequence_ids.append(response.json()["id"])

    # Test filtering by exact camera name
    response = await authenticated_client.get("/sequences?camera_name=Station North Alpha")
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]

    assert (
        len(
            [
                seq
                for seq in filtered_sequences
                if seq["camera_name"] == "Station North Alpha"
            ]
        )
        >= 1
    )
    # Verify no sequences with different camera names are returned
    for seq in filtered_sequences:
        if seq["id"] in sequence_ids:
            assert seq["camera_name"] == "Station North Alpha"

    # Test filtering by another camera name
    response = await authenticated_client.get("/sequences?camera_name=Tower East Gamma")
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]

    assert (
        len(
            [
                seq
                for seq in filtered_sequences
                if seq["camera_name"] == "Tower East Gamma"
            ]
        )
        >= 1
    )
    for seq in filtered_sequences:
        if seq["id"] in sequence_ids:
            assert seq["camera_name"] == "Tower East Gamma"

    # Test with non-existent camera name
    response = await authenticated_client.get("/sequences?camera_name=NonExistent Camera")
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]

    # Should not return any of our test sequences
    for seq in filtered_sequences:
        assert seq["id"] not in sequence_ids

@pytest.mark.asyncio
async def test_list_sequences_filter_by_organisation_name(authenticated_client: AsyncClient):
    """Test filtering sequences by organisation name."""
    # Create test sequences with different organization names
    test_sequences = [
        {
            "source_api": "pyronear_french",
            "alert_api_id": "8001",
            "camera_name": "Camera A",
            "camera_id": "801",
            "organisation_name": "Forest Protection Agency",
            "organisation_id": "10",
            "lat": "43.5",
            "lon": "1.5",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        },
        {
            "source_api": "alert_wildfire",
            "alert_api_id": "8002",
            "camera_name": "Camera B",
            "camera_id": "802",
            "organisation_name": "National Park Service",
            "organisation_id": "11",
            "lat": "44.0",
            "lon": "2.0",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        },
        {
            "source_api": "api_cenia",
            "alert_api_id": "8003",
            "camera_name": "Camera C",
            "camera_id": "803",
            "organisation_name": "Forest Protection Agency",  # Same org as first
            "organisation_id": "10",
            "lat": "-33.4",
            "lon": "-70.6",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        }
    ]

    # Create sequences
    sequence_ids = []
    for seq_data in test_sequences:
        response = await authenticated_client.post("/sequences", data=seq_data)
        assert response.status_code == 201
        sequence_ids.append(response.json()["id"])

    # Test filtering by organization name that has 2 sequences
    response = await authenticated_client.get(
        "/sequences?organisation_name=Forest Protection Agency"
    )
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]

    # Should return at least 2 sequences with this org name
    matching_sequences = [
        seq
        for seq in filtered_sequences
        if seq["organisation_name"] == "Forest Protection Agency"
    ]
    assert len(matching_sequences) >= 2

    # Verify only sequences with correct org name are returned
    for seq in filtered_sequences:
        if seq["id"] in sequence_ids:
            assert seq["organisation_name"] == "Forest Protection Agency"

    # Test filtering by organization name that has 1 sequence
    response = await authenticated_client.get(
        "/sequences?organisation_name=National Park Service"
    )
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]

    matching_sequences = [
        seq
        for seq in filtered_sequences
        if seq["organisation_name"] == "National Park Service"
    ]
    assert len(matching_sequences) >= 1

    for seq in filtered_sequences:
        if seq["id"] in sequence_ids:
            assert seq["organisation_name"] == "National Park Service"

    # Test with non-existent organization name
    response = await authenticated_client.get(
        "/sequences?organisation_name=NonExistent Organization"
    )
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]

    # Should not return any of our test sequences
    for seq in filtered_sequences:
        assert seq["id"] not in sequence_ids

@pytest.mark.asyncio
async def test_list_sequences_combined_name_and_id_filters(authenticated_client: AsyncClient):
    """Test that name filters work alongside existing ID filters."""
    # Create test sequences
    test_sequences = [
        {
            "source_api": "pyronear_french",
            "alert_api_id": "9001",
            "camera_name": "Test Camera Alpha",
            "camera_id": "901",
            "organisation_name": "Test Organization Alpha",
            "organisation_id": "20",
            "lat": "43.5",
            "lon": "1.5",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        },
        {
            "source_api": "pyronear_french",
            "alert_api_id": "9002",
            "camera_name": "Test Camera Beta",
            "camera_id": "902",
            "organisation_name": "Test Organization Alpha",  # Same org as first
            "organisation_id": "20",
            "lat": "43.0",
            "lon": "1.5",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        }
    ]

    # Create sequences
    sequence_ids = []
    for seq_data in test_sequences:
        response = await authenticated_client.post("/sequences", data=seq_data)
        assert response.status_code == 201
        sequence_ids.append(response.json()["id"])

    # Test combining camera_name with organisation_id
    response = await authenticated_client.get(
        "/sequences?camera_name=Test Camera Alpha&organisation_id=20"
    )
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]

    # Should match the first sequence only
    matching_sequences = [
        seq for seq in filtered_sequences if seq["id"] == sequence_ids[0]
    ]
    assert len(matching_sequences) == 1
    assert matching_sequences[0]["camera_name"] == "Test Camera Alpha"
    assert matching_sequences[0]["organisation_id"] == 20

    # Test combining organisation_name with camera_id
    response = await authenticated_client.get(
        "/sequences?organisation_name=Test Organization Alpha&camera_id=902"
    )
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]

    # Should match the second sequence only
    matching_sequences = [
        seq for seq in filtered_sequences if seq["id"] == sequence_ids[1]
    ]
    assert len(matching_sequences) == 1
    assert matching_sequences[0]["organisation_name"] == "Test Organization Alpha"
    assert matching_sequences[0]["camera_id"] == 902

    # Test incompatible filters (should return no results)
    response = await authenticated_client.get(
        "/sequences?camera_name=Test Camera Alpha&camera_id=902"
    )
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]

    # Should not match any of our test sequences since camera name doesn't match camera ID
    for seq in filtered_sequences:
        assert seq["id"] not in sequence_ids


@pytest.mark.asyncio
async def test_list_sequences_filter_by_false_positive_types(authenticated_client: AsyncClient):
    """Test filtering sequences by false positive types."""
    # Create test sequences with annotations containing different false positive types
    test_sequences = [
        {
            "source_api": "pyronear_french",
            "alert_api_id": "8001",
            "camera_name": "FP Test Camera 1",
            "camera_id": "801",
            "organisation_name": "Test Org",
            "organisation_id": "1",
            "lat": "43.5",
            "lon": "1.5",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        },
        {
            "source_api": "pyronear_french",
            "alert_api_id": "8002",
            "camera_name": "FP Test Camera 2",
            "camera_id": "802",
            "organisation_name": "Test Org",
            "organisation_id": "1",
            "lat": "43.0",
            "lon": "1.5",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        },
        {
            "source_api": "pyronear_french",
            "alert_api_id": "8003",
            "camera_name": "FP Test Camera 3",
            "camera_id": "803",
            "organisation_name": "Test Org",
            "organisation_id": "1",
            "lat": "43.5",
            "lon": "2.0",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "last_seen_at": now.isoformat()
        }
    ]

    # Create sequences and get their IDs
    sequence_ids = []
    for seq_data in test_sequences:
        response = await authenticated_client.post("/sequences", data=seq_data)
        assert response.status_code == 201
        sequence_ids.append(response.json()["id"])

    # Create detections first (required for bbox validation) and capture their IDs
    detection_ids = []
    for i, seq_id in enumerate(sequence_ids, 1):
        detection_payload = {
            "sequence_id": str(seq_id),
            "alert_api_id": str(i),
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "algo_predictions": json.dumps({
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.85,
                        "class_name": "smoke"
                    }
                ]
            })
        }
        
        # Create a simple test image for the detection
        import io
        from PIL import Image
        img = Image.new('RGB', (100, 100), color='red')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='JPEG')
        img_bytes.seek(0)
        
        files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
        
        response = await authenticated_client.post("/detections", data=detection_payload, files=files)
        assert response.status_code == 201
        detection_ids.append(response.json()["id"])

    # Create sequence annotations with different false positive types using actual detection IDs
    annotations = [
        {
            "sequence_id": sequence_ids[0],
            "has_smoke": False,
            "has_false_positives": True,
            "false_positive_types": ["antenna", "building"],  # Multiple types
            "has_missed_smoke": False,
            "annotation": {
                "sequences_bbox": [
                    {
                        "is_smoke": False,
                        "false_positive_types": ["antenna", "building"],
                        "bboxes": [{"detection_id": detection_ids[0], "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                    }
                ]
            },
            "processing_stage": "annotated"
        },
        {
            "sequence_id": sequence_ids[1],
            "has_smoke": False,
            "has_false_positives": True,
            "false_positive_types": ["lens_flare"],  # Single type
            "has_missed_smoke": False,
            "annotation": {
                "sequences_bbox": [
                    {
                        "is_smoke": False,
                        "false_positive_types": ["lens_flare"],
                        "bboxes": [{"detection_id": detection_ids[1], "xyxyn": [0.2, 0.2, 0.3, 0.3]}],
                    }
                ]
            },
            "processing_stage": "annotated"
        },
        {
            "sequence_id": sequence_ids[2],
            "has_smoke": True,
            "has_false_positives": False,
            "false_positive_types": [],  # No false positives
            "has_missed_smoke": False,
            "annotation": {
                "sequences_bbox": [
                    {
                        "is_smoke": True,
                        "false_positive_types": [],
                        "bboxes": [{"detection_id": detection_ids[2], "xyxyn": [0.3, 0.3, 0.4, 0.4]}],
                    }
                ]
            },
            "processing_stage": "annotated"
        }
    ]

    # Create annotations
    for annotation_data in annotations:
        response = await authenticated_client.post("/annotations/sequences/", json=annotation_data)
        assert response.status_code == 201

    # Test 1: Filter by single false positive type - should match first sequence
    response = await authenticated_client.get("/sequences?false_positive_types=antenna&include_annotation=true")
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]
    
    # Should only match first sequence
    matching_ids = [seq["id"] for seq in filtered_sequences if seq["id"] in sequence_ids]
    assert sequence_ids[0] in matching_ids
    assert sequence_ids[1] not in matching_ids
    assert sequence_ids[2] not in matching_ids

    # Test 2: Filter by multiple false positive types - should match first two sequences
    response = await authenticated_client.get("/sequences?false_positive_types=antenna&false_positive_types=lens_flare&include_annotation=true")
    assert response.status_code == 200
    data = response.json()
    filtered_sequences = data["items"]
    
    # Should match first two sequences
    matching_ids = [seq["id"] for seq in filtered_sequences if seq["id"] in sequence_ids]
    assert sequence_ids[0] in matching_ids
    assert sequence_ids[1] in matching_ids
    assert sequence_ids[2] not in matching_ids

    # Test 3: Filter by non-existent false positive type - should return validation error
    response = await authenticated_client.get("/sequences?false_positive_types=nonexistent&include_annotation=true")
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data
    # Verify it's a validation error for the enum
    assert any("Input should be" in str(error) for error in error_data["detail"])


@pytest.mark.asyncio
async def test_list_sequences_false_positive_types_validation(authenticated_client: AsyncClient):
    """Test that invalid false positive types return proper validation errors."""
    # Test with invalid false positive type - should return 422 validation error
    response = await authenticated_client.get("/sequences?false_positive_types=invalid_type")
    assert response.status_code == 422
    
    # Test with mix of valid and invalid types
    response = await authenticated_client.get("/sequences?false_positive_types=antenna&false_positive_types=invalid_type")
    assert response.status_code == 422
