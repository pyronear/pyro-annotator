"""
Tests for detection annotation auto-creation workflow.

This test module focuses on the critical detection annotation workflow that was fixed,
specifically testing:
1. Auto-creation of detection annotations when sequence annotations are marked as 'annotated'
2. Correct annotation data structure: {"annotation": []} instead of {}
3. Processing stage business logic for detection annotations
4. Complete workflow from sequence annotation to detection annotation updates
5. Validation that was causing 422 errors

These tests verify the fixes implemented for the detection annotation workflow issues.
"""

import json
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

from app import models

now = datetime.utcnow()

@pytest.mark.asyncio
async def test_auto_create_detection_annotations_correct_structure(
    async_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session,
    mock_img: bytes,
):
    """Test that detection annotations are auto-created with correct structure when sequence annotation is marked as 'annotated'."""

    # Step 1: Create a sequence annotation with processing_stage='annotated'
    sequence_annotation_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]},
                        {"detection_id": 2, "xyxyn": [0.3, 0.3, 0.4, 0.4]}
                    ]
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,  # This should trigger auto-creation
        "created_at": datetime.utcnow().isoformat()
    }

    response = await async_client.post(
        "/annotations/sequences/", json=sequence_annotation_payload
    )
    assert (
        response.status_code == 201
    ), f"Failed to create sequence annotation: {response.text}"
    sequence_annotation_id = response.json()["id"]

    # Step 2: Verify that detection annotations were auto-created for all detections in the sequence
    detection_annotations_response = await async_client.get("/annotations/detections/")
    assert detection_annotations_response.status_code == 200
    detection_annotations = detection_annotations_response.json()["items"]

    # Find detection annotations for our detections (detection_id 1 and 2)
    detection_1_annotation = None
    detection_2_annotation = None

    for annotation in detection_annotations:
        if annotation["detection_id"] == 1:
            detection_1_annotation = annotation
        elif annotation["detection_id"] == 2:
            detection_2_annotation = annotation

    # Step 3: Verify both detection annotations were created
    assert (
        detection_1_annotation is not None
    ), "Detection annotation should be auto-created for detection_id 1"
    assert (
        detection_2_annotation is not None
    ), "Detection annotation should be auto-created for detection_id 2"

    # Step 4: CRITICAL TEST - Verify the annotation field has the correct structure
    # The fixed backend should create {"annotation": []} instead of {}
    assert (
        "annotation" in detection_1_annotation
    ), "Detection annotation should have 'annotation' field"
    assert isinstance(
        detection_1_annotation["annotation"], dict
    ), "Annotation field should be a dict"
    assert (
        "annotation" in detection_1_annotation["annotation"]
    ), "Annotation field should have 'annotation' key"
    assert isinstance(
        detection_1_annotation["annotation"]["annotation"], list
    ), "Annotation.annotation should be a list"
    assert (
        detection_1_annotation["annotation"]["annotation"] == []
    ), "Annotation.annotation should be an empty list initially"

    # Same verification for second detection
    assert (
        "annotation" in detection_2_annotation
    ), "Detection annotation should have 'annotation' field"
    assert isinstance(
        detection_2_annotation["annotation"], dict
    ), "Annotation field should be a dict"
    assert (
        "annotation" in detection_2_annotation["annotation"]
    ), "Annotation field should have 'annotation' key"
    assert isinstance(
        detection_2_annotation["annotation"]["annotation"], list
    ), "Annotation.annotation should be a list"
    assert (
        detection_2_annotation["annotation"]["annotation"] == []
    ), "Annotation.annotation should be an empty list initially"

    # Step 5: Verify processing_stage is set correctly (should be 'bbox_annotation' since has_smoke=True)
    assert (
        detection_1_annotation["processing_stage"] == "bbox_annotation"
    ), "Processing stage should be bbox_annotation for smoke detection"
    assert (
        detection_2_annotation["processing_stage"] == "bbox_annotation"
    ), "Processing stage should be bbox_annotation for smoke detection"

