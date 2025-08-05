from datetime import datetime

import pytest
from httpx import AsyncClient

from app import models

now = datetime.utcnow()


@pytest.mark.asyncio
async def test_create_sequence_annotation(async_client: AsyncClient, sequence_session):
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "gif_url_crop": "http://example.com/crop.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201, response.text
    result = response.json()
    assert "id" in result
    assert result["has_smoke"] is True  # Derived from annotation
    assert result["has_false_positives"] is False  # Derived from annotation
    assert result["sequence_id"] == payload["sequence_id"]


@pytest.mark.asyncio
async def test_get_sequence_annotation(async_client: AsyncClient):
    annotation_id = 1
    response = await async_client.get(f"/annotations/sequences/{annotation_id}")
    if response.status_code == 200:
        data = response.json()
        assert data["id"] == annotation_id
        assert "has_smoke" in data
    else:
        assert response.status_code in (404, 422)


@pytest.mark.asyncio
async def test_list_sequence_annotations(async_client: AsyncClient):
    response = await async_client.get("/annotations/sequences/")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_patch_sequence_annotation(async_client: AsyncClient):
    annotation_id = 1
    payload = {
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "gif_url_main": "http://updated.com/main.gif",
                    "gif_url_crop": "http://updated.com/crop.gif",
                    "false_positive_types": [models.FalsePositiveType.LENS_FLARE.value],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.2, 0.2, 0.3, 0.3]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
    }

    response = await async_client.patch(
        f"/annotations/sequences/{annotation_id}",
        json=payload,
    )
    if response.status_code == 200:
        updated = response.json()
        assert updated["has_false_positives"] is True  # Derived from annotation
        assert updated["has_smoke"] is False  # Derived from annotation
    else:
        assert response.status_code in (404, 422)


@pytest.mark.asyncio
async def test_patch_sequence_annotation_invalid_processing_stage(
    async_client: AsyncClient,
):
    annotation_id = 1
    payload = {"processing_stage": "invalid_stage_not_in_enum"}

    response = await async_client.patch(
        f"/annotations/sequences/{annotation_id}",
        json=payload,
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data
    assert any(
        "processing_stage" in str(error).lower() for error in error_data["detail"]
    )


@pytest.mark.asyncio
async def test_delete_sequence_annotation(async_client: AsyncClient, sequence_session):
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "gif_url_crop": "http://example.com/crop.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    create_resp = await async_client.post("/annotations/sequences/", json=payload)
    assert create_resp.status_code == 201
    annotation_id = create_resp.json()["id"]

    del_resp = await async_client.delete(f"/annotations/sequences/{annotation_id}")
    assert del_resp.status_code == 204

    get_resp = await async_client.get(f"/annotations/sequences/{annotation_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_create_sequence_annotation_invalid_bbox(
    async_client: AsyncClient, sequence_session
):
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": 1, "xyxyn": [0.3, 0.3, 0.2, 0.2]}
                    ],  # x1 > x2, y1 > y2
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_sequence_annotation_invalid_false_positive_type(
    async_client: AsyncClient, sequence_session
):
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "false_positive_types": ["invalid_type_not_in_enum"],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_sequence_annotation_unique_constraint_violation(
    async_client: AsyncClient, sequence_session
):
    """Test that creating multiple annotations for the same sequence fails due to unique constraint."""
    payload1 = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main1.gif",
                    "gif_url_crop": "http://example.com/crop1.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    # First annotation should be created successfully
    response1 = await async_client.post("/annotations/sequences/", json=payload1)
    assert response1.status_code == 201
    annotation1 = response1.json()
    assert annotation1["sequence_id"] == 1

    # Try to create second annotation for same sequence - should fail
    payload2 = {
        "sequence_id": 1,  # Same sequence_id
        "has_missed_smoke": True,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "gif_url_main": "http://example.com/main2.gif",
                    "gif_url_crop": "http://example.com/crop2.gif",
                    "false_positive_types": [models.FalsePositiveType.LENS_FLARE.value],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.2, 0.2, 0.3, 0.3]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    # Try to create second annotation for same sequence - should fail with 409 Conflict
    response2 = await async_client.post("/annotations/sequences/", json=payload2)
    assert response2.status_code == 409  # Conflict due to unique constraint violation

    # Verify first annotation still exists and is accessible
    annotation1_id = annotation1["id"]
    get_response = await async_client.get(f"/annotations/sequences/{annotation1_id}")
    assert get_response.status_code == 200
    retrieved_annotation = get_response.json()
    assert retrieved_annotation["sequence_id"] == 1


@pytest.mark.asyncio
async def test_create_sequence_annotation_different_sequences_allowed(
    async_client: AsyncClient, sequence_session
):
    """Test that creating annotations for different sequences succeeds."""
    # This test assumes we have at least two sequences available (sequence_id 1 exists from sequence_session)
    # We'll use sequence_id 1 for the first annotation and create a different sequence for the second

    # Create annotation for sequence 1
    payload1 = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/seq1.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response1 = await async_client.post("/annotations/sequences/", json=payload1)
    assert response1.status_code == 201
    annotation1 = response1.json()
    assert annotation1["sequence_id"] == 1

    # First, create a new sequence for the second annotation
    sequence_payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "999",
        "camera_name": "test_seq_annotation",
        "camera_id": "999",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "created_at": datetime.utcnow().isoformat(),
        "recorded_at": datetime.utcnow().isoformat(),
        "last_seen_at": datetime.utcnow().isoformat(),
    }

    sequence_response = await async_client.post("/sequences", data=sequence_payload)
    assert sequence_response.status_code == 201
    sequence2_id = sequence_response.json()["id"]

    # Create annotation for the new sequence
    payload2 = {
        "sequence_id": sequence2_id,
        "has_missed_smoke": True,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "gif_url_main": "http://example.com/seq2.gif",
                    "false_positive_types": [models.FalsePositiveType.LENS_FLARE.value],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.2, 0.2, 0.3, 0.3]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response2 = await async_client.post("/annotations/sequences/", json=payload2)
    assert response2.status_code == 201
    annotation2 = response2.json()
    assert annotation2["sequence_id"] == sequence2_id

    # Both annotations should exist with different sequence_ids
    assert annotation1["sequence_id"] != annotation2["sequence_id"]
    assert annotation1["sequence_id"] == 1
    assert annotation2["sequence_id"] == sequence2_id
