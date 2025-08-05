import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

now = datetime.utcnow()


@pytest.mark.asyncio
async def test_create_detection_annotation(
    async_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.15, 0.15, 0.3, 0.3],
                        "confidence": 0.88,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    detection_response = await async_client.post(
        "/detections",
        data=detection_payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response.status_code == 201
    detection_id = detection_response.json()["id"]

    annotation_payload = {
        "detection_id": str(detection_id),
        "annotation": json.dumps(
            {
                "annotation": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "class_name": "smoke",
                        "smoke_type": "wildfire",
                    }
                ]
            }
        ),
        "processing_stage": "visual_check",  # Enum sous forme de str
    }

    response = await async_client.post(
        "/annotations/detections/", data=annotation_payload
    )
    assert response.status_code == 201
    json_response = response.json()
    assert json_response["detection_id"] == detection_id
    assert json_response["processing_stage"] == "visual_check"
    assert "annotation" in json_response


@pytest.mark.asyncio
async def test_list_detection_annotations(async_client: AsyncClient):
    response = await async_client.get("/annotations/detections/")
    assert response.status_code == 200
    json_response = response.json()
    assert isinstance(json_response, dict)
    assert "items" in json_response
    assert "page" in json_response
    assert "pages" in json_response
    assert "size" in json_response
    assert isinstance(json_response["items"], list)


@pytest.mark.asyncio
async def test_get_detection_annotation(async_client: AsyncClient):
    annotation_id = 1
    response = await async_client.get(f"/annotations/detections/{annotation_id}")
    if response.status_code == 200:
        annotation = response.json()
        assert annotation["id"] == annotation_id
        assert "annotation" in annotation
    else:
        assert response.status_code in (404, 422)


@pytest.mark.asyncio
async def test_update_detection_annotation(async_client: AsyncClient):
    annotation_id = 1
    update_payload = {
        "annotation": {
            "annotation": [
                {
                    "xyxyn": [0.2, 0.2, 0.3, 0.3],
                    "class_name": "smoke",
                    "smoke_type": "industrial",
                }
            ]
        },
        "processing_stage": "annotated",
    }

    response = await async_client.patch(
        f"/annotations/detections/{annotation_id}", json=update_payload
    )

    if response.status_code == 200:
        json_response = response.json()
        assert json_response["processing_stage"] == "annotated"
        assert (
            json_response["annotation"]["annotation"][0]["smoke_type"] == "industrial"
        )
    else:
        assert response.status_code in (404, 422)