@pytest.mark.asyncio
async def test_auto_create_detection_annotations_update_scenario(
    async_client: AsyncClient, sequence_session: AsyncSession, detection_session
):
    """Test that detection annotations are auto-created when sequence annotation is UPDATED to 'annotated'."""

    # Step 1: Create a sequence annotation with processing_stage='imported' (should not trigger auto-creation)
    create_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,  # Not 'annotated'
        "created_at": datetime.utcnow().isoformat()
    }

    create_response = await async_client.post(
        "/annotations/sequences/", json=create_payload
    )
    assert create_response.status_code == 201
    sequence_annotation_id = create_response.json()["id"]

    # Step 2: Verify no detection annotations exist yet
    detection_annotations_response = await async_client.get("/annotations/detections/")
    assert detection_annotations_response.status_code == 200
    initial_annotations = detection_annotations_response.json()["items"]
    detection_1_exists_initially = any(
        ann["detection_id"] == 1 for ann in initial_annotations
    )
    assert (
        not detection_1_exists_initially
    ), "Detection annotation should not exist initially"

    # Step 3: Update the sequence annotation to processing_stage='annotated' (should trigger auto-creation)
    update_payload = {
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value
    }

    update_response = await async_client.patch(
        f"/annotations/sequences/{sequence_annotation_id}",
        json=update_payload,
    )
    assert update_response.status_code == 200

    # Step 4: Verify detection annotation was auto-created after the update
    detection_annotations_response = await async_client.get("/annotations/detections/")
    assert detection_annotations_response.status_code == 200
    final_annotations = detection_annotations_response.json()["items"]

    detection_1_annotation = None
    for annotation in final_annotations:
        if annotation["detection_id"] == 1:
            detection_1_annotation = annotation
            break

    assert (
        detection_1_annotation is not None
    ), "Detection annotation should be auto-created after update to 'annotated'"

    # Step 5: Verify the correct annotation structure
    assert (
        detection_1_annotation["annotation"]["annotation"] == []
    ), "Auto-created annotation should have correct empty structure"
    assert (
        detection_1_annotation["processing_stage"] == "bbox_annotation"
    ), "Processing stage should be bbox_annotation for smoke detection"

