from datetime import datetime

import pytest
from httpx import AsyncClient

from app import models

now = datetime.utcnow()


@pytest.mark.asyncio
async def test_create_sequence_annotation(
    async_client: AsyncClient, sequence_session, detection_session
):
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
    json_response = response.json()
    assert isinstance(json_response, dict)
    assert "items" in json_response
    assert "page" in json_response
    assert "pages" in json_response
    assert "size" in json_response
    assert isinstance(json_response["items"], list)


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
async def test_delete_sequence_annotation(
    async_client: AsyncClient, sequence_session, detection_session
):
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
async def test_generate_sequence_annotation_gifs_success(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test successful GIF generation for a sequence annotation."""
    # First create a sequence annotation with bboxes referencing existing detections
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": None,
                    "gif_url_crop": None,
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": 1, "xyxyn": [0.1, 0.1, 0.4, 0.4]},
                        {"detection_id": 2, "xyxyn": [0.2, 0.2, 0.5, 0.5]},
                    ],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    # Create the annotation
    create_resp = await async_client.post("/annotations/sequences/", json=payload)
    assert create_resp.status_code == 201
    annotation_id = create_resp.json()["id"]

    # Call the GIF generation endpoint
    gif_resp = await async_client.post(
        f"/annotations/sequences/{annotation_id}/generate-gifs"
    )
    assert gif_resp.status_code == 200

    # Verify response structure
    gif_result = gif_resp.json()
    assert gif_result["annotation_id"] == annotation_id
    assert gif_result["sequence_id"] == 1
    assert "gif_count" in gif_result
    assert "total_bboxes" in gif_result
    assert "generated_at" in gif_result
    assert gif_result["total_bboxes"] == 1  # One sequence_bbox

    # Verify the annotation was updated with GIF URLs
    updated_resp = await async_client.get(f"/annotations/sequences/{annotation_id}")
    assert updated_resp.status_code == 200
    updated_annotation = updated_resp.json()

    # Check that GIF URLs were added to the annotation
    sequences_bbox = updated_annotation["annotation"]["sequences_bbox"]
    assert len(sequences_bbox) == 1
    bbox = sequences_bbox[0]

    # Both main and crop GIFs should be generated
    assert bbox["gif_url_main"] is not None
    assert bbox["gif_url_crop"] is not None
    assert bbox["gif_url_main"].startswith("http")
    assert bbox["gif_url_crop"].startswith("http")
    assert "main_" in bbox["gif_url_main"]
    assert "crop_" in bbox["gif_url_crop"]

    # Verify GIF count matches what was actually generated
    generated_gifs = sum(
        1 for b in sequences_bbox if b.get("gif_url_main") or b.get("gif_url_crop")
    )
    assert gif_result["gif_count"] == generated_gifs


@pytest.mark.asyncio
async def test_generate_sequence_annotation_gifs_annotation_not_found(
    async_client: AsyncClient,
):
    """Test GIF generation for non-existent annotation returns 404."""
    non_existent_id = 99999

    gif_resp = await async_client.post(
        f"/annotations/sequences/{non_existent_id}/generate-gifs"
    )
    assert gif_resp.status_code == 404

    error_data = gif_resp.json()
    assert "detail" in error_data
    assert "not found" in error_data["detail"].lower()


@pytest.mark.asyncio
async def test_generate_sequence_annotation_gifs_no_bboxes(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test GIF generation for annotation with no sequence bboxes returns 422."""
    # Create annotation with empty sequences_bbox
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {"sequences_bbox": []},  # Empty bboxes
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    create_resp = await async_client.post("/annotations/sequences/", json=payload)
    assert create_resp.status_code == 201
    annotation_id = create_resp.json()["id"]

    # Try to generate GIFs - should fail with 422
    gif_resp = await async_client.post(
        f"/annotations/sequences/{annotation_id}/generate-gifs"
    )
    assert gif_resp.status_code == 422

    error_data = gif_resp.json()
    assert "detail" in error_data
    assert "sequence bounding boxes" in error_data["detail"].lower()


@pytest.mark.asyncio
async def test_generate_sequence_annotation_gifs_missing_images_from_s3(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test GIF generation when detection images are missing from S3 storage."""
    # Create annotation for sequence 1 but delete the detection images from S3 first
    # This simulates the case where detections exist but images are missing

    # First delete detection images from S3 to simulate missing files
    from app.services.storage import s3_service

    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
    try:
        bucket.delete_file("seq1_img1.jpg")  # Detection ID 1
        bucket.delete_file("seq1_img2.jpg")  # Detection ID 2
    except Exception:
        pass  # Files might not exist

    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.4, 0.4]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    create_resp = await async_client.post("/annotations/sequences/", json=payload)
    assert create_resp.status_code == 201
    annotation_id = create_resp.json()["id"]

    # Try to generate GIFs - should succeed but with gif_count=0 due to missing images
    gif_resp = await async_client.post(
        f"/annotations/sequences/{annotation_id}/generate-gifs"
    )
    assert gif_resp.status_code == 200  # Service handles missing images gracefully

    gif_result = gif_resp.json()
    assert gif_result["annotation_id"] == annotation_id
    assert gif_result["sequence_id"] == 1
    assert gif_result["gif_count"] == 0  # No GIFs generated due to missing images
    assert gif_result["total_bboxes"] == 1

    # Verify annotation was updated but with no GIF URLs
    updated_resp = await async_client.get(f"/annotations/sequences/{annotation_id}")
    assert updated_resp.status_code == 200
    updated_annotation = updated_resp.json()

    sequences_bbox = updated_annotation["annotation"]["sequences_bbox"]
    bbox = sequences_bbox[0]
    assert bbox["gif_url_main"] is None  # No GIF generated
    assert bbox["gif_url_crop"] is None  # No GIF generated


@pytest.mark.asyncio
async def test_delete_sequence_annotation_does_not_cascade_sequence(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test that deleting a sequence annotation does NOT cascade delete the parent sequence."""
    # 1. Verify sequence exists (sequence_id = 1 from fixture)
    sequence_resp = await async_client.get("/sequences/1")
    assert sequence_resp.status_code == 200
    initial_sequence_data = sequence_resp.json()

    # 2. Create annotation for sequence
    annotation_payload = {
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

    create_resp = await async_client.post(
        "/annotations/sequences/", json=annotation_payload
    )
    assert create_resp.status_code == 201
    annotation_id = create_resp.json()["id"]

    # 3. Verify annotation was created
    annotation_get_resp = await async_client.get(
        f"/annotations/sequences/{annotation_id}"
    )
    assert annotation_get_resp.status_code == 200

    # 4. Delete annotation
    del_resp = await async_client.delete(f"/annotations/sequences/{annotation_id}")
    assert del_resp.status_code == 204

    # 5. Verify annotation is deleted
    annotation_get_resp_after = await async_client.get(
        f"/annotations/sequences/{annotation_id}"
    )
    assert annotation_get_resp_after.status_code == 404

    # 6. CRITICAL: Verify sequence still exists and was NOT cascade deleted
    sequence_get_resp_after = await async_client.get("/sequences/1")
    assert sequence_get_resp_after.status_code == 200
    final_sequence_data = sequence_get_resp_after.json()

    # 7. Verify sequence data is unchanged
    assert final_sequence_data["id"] == initial_sequence_data["id"]
    assert final_sequence_data["source_api"] == initial_sequence_data["source_api"]
    assert final_sequence_data["camera_name"] == initial_sequence_data["camera_name"]


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
    async_client: AsyncClient, sequence_session, detection_session
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

    # Note: After an integrity error, the database session becomes unusable for further operations
    # The important test here is that the second request correctly returns 409 Conflict


@pytest.mark.asyncio
async def test_create_sequence_annotation_different_sequences_allowed(
    async_client: AsyncClient, sequence_session, detection_session
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


@pytest.mark.asyncio
async def test_list_sequence_annotations_filter_by_has_smoke(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test filtering sequence annotations by has_smoke."""
    # Create annotation with has_smoke=True
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,  # This will set has_smoke to True
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]

    # Test filtering by has_smoke=true (should find the annotation)
    response = await async_client.get("/annotations/sequences/?has_smoke=true")
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should find at least one annotation with has_smoke=true
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            assert annotation["has_smoke"] is True
            break
    assert found_annotation, "Should find annotation with has_smoke=true"

    # Test filtering by has_smoke=false (should not find this annotation)
    response = await async_client.get("/annotations/sequences/?has_smoke=false")
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should not find our annotation since it has has_smoke=true
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            break
    assert not found_annotation, "Should not find annotation with has_smoke=true when filtering for has_smoke=false"


@pytest.mark.asyncio
async def test_list_sequence_annotations_filter_by_has_false_positives(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test filtering sequence annotations by has_false_positives."""
    # Create annotation with has_false_positives=True
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [
                        models.FalsePositiveType.LENS_FLARE.value
                    ],  # This will set has_false_positives to True
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]
    annotation_data = response.json()
    assert annotation_data["has_false_positives"] is True

    # Test filtering by has_false_positives=true (should find the annotation)
    response = await async_client.get(
        "/annotations/sequences/?has_false_positives=true"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should find our annotation
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            assert annotation["has_false_positives"] is True
            break
    assert found_annotation, "Should find annotation with has_false_positives=true"


@pytest.mark.asyncio
async def test_list_sequence_annotations_filter_by_false_positive_type(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test filtering sequence annotations by specific false_positive_type using JSON search."""
    # Create annotation with specific false positive type
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [
                        models.FalsePositiveType.ANTENNA.value,
                        models.FalsePositiveType.BUILDING.value,
                    ],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]

    # Test filtering by false_positive_type="antenna" (should find the annotation)
    response = await async_client.get(
        "/annotations/sequences/?false_positive_type=antenna"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should find our annotation since it contains "antenna" in false_positive_types
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            # Verify the false_positive_types contains "antenna"
            import json

            fp_types = json.loads(annotation["false_positive_types"])
            assert "antenna" in fp_types
            break
    assert (
        found_annotation
    ), "Should find annotation containing false_positive_type 'antenna'"

    # Test filtering by false_positive_type="building" (should also find the annotation)
    response = await async_client.get(
        "/annotations/sequences/?false_positive_type=building"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should find our annotation since it contains "building" in false_positive_types
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            break
    assert (
        found_annotation
    ), "Should find annotation containing false_positive_type 'building'"

    # Test filtering by false_positive_type="cliff" (should not find the annotation)
    response = await async_client.get(
        "/annotations/sequences/?false_positive_type=cliff"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should not find our annotation since it doesn't contain "cliff"
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            break
    assert (
        not found_annotation
    ), "Should not find annotation when filtering for false_positive_type 'cliff'"


@pytest.mark.asyncio
async def test_list_sequence_annotations_filter_by_processing_stage(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test filtering sequence annotations by processing_stage."""
    # Create annotation with specific processing stage
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]

    # Test filtering by processing_stage="annotated" (should find the annotation)
    response = await async_client.get(
        "/annotations/sequences/?processing_stage=annotated"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should find our annotation
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            assert annotation["processing_stage"] == "annotated"
            break
    assert found_annotation, "Should find annotation with processing_stage='annotated'"

    # Test filtering by processing_stage="imported" (should not find this annotation)
    response = await async_client.get(
        "/annotations/sequences/?processing_stage=imported"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should not find our annotation since it has processing_stage="annotated"
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            break
    assert not found_annotation, "Should not find annotation with processing_stage='annotated' when filtering for 'imported'"


@pytest.mark.asyncio
async def test_list_sequence_annotations_order_by_created_at(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test ordering sequence annotations by created_at."""
    # Create two annotations with different created_at times
    import time
    from datetime import timedelta

    base_time = datetime.utcnow()

    # First annotation (older)
    payload1 = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main1.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": (base_time - timedelta(minutes=10)).isoformat(),
    }

    response1 = await async_client.post("/annotations/sequences/", json=payload1)
    assert response1.status_code == 201
    annotation1_id = response1.json()["id"]

    # Give a small delay to ensure different created_at times
    time.sleep(0.1)

    # Create a new sequence for the second annotation to avoid unique constraint
    sequence_payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "888",
        "camera_name": "test_ordering",
        "camera_id": "888",
        "organisation_name": "test_org_order",
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

    # Second annotation (newer)
    payload2 = {
        "sequence_id": sequence2_id,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main2.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": (base_time - timedelta(minutes=5)).isoformat(),
    }

    response2 = await async_client.post("/annotations/sequences/", json=payload2)
    assert response2.status_code == 201
    annotation2_id = response2.json()["id"]

    # Test ordering by created_at desc (default)
    response = await async_client.get(
        "/annotations/sequences/?order_by=created_at&order_direction=desc"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    items = json_response["items"]

    # Find our annotations in the result
    annotation1_pos = None
    annotation2_pos = None
    for i, annotation in enumerate(items):
        if annotation["id"] == annotation1_id:
            annotation1_pos = i
        elif annotation["id"] == annotation2_id:
            annotation2_pos = i

    # Both annotations should be found
    assert annotation1_pos is not None, "Should find first annotation"
    assert annotation2_pos is not None, "Should find second annotation"
    # annotation2 (newer) should come before annotation1 (older) in desc order
    assert (
        annotation2_pos < annotation1_pos
    ), "Newer annotation should come first in desc order"

    # Test ordering by created_at asc
    response = await async_client.get(
        "/annotations/sequences/?order_by=created_at&order_direction=asc"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    items = json_response["items"]

    # Find our annotations in the result
    annotation1_pos = None
    annotation2_pos = None
    for i, annotation in enumerate(items):
        if annotation["id"] == annotation1_id:
            annotation1_pos = i
        elif annotation["id"] == annotation2_id:
            annotation2_pos = i

    # Both annotations should be found
    assert annotation1_pos is not None, "Should find first annotation"
    assert annotation2_pos is not None, "Should find second annotation"
    # annotation1 (older) should come before annotation2 (newer) in asc order
    assert (
        annotation1_pos < annotation2_pos
    ), "Older annotation should come first in asc order"


@pytest.mark.asyncio
async def test_list_sequence_annotations_combined_filtering(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test combined filtering by multiple parameters."""
    # Create annotation with specific characteristics
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": True,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [models.FalsePositiveType.ANTENNA.value],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]
    annotation_data = response.json()

    # Verify the annotation has the expected derived fields
    assert annotation_data["has_smoke"] is True
    assert annotation_data["has_false_positives"] is True
    assert annotation_data["has_missed_smoke"] is True

    # Test combined filtering - should find the annotation
    response = await async_client.get(
        "/annotations/sequences/?has_smoke=true&has_false_positives=true&has_missed_smoke=true&processing_stage=annotated"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should find our annotation since it matches all criteria
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            assert annotation["has_smoke"] is True
            assert annotation["has_false_positives"] is True
            assert annotation["has_missed_smoke"] is True
            assert annotation["processing_stage"] == "annotated"
            break
    assert found_annotation, "Should find annotation matching all filtering criteria"

    # Test combined filtering with one mismatched criterion - should not find the annotation
    response = await async_client.get(
        "/annotations/sequences/?has_smoke=true&has_false_positives=true&has_missed_smoke=false&processing_stage=annotated"
    )
    assert response.status_code == 200
    json_response = response.json()
    assert "items" in json_response
    # Should not find our annotation since has_missed_smoke doesn't match
    found_annotation = False
    for annotation in json_response["items"]:
        if annotation["id"] == annotation_id:
            found_annotation = True
            break
    assert (
        not found_annotation
    ), "Should not find annotation when one filter criterion doesn't match"


@pytest.mark.asyncio
async def test_create_sequence_annotation_invalid_detection_id(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test that creating sequence annotation with non-existent detection_id fails with 422."""
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": 99999, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ],  # Non-existent detection_id
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
    assert "99999" in str(error_data["detail"])
    assert "do not exist" in str(error_data["detail"])


@pytest.mark.asyncio
async def test_create_sequence_annotation_mixed_valid_invalid_detection_ids(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test that creating sequence annotation with mix of valid and invalid detection_ids fails with 422."""
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [],
                    "bboxes": [
                        {
                            "detection_id": 1,
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        },  # Valid detection_id
                        {
                            "detection_id": 88888,
                            "xyxyn": [0.3, 0.3, 0.4, 0.4],
                        },  # Invalid detection_id
                        {
                            "detection_id": 77777,
                            "xyxyn": [0.5, 0.5, 0.6, 0.6],
                        },  # Invalid detection_id
                    ],
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
    error_detail = str(error_data["detail"])
    assert "77777" in error_detail
    assert "88888" in error_detail
    assert "do not exist" in error_detail


@pytest.mark.asyncio
async def test_create_sequence_annotation_empty_bboxes(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test that creating sequence annotation with empty bboxes succeeds (no detection_ids to validate)."""
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [models.FalsePositiveType.LENS_FLARE.value],
                    "bboxes": [],  # Empty bboxes - no detection_ids to validate
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    response = await async_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    result = response.json()
    assert "id" in result
    assert result["has_smoke"] is False
    assert result["has_false_positives"] is True  # Derived from false_positive_types


@pytest.mark.asyncio
async def test_update_sequence_annotation_invalid_detection_id(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test that updating sequence annotation with non-existent detection_id fails with 422."""
    # First create a valid annotation
    create_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    create_response = await async_client.post(
        "/annotations/sequences/", json=create_payload
    )
    assert create_response.status_code == 201
    annotation_id = create_response.json()["id"]

    # Now try to update with invalid detection_id
    update_payload = {
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "gif_url_main": "http://updated.com/main.gif",
                    "false_positive_types": [models.FalsePositiveType.ANTENNA.value],
                    "bboxes": [
                        {"detection_id": 55555, "xyxyn": [0.2, 0.2, 0.3, 0.3]}
                    ],  # Non-existent detection_id
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
    }

    response = await async_client.patch(
        f"/annotations/sequences/{annotation_id}",
        json=update_payload,
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data
    assert "55555" in str(error_data["detail"])
    assert "do not exist" in str(error_data["detail"])


@pytest.mark.asyncio
async def test_update_sequence_annotation_without_annotation_field(
    async_client: AsyncClient, sequence_session, detection_session
):
    """Test that updating sequence annotation without changing annotation field works (no validation needed)."""
    # First create a valid annotation
    create_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.utcnow().isoformat(),
    }

    create_response = await async_client.post(
        "/annotations/sequences/", json=create_payload
    )
    assert create_response.status_code == 201
    annotation_id = create_response.json()["id"]

    # Update only processing_stage (no annotation field)
    update_payload = {
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "has_missed_smoke": True,
    }

    response = await async_client.patch(
        f"/annotations/sequences/{annotation_id}",
        json=update_payload,
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["processing_stage"] == "annotated"
    assert updated["has_missed_smoke"] is True
    # Original annotation should remain unchanged
    assert updated["has_smoke"] is True
    assert updated["has_false_positives"] is False