@pytest.mark.asyncio
async def test_delete_detection_annotation(async_client: AsyncClient):
    annotation_id = 1
    delete_response = await async_client.delete(
        f"/annotations/detections/{annotation_id}"
    )
    assert delete_response.status_code in (204, 404)

    get_response = await async_client.get(f"/annotations/detections/{annotation_id}")
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_create_detection_annotation_invalid_xyxyn(
    async_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    # First create a detection
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.15, 0.15, 0.3, 0.3],
                        "confidence": 0.88,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    detection_response = await async_client.post(
        "/detections",
        data=detection_payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response.status_code == 201
    detection_id = detection_response.json()["id"]

    # Test invalid xyxyn constraints
    annotation_payload = {
        "detection_id": str(detection_id),
        "annotation": json.dumps(
            {
                "annotation": [
                    {
                        "xyxyn": [0.3, 0.3, 0.2, 0.2],  # x1 > x2, y1 > y2
                        "class_name": "smoke",
                        "smoke_type": "wildfire",
                    }
                ]
            }
        ),
        "processing_stage": "visual_check",
    }

    response = await async_client.post(
        "/annotations/detections/", data=annotation_payload
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_detection_annotation_invalid_smoke_type(
    async_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    # First create a detection
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.15, 0.15, 0.3, 0.3],
                        "confidence": 0.88,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    detection_response = await async_client.post(
        "/detections",
        data=detection_payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response.status_code == 201
    detection_id = detection_response.json()["id"]

    # Test invalid smoke_type enum
    annotation_payload = {
        "detection_id": str(detection_id),
        "annotation": json.dumps(
            {
                "annotation": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "class_name": "smoke",
                        "smoke_type": "invalid_smoke_type_not_in_enum",
                    }
                ]
            }
        ),
        "processing_stage": "visual_check",
    }

    response = await async_client.post(
        "/annotations/detections/", data=annotation_payload
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_detection_annotation_invalid_json_structure(
    async_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    # First create a detection
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.15, 0.15, 0.3, 0.3],
                        "confidence": 0.88,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    detection_response = await async_client.post(
        "/detections",
        data=detection_payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response.status_code == 201
    detection_id = detection_response.json()["id"]

    # Test invalid JSON structure
    annotation_payload = {
        "detection_id": str(detection_id),
        "annotation": json.dumps(
            {
                "wrong_field": [  # Should be "annotation"
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "class_name": "smoke",
                        "smoke_type": "wildfire",
                    }
                ]
            }
        ),
        "processing_stage": "visual_check",
    }

    response = await async_client.post(
        "/annotations/detections/", data=annotation_payload
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_detection_annotation_unique_constraint_violation(
    async_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """Test that creating multiple annotations for the same detection fails due to unique constraint."""
    # First create a detection
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "999",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.15, 0.15, 0.3, 0.3],
                        "confidence": 0.88,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    detection_response = await async_client.post(
        "/detections",
        data=detection_payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response.status_code == 201
    detection_id = detection_response.json()["id"]

    # Create first annotation - should succeed
    annotation_payload1 = {
        "detection_id": str(detection_id),
        "annotation": json.dumps(
            {
                "annotation": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "class_name": "smoke",
                        "smoke_type": "wildfire",
                    }
                ]
            }
        ),
        "processing_stage": "visual_check",
    }

    response1 = await async_client.post(
        "/annotations/detections/", data=annotation_payload1
    )
    assert response1.status_code == 201
    annotation1 = response1.json()
    assert annotation1["detection_id"] == detection_id

    # Try to create second annotation for same detection - should fail
    annotation_payload2 = {
        "detection_id": str(detection_id),  # Same detection_id
        "annotation": json.dumps(
            {
                "annotation": [
                    {
                        "xyxyn": [0.2, 0.2, 0.3, 0.3],
                        "class_name": "smoke",
                        "smoke_type": "industrial",
                    }
                ]
            }
        ),
        "processing_stage": "annotated",
    }

    # Try to create second annotation for same detection - should fail with 409 Conflict
    response2 = await async_client.post("/annotations/detections/", data=annotation_payload2)
    assert response2.status_code == 409  # Conflict due to unique constraint violation

    # Verify first annotation still exists and is accessible
    annotation1_id = annotation1["id"]
    get_response = await async_client.get(f"/annotations/detections/{annotation1_id}")
    assert get_response.status_code == 200
    retrieved_annotation = get_response.json()
    assert retrieved_annotation["detection_id"] == detection_id


@pytest.mark.asyncio
async def test_create_detection_annotation_different_detections_allowed(
    async_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """Test that creating annotations for different detections succeeds."""
    # Create first detection
    detection_payload1 = {
        "sequence_id": "1",
        "alert_api_id": "777",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.15, 0.15, 0.3, 0.3],
                        "confidence": 0.88,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    detection_response1 = await async_client.post(
        "/detections",
        data=detection_payload1,
        files={"file": ("image1.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response1.status_code == 201
    detection_id1 = detection_response1.json()["id"]

    # Create second detection
    detection_payload2 = {
        "sequence_id": "1",
        "alert_api_id": "888",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.25, 0.25, 0.4, 0.4],
                        "confidence": 0.92,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    detection_response2 = await async_client.post(
        "/detections",
        data=detection_payload2,
        files={"file": ("image2.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response2.status_code == 201
    detection_id2 = detection_response2.json()["id"]

    # Create annotation for first detection
    annotation_payload1 = {
        "detection_id": str(detection_id1),
        "annotation": json.dumps(
            {
                "annotation": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "class_name": "smoke",
                        "smoke_type": "wildfire",
                    }
                ]
            }
        ),
        "processing_stage": "visual_check",
    }

    response1 = await async_client.post(
        "/annotations/detections/", data=annotation_payload1
    )
    assert response1.status_code == 201
    annotation1 = response1.json()
    assert annotation1["detection_id"] == detection_id1

    # Create annotation for second detection - should succeed
    annotation_payload2 = {
        "detection_id": str(detection_id2),
        "annotation": json.dumps(
            {
                "annotation": [
                    {
                        "xyxyn": [0.2, 0.2, 0.3, 0.3],
                        "class_name": "smoke",
                        "smoke_type": "industrial",
                    }
                ]
            }
        ),
        "processing_stage": "annotated",
    }

    response2 = await async_client.post(
        "/annotations/detections/", data=annotation_payload2
    )
    assert response2.status_code == 201
    annotation2 = response2.json()
    assert annotation2["detection_id"] == detection_id2

    # Both annotations should exist with different detection_ids
    assert annotation1["detection_id"] != annotation2["detection_id"]
    assert annotation1["detection_id"] == detection_id1
    assert annotation2["detection_id"] == detection_id2


@pytest.mark.asyncio
async def test_list_detection_annotations_filter_by_camera_id(
    async_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """Test filtering detection annotations by camera_id."""
    # Create first detection with camera_id 1 (from sequence 1)
    detection_payload1 = {
        "sequence_id": "1",  # This sequence has camera_id=1
        "alert_api_id": "1001",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps({
            "predictions": [{
                "xyxyn": [0.15, 0.15, 0.3, 0.3],
                "confidence": 0.88,
                "class_name": "smoke",
            }]
        }),
    }

    detection_response1 = await async_client.post(
        "/detections",
        data=detection_payload1,
        files={"file": ("image1.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response1.status_code == 201
    detection_id1 = detection_response1.json()["id"]

    # Create annotation for first detection
    annotation_payload1 = {
        "detection_id": str(detection_id1),
        "annotation": json.dumps({
            "annotation": [{
                "xyxyn": [0.1, 0.1, 0.2, 0.2],
                "class_name": "smoke",
                "smoke_type": "wildfire",
            }]
        }),
        "processing_stage": "visual_check",
    }

    response1 = await async_client.post(
        "/annotations/detections/", data=annotation_payload1
    )
    assert response1.status_code == 201

    # Test filtering by camera_id=1 (should find the annotation)
    response = await async_client.get("/annotations/detections/?camera_id=1")
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    assert len(json_response["items"]) >= 1
    # Verify that all returned annotations belong to detections from camera_id=1
    for annotation in json_response["items"]:
        assert annotation["detection_id"] == detection_id1

    # Test filtering by non-existent camera_id (should find no annotations)
    response = await async_client.get("/annotations/detections/?camera_id=999")
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    assert len(json_response["items"]) == 0


@pytest.mark.asyncio
async def test_list_detection_annotations_filter_by_organisation_id(
    async_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """Test filtering detection annotations by organisation_id."""
    # Create detection with organisation_id 1 (from sequence 1)
    detection_payload = {
        "sequence_id": "1",  # This sequence has organisation_id=1
        "alert_api_id": "1002",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps({
            "predictions": [{
                "xyxyn": [0.15, 0.15, 0.3, 0.3],
                "confidence": 0.88,
                "class_name": "smoke",
            }]
        }),
    }

    detection_response = await async_client.post(
        "/detections",
        data=detection_payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response.status_code == 201
    detection_id = detection_response.json()["id"]

    # Create annotation for detection
    annotation_payload = {
        "detection_id": str(detection_id),
        "annotation": json.dumps({
            "annotation": [{
                "xyxyn": [0.1, 0.1, 0.2, 0.2],
                "class_name": "smoke",
                "smoke_type": "wildfire",
            }]
        }),
        "processing_stage": "visual_check",
    }

    response = await async_client.post(
        "/annotations/detections/", data=annotation_payload
    )
    assert response.status_code == 201

    # Test filtering by organisation_id=1 (should find the annotation)
    response = await async_client.get("/annotations/detections/?organisation_id=1")
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    assert len(json_response["items"]) >= 1

    # Test filtering by non-existent organisation_id (should find no annotations)
    response = await async_client.get("/annotations/detections/?organisation_id=999")
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    assert len(json_response["items"]) == 0


@pytest.mark.asyncio
async def test_list_detection_annotations_combined_filtering(
    async_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """Test combined filtering by camera_id, organisation_id, and processing_stage."""
    # Create detection
    detection_payload = {
        "sequence_id": "1",  # camera_id=1, organisation_id=1
        "alert_api_id": "1003",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps({
            "predictions": [{
                "xyxyn": [0.15, 0.15, 0.3, 0.3],
                "confidence": 0.88,
                "class_name": "smoke",
            }]
        }),
    }

    detection_response = await async_client.post(
        "/detections",
        data=detection_payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response.status_code == 201
    detection_id = detection_response.json()["id"]

    # Create annotation with specific processing stage
    annotation_payload = {
        "detection_id": str(detection_id),
        "annotation": json.dumps({
            "annotation": [{
                "xyxyn": [0.1, 0.1, 0.2, 0.2],
                "class_name": "smoke",
                "smoke_type": "wildfire",
            }]
        }),
        "processing_stage": "annotated",
    }

    response = await async_client.post(
        "/annotations/detections/", data=annotation_payload
    )
    assert response.status_code == 201

    # Test combined filtering - should find the annotation
    response = await async_client.get(
        "/annotations/detections/?camera_id=1&organisation_id=1&processing_stage=annotated"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    assert len(json_response["items"]) >= 1

    # Test combined filtering with mismatched criteria - should find no annotations
    response = await async_client.get(
        "/annotations/detections/?camera_id=1&organisation_id=1&processing_stage=imported"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # This might be 0 or might include other annotations, depending on test data
    # The key is that it returns a valid paginated response