@pytest.mark.asyncio
async def test_auto_create_detection_annotations_processing_stages(
    async_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session,
    mock_img: bytes,
):
    """Test the business logic for determining detection annotation processing stages."""

    # Test Case 1: has_missed_smoke=false AND has_false_positives=true → visual_check
    payload_visual_check = {
        "sequence_id": 1,
        "has_missed_smoke": False,  # False
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,  # No smoke
                    "false_positive_types": [
                        models.FalsePositiveType.ANTENNA.value
                    ],  # Has false positives
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.utcnow().isoformat()
    }

    response1 = await async_client.post(
        "/annotations/sequences/", json=payload_visual_check
    )
    assert response1.status_code == 201

    # Check the created detection annotation has visual_check stage
    detection_annotations_response = await async_client.get("/annotations/detections/")
    detection_annotations = detection_annotations_response.json()["items"]
    detection_1_annotation = next(
        ann for ann in detection_annotations if ann["detection_id"] == 1
    )
    assert (
        detection_1_annotation["processing_stage"] == "visual_check"
    ), "Should be visual_check for false positives only"

    # Clean up for next test - delete the sequence annotation
    await async_client.delete(f"/annotations/sequences/{response1.json()['id']}")

    # Test Case 2: Create a new sequence for the next test
    sequence_payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "1001",
        "camera_name": "bbox_test_camera",
        "camera_id": "1001",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "created_at": datetime.utcnow().isoformat(),
        "recorded_at": datetime.utcnow().isoformat(),
        "last_seen_at": datetime.utcnow().isoformat()
    }

    sequence_response = await async_client.post("/sequences", data=sequence_payload)
    assert sequence_response.status_code == 201
    sequence2_id = sequence_response.json()["id"]

    # Create detection for new sequence
    detection_payload = {
        "sequence_id": str(sequence2_id),
        "alert_api_id": "1002",
        "recorded_at": datetime.utcnow().isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.15, 0.15, 0.3, 0.3],
                        "confidence": 0.88,
                        "class_name": "smoke"
                    }
                ]
            }
        )
    }

    detection_response = await async_client.post(
        "/detections",
        data=detection_payload,
        files={"file": ("bbox_test.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response.status_code == 201
    detection2_id = detection_response.json()["id"]

    # Test Case 2: has_smoke=true → bbox_annotation
    payload_bbox_annotation = {
        "sequence_id": sequence2_id,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,  # Has smoke
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": detection2_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ]
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.utcnow().isoformat()
    }

    response2 = await async_client.post(
        "/annotations/sequences/", json=payload_bbox_annotation
    )
    assert response2.status_code == 201

    # Check the created detection annotation has bbox_annotation stage
    detection_annotations_response = await async_client.get("/annotations/detections/")
    detection_annotations = detection_annotations_response.json()["items"]
    detection_2_annotation = next(
        (ann for ann in detection_annotations if ann["detection_id"] == detection2_id),
        None,
    )
    assert detection_2_annotation is not None, "Detection annotation should be created"
    assert (
        detection_2_annotation["processing_stage"] == "bbox_annotation"
    ), "Should be bbox_annotation for smoke detection"

    # Test Case 3: has_missed_smoke=true → bbox_annotation (create another sequence/detection for this test)
    sequence_payload_3 = {
        "source_api": "pyronear_french",
        "alert_api_id": "1003",
        "camera_name": "missed_smoke_camera",
        "camera_id": "1003",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "created_at": datetime.utcnow().isoformat(),
        "recorded_at": datetime.utcnow().isoformat(),
        "last_seen_at": datetime.utcnow().isoformat()
    }

    sequence_response_3 = await async_client.post("/sequences", data=sequence_payload_3)
    assert sequence_response_3.status_code == 201
    sequence3_id = sequence_response_3.json()["id"]

    # Create detection for third sequence
    detection_payload_3 = {
        "sequence_id": str(sequence3_id),
        "alert_api_id": "1004",
        "recorded_at": datetime.utcnow().isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.15, 0.15, 0.3, 0.3],
                        "confidence": 0.88,
                        "class_name": "smoke"
                    }
                ]
            }
        )
    }

    detection_response_3 = await async_client.post(
        "/detections",
        data=detection_payload_3,
        files={"file": ("missed_smoke_test.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response_3.status_code == 201
    detection3_id = detection_response_3.json()["id"]

    payload_missed_smoke = {
        "sequence_id": sequence3_id,
        "has_missed_smoke": True,  # Has missed smoke
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,  # No smoke detected but missed
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": detection3_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ]
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.utcnow().isoformat()
    }

    response3 = await async_client.post(
        "/annotations/sequences/", json=payload_missed_smoke
    )
    assert response3.status_code == 201

    # Check the created detection annotation has bbox_annotation stage
    detection_annotations_response = await async_client.get("/annotations/detections/")
    detection_annotations = detection_annotations_response.json()["items"]
    detection_3_annotation = next(
        (ann for ann in detection_annotations if ann["detection_id"] == detection3_id),
        None,
    )
    assert detection_3_annotation is not None, "Detection annotation should be created"
    assert (
        detection_3_annotation["processing_stage"] == "bbox_annotation"
    ), "Should be bbox_annotation for missed smoke"

@pytest.mark.asyncio
async def test_detection_annotation_update_workflow(
    async_client: AsyncClient, sequence_session: AsyncSession, detection_session
):
    """Test the complete workflow: auto-create detection annotations → frontend updates with bbox data."""

    # Step 1: Auto-create detection annotations via sequence annotation
    sequence_annotation_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.utcnow().isoformat()
    }

    seq_response = await async_client.post(
        "/annotations/sequences/", json=sequence_annotation_payload
    )
    assert seq_response.status_code == 201

    # Step 2: Get the auto-created detection annotation
    detection_annotations_response = await async_client.get("/annotations/detections/")
    detection_annotations = detection_annotations_response.json()["items"]
    detection_annotation = next(
        ann for ann in detection_annotations if ann["detection_id"] == 1
    )
    detection_annotation_id = detection_annotation["id"]

    # Step 3: Simulate frontend workflow - update detection annotation with bbox data
    # This mimics what the frontend does when a user draws rectangles and submits
    update_payload = {
        "annotation": {
            "annotation": [
                {
                    "xyxyn": [0.15, 0.15, 0.35, 0.35],
                    "class_name": "smoke",
                    "smoke_type": "wildfire"
                },
                {
                    "xyxyn": [0.45, 0.45, 0.65, 0.65],
                    "class_name": "smoke",
                    "smoke_type": "industrial"
                }
            ]
        },
        "processing_stage": "annotated"
    }

    update_response = await async_client.patch(
        f"/annotations/detections/{detection_annotation_id}", json=update_payload
    )
    assert (
        update_response.status_code == 200
    ), f"Failed to update detection annotation: {update_response.text}"

    # Step 4: Verify the updated annotation has the correct structure and data
    updated_annotation = update_response.json()
    assert updated_annotation["processing_stage"] == "annotated"

    # Verify annotation structure
    annotation_data = updated_annotation["annotation"]
    assert "annotation" in annotation_data
    annotation_items = annotation_data["annotation"]
    assert len(annotation_items) == 2, "Should have 2 bbox annotations"

    # Verify first bbox
    bbox1 = annotation_items[0]
    assert bbox1["xyxyn"] == [0.15, 0.15, 0.35, 0.35]
    assert bbox1["class_name"] == "smoke"
    assert bbox1["smoke_type"] == "wildfire"

    # Verify second bbox
    bbox2 = annotation_items[1]
    assert bbox2["xyxyn"] == [0.45, 0.45, 0.65, 0.65]
    assert bbox2["class_name"] == "smoke"
    assert bbox2["smoke_type"] == "industrial"

    # Step 5: Verify we can retrieve the updated annotation
    get_response = await async_client.get(
        f"/annotations/detections/{detection_annotation_id}"
    )
    assert get_response.status_code == 200
    retrieved_annotation = get_response.json()
    assert retrieved_annotation["annotation"]["annotation"] == annotation_items

@pytest.mark.asyncio
async def test_detection_annotation_validation_requirements(
    async_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session,
    mock_img: bytes,
):
    """Test validation of detection annotation structure that was causing 422 errors."""

    # Create a detection first
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "2001",
        "recorded_at": datetime.utcnow().isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.15, 0.15, 0.3, 0.3],
                        "confidence": 0.88,
                        "class_name": "smoke"
                    }
                ]
            }
        )
    }

    detection_response = await async_client.post(
        "/detections",
        data=detection_payload,
        files={"file": ("validation_test.jpg", mock_img, "image/jpeg")},
    )
    assert detection_response.status_code == 201
    validation_detection_id = detection_response.json()["id"]

    # Test Case 1: Valid annotation structure (should succeed)
    valid_payload = {
        "detection_id": str(validation_detection_id),
        "annotation": json.dumps(
            {
                "annotation": [  # Correct structure
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "class_name": "smoke",
                        "smoke_type": "wildfire"
                    }
                ]
            }
        ),
        "processing_stage": "visual_check"
    }

    valid_response = await async_client.post(
        "/annotations/detections/", data=valid_payload
    )
    assert (
        valid_response.status_code == 201
    ), "Valid annotation structure should be accepted"

    # Test Case 2: Invalid structure - empty object (should fail with 422)
    # This is the structure that was causing the original 422 error
    invalid_payload_empty = {
        "detection_id": str(validation_detection_id),
        "annotation": json.dumps(
            {}
        ),  # Invalid: empty object instead of {"annotation": [...]}
        "processing_stage": "visual_check"
    }

    # This should fail with validation error due to invalid structure
    invalid_response_empty = await async_client.post(
        "/annotations/detections/", data=invalid_payload_empty
    )
    assert (
        invalid_response_empty.status_code == 422
    )  # Validation error for invalid structure

    # Test Case 3: Invalid structure - missing annotation key (using PATCH to test structure validation)
    detection_annotation_id = valid_response.json()["id"]

    invalid_update_payload = {
        "annotation": {
            "wrong_field": [  # Should be "annotation"
                {
                    "xyxyn": [0.1, 0.1, 0.2, 0.2],
                    "class_name": "smoke",
                    "smoke_type": "wildfire"
                }
            ]
        },
        "processing_stage": "annotated"
    }

    invalid_update_response = await async_client.patch(
        f"/annotations/detections/{detection_annotation_id}",
        json=invalid_update_payload,
    )
    assert (
        invalid_update_response.status_code == 422
    ), "Invalid annotation structure should be rejected"

    # Test Case 4: Invalid bbox coordinates (x1 > x2, y1 > y2)
    invalid_bbox_payload = {
        "annotation": {
            "annotation": [
                {
                    "xyxyn": [0.3, 0.3, 0.2, 0.2],  # x1 > x2, y1 > y2 - invalid
                    "class_name": "smoke",
                    "smoke_type": "wildfire"
                }
            ]
        },
        "processing_stage": "annotated"
    }

    invalid_bbox_response = await async_client.patch(
        f"/annotations/detections/{detection_annotation_id}", json=invalid_bbox_payload
    )
    assert (
        invalid_bbox_response.status_code == 422
    ), "Invalid bbox coordinates should be rejected"

    # Test Case 5: Invalid smoke type enum
    invalid_smoke_type_payload = {
        "annotation": {
            "annotation": [
                {
                    "xyxyn": [0.1, 0.1, 0.2, 0.2],
                    "class_name": "smoke",
                    "smoke_type": "invalid_smoke_type",  # Invalid enum value
                }
            ]
        },
        "processing_stage": "annotated"
    }

    invalid_smoke_response = await async_client.patch(
        f"/annotations/detections/{detection_annotation_id}",
        json=invalid_smoke_type_payload,
    )
    assert (
        invalid_smoke_response.status_code == 422
    ), "Invalid smoke type should be rejected"

