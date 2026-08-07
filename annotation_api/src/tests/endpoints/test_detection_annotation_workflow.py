"""
Tests for detection annotation auto-creation workflow.

This test module focuses on the critical detection annotation workflow that was fixed,
specifically testing:
1. Auto-creation of detection annotations for FP-only lanes marked 'annotated'
2. Correct annotation data structure: {"annotation": []} instead of {}
3. Validation that was causing 422 errors

The placeholder-seeding cases for smoke lanes (smoke → visual_check, missed
smoke → bbox_annotation, and the create → fill-in-boxes workflow built on
them) were retired with issue #346: a lane needing localization can no longer
reach ANNOTATED without its detection annotations already written, so there is
nothing to seed. See docs/specs/2026-08-07-annotated-entry-guard-design.md.
"""

import json
from datetime import datetime, UTC

import pytest
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

from app import models

now = datetime.now(UTC)


@pytest.mark.asyncio
async def test_auto_create_annotates_fp_only_sequences(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session,
    mock_img: bytes,
):
    """FP-only lanes are the one case that still seeds detection annotations.

    The smoke → visual_check and missed-smoke → bbox_annotation cases this test
    used to cover were retired with the placeholder-seeding model (issue #346,
    spec: 2026-08-07-annotated-entry-guard-design): a lane needing localization
    can no longer reach ANNOTATED without its detection annotations already
    written, so there is nothing left to seed for it.
    """

    # Test Case 1: has_missed_smoke=false AND has_false_positives=true AND has_smoke=false → annotated
    payload_annotated = {
        "sequence_id": 1,
        "has_missed_smoke": False,  # False
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,  # No smoke
                    "false_positive_types": [
                        models.FalsePositiveType.ANTENNA.value
                    ],  # Has false positives
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    response1 = await authenticated_client.post(
        "/annotations/sequences/", json=payload_annotated
    )
    assert response1.status_code == 201

    # Check the created detection annotation has annotated stage (false positive only sequences)
    detection_annotations_response = await authenticated_client.get(
        "/annotations/detections/"
    )
    detection_annotations = detection_annotations_response.json()["items"]
    detection_1_annotation = next(
        ann for ann in detection_annotations if ann["detection_id"] == 1
    )
    assert (
        detection_1_annotation["processing_stage"] == "annotated"
    ), "Should be annotated for false positive only sequences (no smoke, no missed smoke, has false positives)"

    # Verify annotations are empty for false positive only sequences
    annotations = detection_1_annotation["annotation"]["annotation"]
    assert (
        len(annotations) == 0
    ), "False positive only sequences should have empty annotations"


@pytest.mark.asyncio
async def test_detection_annotation_validation_requirements(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session,
    mock_img: bytes,
):
    """Test validation of detection annotation structure that was causing 422 errors."""

    # Create a detection first
    detection_payload = {
        "sequence_id": "1",
        "alert_api_id": "2001",
        "recorded_at": datetime.now(UTC).isoformat(),
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

    detection_response = await authenticated_client.post(
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
                        "smoke_type": "wildfire",
                    }
                ]
            }
        ),
        "processing_stage": "visual_check",
    }

    valid_response = await authenticated_client.post(
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
        "processing_stage": "visual_check",
    }

    # This should fail with validation error due to invalid structure
    invalid_response_empty = await authenticated_client.post(
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
                    "smoke_type": "wildfire",
                }
            ]
        },
        "processing_stage": "annotated",
    }

    invalid_update_response = await authenticated_client.patch(
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
                    "smoke_type": "wildfire",
                }
            ]
        },
        "processing_stage": "annotated",
    }

    invalid_bbox_response = await authenticated_client.patch(
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
        "processing_stage": "annotated",
    }

    invalid_smoke_response = await authenticated_client.patch(
        f"/annotations/detections/{detection_annotation_id}",
        json=invalid_smoke_type_payload,
    )
    assert (
        invalid_smoke_response.status_code == 422
    ), "Invalid smoke type should be rejected"


@pytest.mark.asyncio
async def test_auto_create_avoids_duplicate_detection_annotations(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, detection_session
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
                        "smoke_type": "wildfire",
                    }
                ]
            }
        ),
        "processing_stage": "visual_check",
    }

    manual_response = await authenticated_client.post(
        "/annotations/detections/", data=manual_payload
    )
    assert manual_response.status_code == 201
    existing_annotation_id = manual_response.json()["id"]

    # Step 2: Create a sequence annotation with processing_stage='annotated' (should trigger auto-creation).
    # An FP lane, because that is now the only kind that seeds anything: a
    # smoke lane cannot reach ANNOTATED without its detection annotations
    # already written, so it has nothing to duplicate (issue #346).
    sequence_annotation_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": False,
                    "false_positive_types": [models.FalsePositiveType.ANTENNA.value],
                    "bboxes": [
                        {
                            "detection_id": 1,
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        },  # Already has annotation
                        {
                            "detection_id": 2,
                            "xyxyn": [0.3, 0.3, 0.4, 0.4],
                        },  # No existing annotation
                    ],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": datetime.now(UTC).isoformat(),
    }

    seq_response = await authenticated_client.post(
        "/annotations/sequences/", json=sequence_annotation_payload
    )
    assert seq_response.status_code == 201

    # Step 3: Verify the existing annotation for detection_id=1 was not duplicated or modified
    get_existing_response = await authenticated_client.get(
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
    all_annotations_response = await authenticated_client.get(
        "/annotations/detections/"
    )
    all_annotations = all_annotations_response.json()["items"]

    detection_2_annotations = [
        ann for ann in all_annotations if ann["detection_id"] == 2
    ]
    assert (
        len(detection_2_annotations) == 1
    ), "Should create exactly one annotation for detection_id=2"

    detection_2_annotation = detection_2_annotations[0]
    # Reworked model: annotations are created empty (seeded at submit).
    assert detection_2_annotation["annotation"]["annotation"] == []
    # An FP lane's seeded rows are final content, so they land at `annotated`.
    assert detection_2_annotation["processing_stage"] == "annotated"


@pytest.mark.asyncio
async def test_no_auto_create_when_not_annotated_stage(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, detection_session
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
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,  # NOT annotated
        "created_at": datetime.now(UTC).isoformat(),
    }

    seq_response = await authenticated_client.post(
        "/annotations/sequences/", json=sequence_annotation_payload
    )
    assert seq_response.status_code == 201

    # Verify no detection annotations were created
    detection_annotations_response = await authenticated_client.get(
        "/annotations/detections/"
    )
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
                    "bboxes": [{"detection_id": 2, "xyxyn": [0.3, 0.3, 0.4, 0.4]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value,  # NOT annotated
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Delete the first annotation to create the second one for same sequence
    await authenticated_client.delete(
        f"/annotations/sequences/{seq_response.json()['id']}"
    )

    seq_response_2 = await authenticated_client.post(
        "/annotations/sequences/", json=sequence_annotation_payload_2
    )
    assert seq_response_2.status_code == 201

    # Verify still no detection annotations were created
    detection_annotations_response = await authenticated_client.get(
        "/annotations/detections/"
    )
    detection_annotations = detection_annotations_response.json()["items"]
    detection_2_annotations = [
        ann for ann in detection_annotations if ann["detection_id"] == 2
    ]
    assert (
        len(detection_2_annotations) == 0
    ), "No detection annotations should be created for 'ready_to_annotate' stage"
