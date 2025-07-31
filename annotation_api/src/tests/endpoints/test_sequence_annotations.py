import json
from datetime import datetime

import pytest
from httpx import AsyncClient

from app import models

now = datetime.utcnow()


@pytest.mark.asyncio
async def test_create_sequence_annotation(async_client: AsyncClient, sequence_session):
    payload = {
        "sequence_id": "1",
        "has_smoke": "true",
        "has_false_positives": "false",
        "has_missed_smoke": "false",
        "annotation": json.dumps(
            {
                "sequences_bbox": [
                    {
                        "is_smoke": True,
                        "gif_url_main": "http://example.com/main.gif",
                        "gif_url_crop": "http://example.com/crop.gif",
                        "false_positive_types": [],
                        "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                    }
                ]
            }
        ),
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "false_positive_types": "[]",
    }

    response = await async_client.post("/annotations/sequences/", data=payload)
    assert response.status_code == 201, response.text
    result = response.json()
    assert "id" in result
    assert result["has_smoke"] is True
    assert result["sequence_id"] == int(payload["sequence_id"])


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
        "has_smoke": True,
        "has_false_positives": True,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "gif_url_main": "http://updated.com/main.gif",
                    "gif_url_crop": "http://updated.com/crop.gif",
                    "false_positive_types": ["lens_flare"],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.2, 0.2, 0.3, 0.3]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "false_positive_types": '["lens_flare"]',
        "updated_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.patch(
        f"/annotations/sequences/{annotation_id}",
        json=payload,
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["has_false_positives"] is True


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
        "sequence_id": "1",
        "has_smoke": "true",
        "has_false_positives": "false",
        "has_missed_smoke": "false",
        "annotation": json.dumps(
            {
                "sequences_bbox": [
                    {
                        "is_smoke": True,
                        "gif_url_main": "http://example.com/main.gif",
                        "gif_url_crop": "http://example.com/crop.gif",
                        "false_positive_types": [],
                        "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                    }
                ]
            }
        ),
        "processing_stage": "imported",
        "false_positive_types": "[]",
    }

    create_resp = await async_client.post("/annotations/sequences/", data=payload)
    assert create_resp.status_code == 201
    annotation_id = create_resp.json()["id"]

    del_resp = await async_client.delete(f"/annotations/sequences/{annotation_id}")
    assert del_resp.status_code == 204

    get_resp = await async_client.get(f"/annotations/sequences/{annotation_id}")
    assert get_resp.status_code == 404