@pytest.mark.asyncio
async def test_auto_create_avoids_duplicate_detection_annotations(
    async_client: AsyncClient, sequence_session: AsyncSession, detection_session
):
    """Test that auto-creation doesn't create duplicate detection annotations if they already exist."""

    # Step 1: Manually create a detection annotation first
    manual_payload = {
        "detection_id": "1",
        "annotation": json.dumps(
            {
                "annotation": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "class_name": "smoke",
                        "smoke_type": "wildfire"
                    }
                ]
            }
        ),
        "processing_stage": "visual_check"
    }

    manual_response = await async_client.post(
        "/annotations/detections/", data=manual_payload
    )
    assert manual_response.status_code == 201
    existing_annotation_id = manual_response.json()["id"]

    # Step 2: Create a sequence annotation with processing_stage='annotated' (should trigger auto-creation)
    sequence_annotation_payload = {
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
                            "xyxyn": [0.1, 0.1, 0.2, 0.2]
                        },  # Already has annotation
                        {
                            "detection_id": 2,
                            "xyxyn": [0.3, 0.3, 0.4, 0.4]
                        },  # No existing annotation
                    ]
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.utcnow().isoformat()
    }

    seq_response = await async_client.post(
        "/annotations/sequences/", json=sequence_annotation_payload
    )
    assert seq_response.status_code == 201

    # Step 3: Verify the existing annotation for detection_id=1 was not duplicated or modified
    get_existing_response = await async_client.get(
        f"/annotations/detections/{existing_annotation_id}"
    )
    assert get_existing_response.status_code == 200
    existing_annotation = get_existing_response.json()

    # Should still have the original annotation data (not empty structure)
    assert existing_annotation["detection_id"] == 1
    assert len(existing_annotation["annotation"]["annotation"]) == 1
    assert (
        existing_annotation["annotation"]["annotation"][0]["smoke_type"] == "wildfire"
    )

    # Step 4: Verify a new annotation was created for detection_id=2
    all_annotations_response = await async_client.get("/annotations/detections/")
    all_annotations = all_annotations_response.json()["items"]

    detection_2_annotations = [
        ann for ann in all_annotations if ann["detection_id"] == 2
    ]
    assert (
        len(detection_2_annotations) == 1
    ), "Should create exactly one annotation for detection_id=2"

    detection_2_annotation = detection_2_annotations[0]
    assert (
        detection_2_annotation["annotation"]["annotation"] == []
    ), "New auto-created annotation should have empty structure"
    assert detection_2_annotation["processing_stage"] == "bbox_annotation"

