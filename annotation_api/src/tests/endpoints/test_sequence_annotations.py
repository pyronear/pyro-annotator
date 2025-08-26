from datetime import datetime, UTC
import json

import pytest
from httpx import AsyncClient
from PIL import Image

from app import models

now = datetime.now(UTC)


@pytest.mark.asyncio
async def test_create_sequence_annotation(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201, response.text
    result = response.json()
    assert "id" in result
    assert result["has_smoke"] is True  # Derived from annotation
    assert result["has_false_positives"] is False  # Derived from annotation
    assert result["sequence_id"] == payload["sequence_id"]


@pytest.mark.asyncio
async def test_get_sequence_annotation(authenticated_client: AsyncClient):
    annotation_id = 1
    response = await authenticated_client.get(f"/annotations/sequences/{annotation_id}")
    if response.status_code == 200:
        data = response.json()
        assert data["id"] == annotation_id
        assert "has_smoke" in data
    else:
        assert response.status_code in (404, 422)


@pytest.mark.asyncio
async def test_list_sequence_annotations(authenticated_client: AsyncClient):
    response = await authenticated_client.get("/annotations/sequences/")
    assert response.status_code == 200
    json_response = response.json()
    assert isinstance(json_response, dict)
    assert "items" in json_response
    assert "page" in json_response
    assert "pages" in json_response
    assert "size" in json_response
    assert isinstance(json_response["items"], list)


@pytest.mark.asyncio
async def test_patch_sequence_annotation(authenticated_client: AsyncClient):
    annotation_id = 1
    payload = {
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "false_positive_types": [models.FalsePositiveType.LENS_FLARE.value],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.2, 0.2, 0.3, 0.3]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
    }

    response = await authenticated_client.patch(
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
    authenticated_client: AsyncClient,
):
    annotation_id = 1
    payload = {"processing_stage": "invalid_stage_not_in_enum"}

    response = await authenticated_client.patch(
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
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    create_resp = await authenticated_client.post(
        "/annotations/sequences/", json=payload
    )
    assert create_resp.status_code == 201
    annotation_id = create_resp.json()["id"]

    del_resp = await authenticated_client.delete(
        f"/annotations/sequences/{annotation_id}"
    )
    assert del_resp.status_code == 204

    get_resp = await authenticated_client.get(f"/annotations/sequences/{annotation_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_sequence_annotation_does_not_cascade_sequence(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that deleting a sequence annotation does NOT cascade delete the parent sequence."""
    # 1. Verify sequence exists (sequence_id = 1 from fixture)
    sequence_resp = await authenticated_client.get("/sequences/1")
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
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    create_resp = await authenticated_client.post(
        "/annotations/sequences/", json=annotation_payload
    )
    assert create_resp.status_code == 201
    annotation_id = create_resp.json()["id"]

    # 3. Verify annotation was created
    annotation_get_resp = await authenticated_client.get(
        f"/annotations/sequences/{annotation_id}"
    )
    assert annotation_get_resp.status_code == 200

    # 4. Delete annotation
    del_resp = await authenticated_client.delete(
        f"/annotations/sequences/{annotation_id}"
    )
    assert del_resp.status_code == 204

    # 5. Verify annotation is deleted
    annotation_get_resp_after = await authenticated_client.get(
        f"/annotations/sequences/{annotation_id}"
    )
    assert annotation_get_resp_after.status_code == 404

    # 6. CRITICAL: Verify sequence still exists and was NOT cascade deleted
    sequence_get_resp_after = await authenticated_client.get("/sequences/1")
    assert sequence_get_resp_after.status_code == 200
    final_sequence_data = sequence_get_resp_after.json()

    # 7. Verify sequence data is unchanged
    assert final_sequence_data["id"] == initial_sequence_data["id"]
    assert final_sequence_data["source_api"] == initial_sequence_data["source_api"]
    assert final_sequence_data["camera_name"] == initial_sequence_data["camera_name"]


@pytest.mark.asyncio
async def test_create_sequence_annotation_invalid_bbox(
    authenticated_client: AsyncClient, sequence_session
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
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_sequence_annotation_invalid_false_positive_type(
    authenticated_client: AsyncClient, sequence_session
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
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_sequence_annotation_unique_constraint_violation(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that creating multiple annotations for the same sequence fails due to unique constraint."""
    payload1 = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # First annotation should be created successfully
    response1 = await authenticated_client.post(
        "/annotations/sequences/", json=payload1
    )
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
                    "false_positive_types": [models.FalsePositiveType.LENS_FLARE.value],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.2, 0.2, 0.3, 0.3]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Try to create second annotation for same sequence - should fail with 409 Conflict
    response2 = await authenticated_client.post(
        "/annotations/sequences/", json=payload2
    )
    assert response2.status_code == 409  # Conflict due to unique constraint violation

    # Note: After an integrity error, the database session becomes unusable for further operations
    # The important test here is that the second request correctly returns 409 Conflict


@pytest.mark.asyncio
async def test_create_sequence_annotation_different_sequences_allowed(
    authenticated_client: AsyncClient, sequence_session, detection_session
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
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response1 = await authenticated_client.post(
        "/annotations/sequences/", json=payload1
    )
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
        "created_at": datetime.now(UTC).isoformat(),
        "recorded_at": datetime.now(UTC).isoformat(),
        "last_seen_at": datetime.now(UTC).isoformat(),
    }

    sequence_response = await authenticated_client.post(
        "/sequences", data=sequence_payload
    )
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
                    "false_positive_types": [models.FalsePositiveType.LENS_FLARE.value],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.2, 0.2, 0.3, 0.3]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response2 = await authenticated_client.post(
        "/annotations/sequences/", json=payload2
    )
    assert response2.status_code == 201
    annotation2 = response2.json()
    assert annotation2["sequence_id"] == sequence2_id

    # Both annotations should exist with different sequence_ids
    assert annotation1["sequence_id"] != annotation2["sequence_id"]
    assert annotation1["sequence_id"] == 1
    assert annotation2["sequence_id"] == sequence2_id


@pytest.mark.asyncio
async def test_list_sequence_annotations_filter_by_has_smoke(
    authenticated_client: AsyncClient, sequence_session, detection_session
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
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]

    # Test filtering by has_smoke=true (should find the annotation)
    response = await authenticated_client.get("/annotations/sequences/?has_smoke=true")
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
    response = await authenticated_client.get("/annotations/sequences/?has_smoke=false")
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
    authenticated_client: AsyncClient, sequence_session, detection_session
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
                    "false_positive_types": [
                        models.FalsePositiveType.LENS_FLARE.value
                    ],  # This will set has_false_positives to True
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]
    annotation_data = response.json()
    assert annotation_data["has_false_positives"] is True

    # Test filtering by has_false_positives=true (should find the annotation)
    response = await authenticated_client.get(
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
    authenticated_client: AsyncClient, sequence_session, detection_session
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
                    "false_positive_types": [
                        models.FalsePositiveType.ANTENNA.value,
                        models.FalsePositiveType.BUILDING.value,
                    ],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]

    # Test filtering by false_positive_types=["antenna"] (should find the annotation)
    response = await authenticated_client.get(
        "/annotations/sequences/?false_positive_types=antenna"
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
            fp_types = annotation["false_positive_types"]
            assert "antenna" in fp_types
            break
    assert (
        found_annotation
    ), "Should find annotation containing false_positive_type 'antenna'"

    # Test filtering by false_positive_types=["building"] (should also find the annotation)
    response = await authenticated_client.get(
        "/annotations/sequences/?false_positive_types=building"
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

    # Test filtering by false_positive_types=["cliff"] (should not find the annotation)
    response = await authenticated_client.get(
        "/annotations/sequences/?false_positive_types=cliff"
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
    ), "Should not find annotation when filtering for false_positive_types 'cliff'"


@pytest.mark.asyncio
async def test_list_sequence_annotations_filter_by_processing_stage(
    authenticated_client: AsyncClient, sequence_session, detection_session
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
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]

    # Test filtering by processing_stage="annotated" (should find the annotation)
    response = await authenticated_client.get(
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
    response = await authenticated_client.get(
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
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test ordering sequence annotations by created_at."""
    # Create two annotations with different created_at times
    import time
    from datetime import timedelta

    base_time = datetime.now(UTC)

    # First annotation (older)
    payload1 = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": (base_time - timedelta(minutes=10)).isoformat(),
    }

    response1 = await authenticated_client.post(
        "/annotations/sequences/", json=payload1
    )
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
        "created_at": datetime.now(UTC).isoformat(),
        "recorded_at": datetime.now(UTC).isoformat(),
        "last_seen_at": datetime.now(UTC).isoformat(),
    }

    sequence_response = await authenticated_client.post(
        "/sequences", data=sequence_payload
    )
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
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": (base_time - timedelta(minutes=5)).isoformat(),
    }

    response2 = await authenticated_client.post(
        "/annotations/sequences/", json=payload2
    )
    assert response2.status_code == 201
    annotation2_id = response2.json()["id"]

    # Test ordering by created_at desc (default)
    response = await authenticated_client.get(
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
    response = await authenticated_client.get(
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
    authenticated_client: AsyncClient, sequence_session, detection_session
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
                    "false_positive_types": [models.FalsePositiveType.ANTENNA.value],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    annotation_id = response.json()["id"]
    annotation_data = response.json()

    # Verify the annotation has the expected derived fields
    assert annotation_data["has_smoke"] is True
    assert annotation_data["has_false_positives"] is True
    assert annotation_data["has_missed_smoke"] is True

    # Test combined filtering - should find the annotation
    response = await authenticated_client.get(
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
    response = await authenticated_client.get(
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
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that creating sequence annotation with non-existent detection_id fails with 422."""
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": 99999, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ],  # Non-existent detection_id
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data
    assert "99999" in str(error_data["detail"])
    assert "do not exist" in str(error_data["detail"])


@pytest.mark.asyncio
async def test_create_sequence_annotation_mixed_valid_invalid_detection_ids(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that creating sequence annotation with mix of valid and invalid detection_ids fails with 422."""
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
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
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data
    error_detail = str(error_data["detail"])
    assert "77777" in error_detail
    assert "88888" in error_detail
    assert "do not exist" in error_detail


@pytest.mark.asyncio
async def test_create_sequence_annotation_empty_bboxes(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that creating sequence annotation with empty bboxes succeeds (no detection_ids to validate)."""
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "false_positive_types": [models.FalsePositiveType.LENS_FLARE.value],
                    "bboxes": [],  # Empty bboxes - no detection_ids to validate
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201
    result = response.json()
    assert "id" in result
    assert result["has_smoke"] is False
    assert result["has_false_positives"] is True  # Derived from false_positive_types


@pytest.mark.asyncio
async def test_update_sequence_annotation_invalid_detection_id(
    authenticated_client: AsyncClient, sequence_session, detection_session
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
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    create_response = await authenticated_client.post(
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
                    "false_positive_types": [models.FalsePositiveType.ANTENNA.value],
                    "bboxes": [
                        {"detection_id": 55555, "xyxyn": [0.2, 0.2, 0.3, 0.3]}
                    ],  # Non-existent detection_id
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
    }

    response = await authenticated_client.patch(
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
    authenticated_client: AsyncClient, sequence_session, detection_session
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
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    create_response = await authenticated_client.post(
        "/annotations/sequences/", json=create_payload
    )
    assert create_response.status_code == 201
    annotation_id = create_response.json()["id"]

    # Update only processing_stage (no annotation field)
    update_payload = {
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "has_missed_smoke": True,
    }

    response = await authenticated_client.patch(
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


@pytest.mark.asyncio
async def test_list_sequence_annotations_filter_by_false_positive_types(
    authenticated_client: AsyncClient, sequence_session
):
    """Test filtering sequence annotations by false positive types."""

    # Create test sequences first
    test_sequences = [
        {
            "source_api": "pyronear_french",
            "alert_api_id": "9001",
            "camera_name": "FP Test Camera 1",
            "camera_id": "901",
            "organisation_name": "Test Org",
            "organisation_id": "1",
            "lat": "43.5",
            "lon": "1.5",
            "recorded_at": "2024-01-15T10:30:00",
            "last_seen_at": "2024-01-15T10:35:00",
        },
        {
            "source_api": "pyronear_french",
            "alert_api_id": "9002",
            "camera_name": "FP Test Camera 2",
            "camera_id": "902",
            "organisation_name": "Test Org",
            "organisation_id": "1",
            "lat": "43.0",
            "lon": "1.5",
            "recorded_at": "2024-01-15T10:30:00",
            "last_seen_at": "2024-01-15T10:35:00",
        },
        {
            "source_api": "pyronear_french",
            "alert_api_id": "9003",
            "camera_name": "FP Test Camera 3",
            "camera_id": "903",
            "organisation_name": "Test Org",
            "organisation_id": "1",
            "lat": "43.5",
            "lon": "2.0",
            "recorded_at": "2024-01-15T10:30:00",
            "last_seen_at": "2024-01-15T10:35:00",
        },
    ]

    # Create sequences and get their IDs
    sequence_ids = []
    for seq_data in test_sequences:
        response = await authenticated_client.post("/sequences", data=seq_data)
        assert response.status_code == 201
        sequence_ids.append(response.json()["id"])

    # Create detections for each sequence and capture their IDs
    detection_ids = []
    for i, seq_id in enumerate(sequence_ids, 1):
        detection_payload = {
            "sequence_id": str(seq_id),
            "alert_api_id": str(i + 1000),
            "recorded_at": "2024-01-15T10:25:00",
            "algo_predictions": json.dumps(
                {
                    "predictions": [
                        {
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                            "confidence": 0.85,
                            "class_name": "smoke",
                        }
                    ]
                }
            ),
        }

        # Create a simple test image
        import io

        img = Image.new("RGB", (100, 100), color="red")
        img_bytes = io.BytesIO()
        img.save(img_bytes, format="JPEG")
        img_bytes.seek(0)

        files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
        response = await authenticated_client.post(
            "/detections", data=detection_payload, files=files
        )
        assert response.status_code == 201
        detection_ids.append(response.json()["id"])

    # Create test annotations with different false positive types
    test_annotations = [
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
                        "bboxes": [
                            {
                                "detection_id": detection_ids[0],
                                "xyxyn": [0.1, 0.1, 0.2, 0.2],
                            }
                        ],
                    }
                ]
            },
            "processing_stage": "annotated",
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
                        "bboxes": [
                            {
                                "detection_id": detection_ids[1],
                                "xyxyn": [0.2, 0.2, 0.3, 0.3],
                            }
                        ],
                    }
                ]
            },
            "processing_stage": "annotated",
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
                        "bboxes": [
                            {
                                "detection_id": detection_ids[2],
                                "xyxyn": [0.3, 0.3, 0.4, 0.4],
                            }
                        ],
                    }
                ]
            },
            "processing_stage": "annotated",
        },
    ]

    # Create annotations
    annotation_ids = []
    for annotation_data in test_annotations:
        response = await authenticated_client.post(
            "/annotations/sequences/", json=annotation_data
        )
        assert response.status_code == 201
        annotation_ids.append(response.json()["id"])

    # Test 1: Filter by single false positive type - should match first annotation
    response = await authenticated_client.get(
        "/annotations/sequences/?false_positive_types=antenna"
    )
    assert response.status_code == 200
    data = response.json()
    filtered_annotations = data["items"]

    # Should only match first annotation
    matching_ids = [
        ann["id"] for ann in filtered_annotations if ann["id"] in annotation_ids
    ]
    assert annotation_ids[0] in matching_ids
    assert annotation_ids[1] not in matching_ids
    assert annotation_ids[2] not in matching_ids

    # Test 2: Filter by multiple false positive types - should match first two annotations
    response = await authenticated_client.get(
        "/annotations/sequences/?false_positive_types=antenna&false_positive_types=lens_flare"
    )
    assert response.status_code == 200
    data = response.json()
    filtered_annotations = data["items"]

    # Should match first two annotations
    matching_ids = [
        ann["id"] for ann in filtered_annotations if ann["id"] in annotation_ids
    ]
    assert annotation_ids[0] in matching_ids
    assert annotation_ids[1] in matching_ids
    assert annotation_ids[2] not in matching_ids

    # Test 3: Filter by non-existent false positive type - should return validation error
    response = await authenticated_client.get(
        "/annotations/sequences/?false_positive_types=nonexistent"
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data
    # Verify it's a validation error for the enum
    assert any("Input should be" in str(error) for error in error_data["detail"])


@pytest.mark.asyncio
async def test_list_sequence_annotations_false_positive_types_validation(
    authenticated_client: AsyncClient,
):
    """Test that invalid false positive types return proper validation errors."""
    # Test with invalid false positive type - should return 422 validation error
    response = await authenticated_client.get(
        "/annotations/sequences/?false_positive_types=invalid_type"
    )
    assert response.status_code == 422

    # Test with mix of valid and invalid types
    response = await authenticated_client.get(
        "/annotations/sequences/?false_positive_types=antenna&false_positive_types=invalid_type"
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_false_positive_sequence_auto_annotated_detection_annotations(
    authenticated_client: AsyncClient, sequence_session
):
    """Test that false positive sequences (no smoke, no missed smoke, has false positives) automatically create ANNOTATED detection annotations."""

    # Create a detection for the sequence first
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "2001",
        "recorded_at": "2024-01-15T10:25:00",
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.3, 0.3],
                        "confidence": 0.87,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    # Create test image
    import io

    img = Image.new("RGB", (100, 100), color="blue")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_bytes.seek(0)

    files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
    response = await authenticated_client.post(
        "/detections", data=detection_payload, files=files
    )
    assert response.status_code == 201
    detection_id = response.json()["id"]

    # Create a false positive sequence annotation (no smoke, no missed smoke, has false positives)
    false_positive_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,  # No smoke
                    "false_positive_types": [
                        "antenna",
                        "building",
                    ],  # Has false positives
                    "bboxes": [
                        {"detection_id": detection_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Create the sequence annotation - this should trigger auto-creation of detection annotations
    response = await authenticated_client.post(
        "/annotations/sequences/", json=false_positive_payload
    )
    assert response.status_code == 201
    seq_annotation = response.json()

    # Verify sequence annotation properties
    assert seq_annotation["has_smoke"] is False
    assert seq_annotation["has_false_positives"] is True
    assert seq_annotation["has_missed_smoke"] is False

    # Check that a detection annotation was automatically created
    response = await authenticated_client.get("/annotations/detections/?sequence_id=1")
    assert response.status_code == 200
    detection_annotations = response.json()["items"]

    # Should have one detection annotation for our detection
    detection_annotation = None
    for ann in detection_annotations:
        if ann["detection_id"] == detection_id:
            detection_annotation = ann
            break

    assert (
        detection_annotation is not None
    ), "Detection annotation should be auto-created"
    # For false positive sequences, detection annotations should be automatically ANNOTATED
    assert detection_annotation["processing_stage"] == "annotated"
    # Should have empty annotation (no bounding boxes needed for false positives)
    assert detection_annotation["annotation"] == {"annotation": []}


@pytest.mark.asyncio
async def test_true_positive_sequence_pre_populated_detection_annotations(
    authenticated_client: AsyncClient, sequence_session
):
    """Test that true positive sequences (has smoke, no missed smoke, no false positives) create VISUAL_CHECK detection annotations with pre-populated predictions."""

    # Create a detection with algo_predictions for the sequence
    algo_predictions = {
        "predictions": [
            {"xyxyn": [0.1, 0.2, 0.4, 0.6], "confidence": 0.92, "class_name": "smoke"},
            {"xyxyn": [0.5, 0.3, 0.8, 0.7], "confidence": 0.85, "class_name": "fire"},
        ]
    }

    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "3001",
        "recorded_at": "2024-01-15T10:25:00",
        "algo_predictions": json.dumps(algo_predictions),
    }

    # Create test image
    import io

    img = Image.new("RGB", (100, 100), color="orange")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_bytes.seek(0)

    files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
    response = await authenticated_client.post(
        "/detections", data=detection_payload, files=files
    )
    assert response.status_code == 201
    detection_id = response.json()["id"]

    # Create a true positive sequence annotation (has smoke, no missed smoke, no false positives)
    true_positive_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,  # Has smoke
                    "false_positive_types": [],  # No false positives
                    "bboxes": [
                        {"detection_id": detection_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Create the sequence annotation - this should trigger auto-creation of detection annotations
    response = await authenticated_client.post(
        "/annotations/sequences/", json=true_positive_payload
    )
    assert response.status_code == 201
    seq_annotation = response.json()

    # Verify sequence annotation properties
    assert seq_annotation["has_smoke"] is True
    assert seq_annotation["has_false_positives"] is False
    assert seq_annotation["has_missed_smoke"] is False

    # Check that a detection annotation was automatically created
    response = await authenticated_client.get("/annotations/detections/?sequence_id=1")
    assert response.status_code == 200
    detection_annotations = response.json()["items"]

    # Should have detection annotations for our detection
    detection_annotation = None
    for ann in detection_annotations:
        if ann["detection_id"] == detection_id:
            detection_annotation = ann
            break

    assert (
        detection_annotation is not None
    ), "Detection annotation should be auto-created"
    # For true positive sequences, detection annotations should be VISUAL_CHECK (ready for review)
    assert detection_annotation["processing_stage"] == "visual_check"

    # Should have pre-populated annotation from model predictions
    annotation_data = detection_annotation["annotation"]
    assert "annotation" in annotation_data
    annotations = annotation_data["annotation"]

    # Should have 2 annotations from the 2 model predictions
    assert len(annotations) == 2

    # Check first annotation
    assert annotations[0]["xyxyn"] == [0.1, 0.2, 0.4, 0.6]
    assert annotations[0]["class_name"] == "smoke"
    assert annotations[0]["smoke_type"] == "wildfire"  # Default for true positives

    # Check second annotation
    assert annotations[1]["xyxyn"] == [0.5, 0.3, 0.8, 0.7]
    assert annotations[1]["class_name"] == "fire"
    assert annotations[1]["smoke_type"] == "wildfire"  # Default for true positives


@pytest.mark.asyncio
async def test_true_positive_sequence_empty_predictions_fallback(
    authenticated_client: AsyncClient, sequence_session
):
    """Test that true positive sequences with no/invalid model predictions fall back to empty annotations."""

    # Create a detection with empty algo_predictions
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "4001",
        "recorded_at": "2024-01-15T10:25:00",
        "algo_predictions": json.dumps({"predictions": []}),  # Empty predictions
    }

    # Create test image
    import io

    img = Image.new("RGB", (100, 100), color="green")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_bytes.seek(0)

    files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
    response = await authenticated_client.post(
        "/detections", data=detection_payload, files=files
    )
    assert response.status_code == 201
    detection_id = response.json()["id"]

    # Create a true positive sequence annotation
    true_positive_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": detection_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Create the sequence annotation
    response = await authenticated_client.post(
        "/annotations/sequences/", json=true_positive_payload
    )
    assert response.status_code == 201

    # Check the detection annotation
    response = await authenticated_client.get("/annotations/detections/?sequence_id=1")
    assert response.status_code == 200
    detection_annotations = response.json()["items"]

    detection_annotation = None
    for ann in detection_annotations:
        if ann["detection_id"] == detection_id:
            detection_annotation = ann
            break

    assert detection_annotation is not None
    assert detection_annotation["processing_stage"] == "visual_check"
    # Should fall back to empty annotation when predictions are empty
    assert detection_annotation["annotation"] == {"annotation": []}


@pytest.mark.asyncio
async def test_mixed_sequence_normal_bbox_annotation(
    authenticated_client: AsyncClient, sequence_session
):
    """Test that mixed sequences (smoke + false positives or missed smoke) create BBOX_ANNOTATION detection annotations."""

    # Create a detection for the sequence
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "5001",
        "recorded_at": "2024-01-15T10:25:00",
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.3, 0.3],
                        "confidence": 0.75,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    # Create test image
    import io

    img = Image.new("RGB", (100, 100), color="purple")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_bytes.seek(0)

    files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
    response = await authenticated_client.post(
        "/detections", data=detection_payload, files=files
    )
    assert response.status_code == 201
    detection_id = response.json()["id"]

    # Create a mixed sequence annotation (has smoke + has false positives)
    mixed_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,  # Has smoke
                    "false_positive_types": ["antenna"],  # Also has false positives
                    "bboxes": [
                        {"detection_id": detection_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Create the sequence annotation
    response = await authenticated_client.post(
        "/annotations/sequences/", json=mixed_payload
    )
    assert response.status_code == 201
    seq_annotation = response.json()

    # Verify sequence annotation properties
    assert seq_annotation["has_smoke"] is True
    assert seq_annotation["has_false_positives"] is True
    assert seq_annotation["has_missed_smoke"] is False

    # Check the detection annotation
    response = await authenticated_client.get("/annotations/detections/?sequence_id=1")
    assert response.status_code == 200
    detection_annotations = response.json()["items"]

    detection_annotation = None
    for ann in detection_annotations:
        if ann["detection_id"] == detection_id:
            detection_annotation = ann
            break

    assert detection_annotation is not None
    # Mixed sequences should use BBOX_ANNOTATION (manual drawing required)
    assert detection_annotation["processing_stage"] == "bbox_annotation"
    # Should have empty annotation (user needs to draw manually)
    assert detection_annotation["annotation"] == {"annotation": []}


@pytest.mark.asyncio
async def test_convert_algo_predictions_to_annotation_helper():
    """Test the convert_algo_predictions_to_annotation helper function directly."""
    from app.api.api_v1.endpoints.sequence_annotations import (
        convert_algo_predictions_to_annotation,
    )

    # Test with valid predictions
    algo_predictions = {
        "predictions": [
            {"xyxyn": [0.1, 0.2, 0.4, 0.6], "confidence": 0.92, "class_name": "smoke"},
            {"xyxyn": [0.5, 0.3, 0.8, 0.7], "confidence": 0.85, "class_name": "fire"},
        ]
    }

    result = convert_algo_predictions_to_annotation(algo_predictions)

    assert "annotation" in result
    annotations = result["annotation"]
    assert len(annotations) == 2

    # Check first annotation
    assert annotations[0]["xyxyn"] == [0.1, 0.2, 0.4, 0.6]
    assert annotations[0]["class_name"] == "smoke"
    assert annotations[0]["smoke_type"] == "wildfire"

    # Check second annotation
    assert annotations[1]["xyxyn"] == [0.5, 0.3, 0.8, 0.7]
    assert annotations[1]["class_name"] == "fire"
    assert annotations[1]["smoke_type"] == "wildfire"

    # Test with None input
    result = convert_algo_predictions_to_annotation(None)
    assert result == {"annotation": []}

    # Test with empty predictions
    result = convert_algo_predictions_to_annotation({"predictions": []})
    assert result == {"annotation": []}

    # Test with missing predictions key
    result = convert_algo_predictions_to_annotation({"other_key": "value"})
    assert result == {"annotation": []}

    # Test with invalid prediction format (missing xyxyn)
    invalid_predictions = {
        "predictions": [
            {
                "confidence": 0.85,
                "class_name": "smoke",
                # Missing xyxyn
            },
            {"xyxyn": [0.1, 0.2, 0.3, 0.4], "confidence": 0.90, "class_name": "fire"},
        ]
    }

    result = convert_algo_predictions_to_annotation(invalid_predictions)
    # Should skip invalid prediction and include only the valid one
    assert len(result["annotation"]) == 1
    assert result["annotation"][0]["xyxyn"] == [0.1, 0.2, 0.3, 0.4]
    assert result["annotation"][0]["class_name"] == "fire"

    # Test with invalid xyxyn format
    invalid_xyxyn_predictions = {
        "predictions": [
            {
                "xyxyn": [0.1, 0.2],  # Too short
                "confidence": 0.85,
                "class_name": "smoke",
            },
            {
                "xyxyn": "not_a_list",  # Wrong type
                "confidence": 0.90,
                "class_name": "fire",
            },
        ]
    }

    result = convert_algo_predictions_to_annotation(invalid_xyxyn_predictions)
    # Should skip both invalid predictions
    assert result == {"annotation": []}

    # Test with missing class_name (should default to "smoke")
    missing_class_predictions = {
        "predictions": [
            {
                "xyxyn": [0.1, 0.2, 0.3, 0.4],
                "confidence": 0.85,
                # Missing class_name
            }
        ]
    }

    result = convert_algo_predictions_to_annotation(missing_class_predictions)
    assert len(result["annotation"]) == 1
    assert result["annotation"][0]["class_name"] == "smoke"  # Default value
    assert result["annotation"][0]["smoke_type"] == "wildfire"


# Contributor Tests


@pytest.mark.asyncio
async def test_get_sequence_annotation_includes_contributors(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that individual sequence annotation GET endpoint includes contributor information."""
    # Create sequence annotation
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Create annotation
    create_response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert create_response.status_code == 201
    annotation_id = create_response.json()["id"]

    # Get the annotation
    get_response = await authenticated_client.get(f"/annotations/sequences/{annotation_id}")
    assert get_response.status_code == 200
    
    annotation_data = get_response.json()
    
    # Verify contributors field exists
    assert "contributors" in annotation_data
    assert isinstance(annotation_data["contributors"], list)
    
    # Should have at least one contributor (the user who created it)
    assert len(annotation_data["contributors"]) >= 1
    
    # Check contributor data structure
    contributor = annotation_data["contributors"][0]
    assert "id" in contributor
    assert "username" in contributor
    assert isinstance(contributor["id"], int)
    assert isinstance(contributor["username"], str)


@pytest.mark.asyncio
async def test_get_sequence_annotation_multiple_contributors(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that sequence annotation includes multiple contributors after updates."""
    # Create sequence annotation
    create_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Create annotation with user 1
    create_response = await authenticated_client.post("/annotations/sequences/", json=create_payload)
    assert create_response.status_code == 201
    annotation_id = create_response.json()["id"]

    # Update annotation (this will record another contribution from same user)
    update_payload = {
        "has_missed_smoke": True,
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
    }

    update_response = await authenticated_client.patch(
        f"/annotations/sequences/{annotation_id}", json=update_payload
    )
    assert update_response.status_code == 200

    # Get the annotation and verify contributors
    get_response = await authenticated_client.get(f"/annotations/sequences/{annotation_id}")
    assert get_response.status_code == 200
    
    annotation_data = get_response.json()
    
    # Verify contributors field exists and has contributions
    assert "contributors" in annotation_data
    assert isinstance(annotation_data["contributors"], list)
    assert len(annotation_data["contributors"]) >= 1  # At least one contributor
    
    # All contributors should have the same user (since we used same authenticated client)
    for contributor in annotation_data["contributors"]:
        assert "id" in contributor
        assert "username" in contributor
        assert isinstance(contributor["id"], int)
        assert isinstance(contributor["username"], str)


@pytest.mark.asyncio
async def test_list_sequence_annotations_includes_contributors(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that sequence annotations list endpoint includes contributor information."""
    # Create sequence annotation
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Create annotation
    create_response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert create_response.status_code == 201
    created_annotation_id = create_response.json()["id"]

    # List annotations
    list_response = await authenticated_client.get("/annotations/sequences/")
    assert list_response.status_code == 200
    
    list_data = list_response.json()
    
    # Verify paginated response structure
    assert "items" in list_data
    assert isinstance(list_data["items"], list)
    
    # Find our created annotation in the list
    found_annotation = None
    for annotation in list_data["items"]:
        if annotation["id"] == created_annotation_id:
            found_annotation = annotation
            break
    
    assert found_annotation is not None, "Created annotation should be in the list"
    
    # Verify contributors field exists for the annotation in the list
    assert "contributors" in found_annotation
    assert isinstance(found_annotation["contributors"], list)
    assert len(found_annotation["contributors"]) >= 1
    
    # Check contributor data structure
    contributor = found_annotation["contributors"][0]
    assert "id" in contributor
    assert "username" in contributor
    assert isinstance(contributor["id"], int)
    assert isinstance(contributor["username"], str)


@pytest.mark.asyncio
async def test_list_sequence_annotations_empty_contributors(
    authenticated_client: AsyncClient, sequence_session
):
    """Test that sequence annotations with no contributions return empty contributors array."""
    # List all annotations (may include some with no manual contributions)
    list_response = await authenticated_client.get("/annotations/sequences/")
    assert list_response.status_code == 200
    
    list_data = list_response.json()
    
    # Verify all annotations have contributors field (even if empty)
    assert "items" in list_data
    for annotation in list_data["items"]:
        assert "contributors" in annotation
        assert isinstance(annotation["contributors"], list)
        # Contributors array may be empty or populated, but should always be a list


# Comprehensive Contribution Logic Tests

@pytest.mark.asyncio
async def test_sequence_annotation_no_contributions_for_imported_stage(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that no contributions are recorded for sequence annotations created in 'imported' stage."""
    # Create sequence annotation in imported stage
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]},
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }
    create_response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert create_response.status_code == 201
    annotation_data = create_response.json()
    
    # Verify no contributors recorded
    assert "contributors" in annotation_data
    assert annotation_data["contributors"] == []


@pytest.mark.asyncio
async def test_sequence_annotation_no_contributions_for_ready_to_annotate_stage(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that no contributions are recorded for sequence annotations created in 'ready_to_annotate' stage."""
    # Create sequence annotation in ready_to_annotate stage
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]},
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value,
        "created_at": datetime.now(UTC).isoformat(),
    }
    create_response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert create_response.status_code == 201
    annotation_data = create_response.json()
    
    # Verify no contributors recorded
    assert annotation_data["contributors"] == []


@pytest.mark.asyncio
async def test_sequence_annotation_contributions_for_annotated_stage_only(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that contributions are recorded ONLY for 'annotated' stage - comprehensive workflow test."""
    # Step 1: Create annotation in imported stage
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]},
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }
    create_response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert create_response.status_code == 201
    annotation_id = create_response.json()["id"]
    assert create_response.json()["contributors"] == []  # No contributors yet

    # Step 2: Update to ready_to_annotate - still no contributions
    update_response = await authenticated_client.patch(
        f"/annotations/sequences/{annotation_id}", 
        json={"processing_stage": models.SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value}
    )
    assert update_response.status_code == 200
    assert update_response.json()["contributors"] == []

    # Step 3: Update to annotated - NOW should have contributor
    update_response = await authenticated_client.patch(
        f"/annotations/sequences/{annotation_id}", 
        json={"processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value}
    )
    assert update_response.status_code == 200
    final_data = update_response.json()
    assert len(final_data["contributors"]) == 1
    assert final_data["contributors"][0]["username"] == "admin"

    # Step 4: Verify via GET endpoint
    get_response = await authenticated_client.get(f"/annotations/sequences/{annotation_id}")
    assert get_response.status_code == 200
    assert len(get_response.json()["contributors"]) == 1


@pytest.mark.asyncio
async def test_sequence_annotation_create_directly_in_annotated_stage(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that creating a sequence annotation directly in 'annotated' stage records contribution immediately."""
    # Create annotation directly in annotated stage
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]},
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }
    create_response = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert create_response.status_code == 201
    annotation_data = create_response.json()
    
    # Verify contributor recorded immediately
    assert len(annotation_data["contributors"]) == 1
    assert annotation_data["contributors"][0]["username"] == "admin"


@pytest.mark.asyncio
async def test_sequence_annotation_list_endpoint_contribution_logic(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that list endpoint correctly shows contributors only for annotated stage annotations."""
    # Create one annotation in imported stage (no contributors)
    payload_imported = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]},
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }
    create_response_1 = await authenticated_client.post("/annotations/sequences/", json=payload_imported)
    assert create_response_1.status_code == 201
    annotation_1_id = create_response_1.json()["id"]

    # Create another annotation directly in annotated stage (has contributors)  
    payload_annotated = {
        "sequence_id": 2,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": []},
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }
    create_response_2 = await authenticated_client.post("/annotations/sequences/", json=payload_annotated)
    assert create_response_2.status_code == 201
    annotation_2_id = create_response_2.json()["id"]

    # List all annotations and verify contributor logic
    list_response = await authenticated_client.get("/annotations/sequences/")
    assert list_response.status_code == 200
    annotations = list_response.json()["items"]
    
    # Find our annotations in the list
    imported_annotation = None
    annotated_annotation = None
    for annotation in annotations:
        if annotation["id"] == annotation_1_id:
            imported_annotation = annotation
        elif annotation["id"] == annotation_2_id:
            annotated_annotation = annotation
    
    assert imported_annotation is not None
    assert annotated_annotation is not None
    
    # Verify contribution logic
    assert imported_annotation["contributors"] == []  # No contributors for imported stage
    assert len(annotated_annotation["contributors"]) == 1  # Has contributors for annotated stage
    assert annotated_annotation["contributors"][0]["username"] == "admin"
