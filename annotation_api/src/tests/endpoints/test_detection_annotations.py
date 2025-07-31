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
    assert isinstance(response.json(), list)


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
        assert json_response["annotation"]["annotation"][0]["smoke_type"] == "industrial"
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