@pytest.mark.asyncio
async def test_no_auto_create_when_not_annotated_stage(
    async_client: AsyncClient, sequence_session: AsyncSession, detection_session
):
    """Test that detection annotations are NOT auto-created when sequence annotation is not in 'annotated' stage."""

    # Create sequence annotation with processing_stage='imported' (should NOT trigger auto-creation)
    sequence_annotation_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,  # NOT annotated
        "created_at": datetime.utcnow().isoformat()
    }

    seq_response = await async_client.post(
        "/annotations/sequences/", json=sequence_annotation_payload
    )
    assert seq_response.status_code == 201

    # Verify no detection annotations were created
    detection_annotations_response = await async_client.get("/annotations/detections/")
    detection_annotations = detection_annotations_response.json()["items"]
    detection_1_annotations = [
        ann for ann in detection_annotations if ann["detection_id"] == 1
    ]
    assert (
        len(detection_1_annotations) == 0
    ), "No detection annotations should be created when not in 'annotated' stage"

    # Test with 'ready_to_annotate' stage as well
    sequence_annotation_payload_2 = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 2, "xyxyn": [0.3, 0.3, 0.4, 0.4]}]
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value,  # NOT annotated
        "created_at": datetime.utcnow().isoformat()
    }

    # Delete the first annotation to create the second one for same sequence
    await async_client.delete(f"/annotations/sequences/{seq_response.json()['id']}")

    seq_response_2 = await async_client.post(
        "/annotations/sequences/", json=sequence_annotation_payload_2
    )
    assert seq_response_2.status_code == 201

    # Verify still no detection annotations were created
    detection_annotations_response = await async_client.get("/annotations/detections/")
    detection_annotations = detection_annotations_response.json()["items"]
    detection_2_annotations = [
        ann for ann in detection_annotations if ann["detection_id"] == 2
    ]
    assert (
        len(detection_2_annotations) == 0
    ), "No detection annotations should be created for 'ready_to_annotate' stage"
