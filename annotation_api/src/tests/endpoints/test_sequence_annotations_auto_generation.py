"""
Test suite for sequence annotation auto-generation functionality.

This module tests the automatic annotation generation feature in sequence annotation
endpoints when processing_stage=READY_TO_ANNOTATE and annotation is empty.
"""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient

from app.models import SequenceAnnotationProcessingStage
from app.schemas.annotation_validation import SequenceAnnotationData, SequenceBBox, BoundingBox


@pytest.mark.asyncio
async def test_create_sequence_annotation_triggers_auto_generation(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that creating annotation with READY_TO_ANNOTATE stage triggers auto-generation."""
    
    # Mock the auto_generate_annotation function to return test data
    mock_generated_annotation = SequenceAnnotationData(
        sequences_bbox=[
            SequenceBBox(
                is_smoke=True,
                false_positive_types=[],
                bboxes=[
                    BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.8, 0.9])
                ]
            )
        ]
    )
    
    with patch("app.api.api_v1.endpoints.sequence_annotations.auto_generate_annotation", return_value=mock_generated_annotation) as mock_auto_gen:
        
        # Create sequence annotation with empty annotation and READY_TO_ANNOTATE stage
        response = await authenticated_client.post(
            "/annotations/sequences/",
            json={
                "sequence_id": 1,
                "has_missed_smoke": False,
                "is_unsure": False,
                "annotation": {
                    "sequences_bbox": []  # Empty annotation should trigger auto-generation
                },
                "processing_stage": "ready_to_annotate",
                "confidence_threshold": 0.7,
                "iou_threshold": 0.4,
                "min_cluster_size": 2
            }
        )
        
        assert response.status_code == 201
        
        # Verify auto-generation was called with correct parameters
        mock_auto_gen.assert_called_once()
        call_args = mock_auto_gen.call_args
        assert call_args[1]["sequence_id"] == 1
        assert call_args[1]["confidence_threshold"] == 0.7
        assert call_args[1]["iou_threshold"] == 0.4
        assert call_args[1]["min_cluster_size"] == 2


@pytest.mark.asyncio
async def test_create_sequence_annotation_no_auto_generation_when_annotation_exists(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that auto-generation is not triggered when annotation already has content."""
    
    with patch("app.api.api_v1.endpoints.sequence_annotations.auto_generate_annotation") as mock_auto_gen:
        
        # Create sequence annotation with existing annotation content
        response = await authenticated_client.post(
            "/annotations/sequences/",
            json={
                "sequence_id": 1,
                "has_missed_smoke": False,
                "is_unsure": False,
                "annotation": {
                    "sequences_bbox": [
                        {
                            "is_smoke": True,
                            "false_positive_types": [],
                            "bboxes": [
                                {"detection_id": 1, "xyxyn": [0.1, 0.2, 0.8, 0.9]}
                            ]
                        }
                    ]
                },
                "processing_stage": "ready_to_annotate"
            }
        )
        
        assert response.status_code == 201
        
        # Verify auto-generation was NOT called since annotation already has content
        mock_auto_gen.assert_not_called()


@pytest.mark.asyncio
async def test_create_sequence_annotation_no_auto_generation_wrong_stage(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that auto-generation is not triggered for other processing stages."""
    
    with patch("app.api.api_v1.endpoints.sequence_annotations.auto_generate_annotation") as mock_auto_gen:
        
        # Create sequence annotation with different processing stage
        response = await authenticated_client.post(
            "/annotations/sequences/",
            json={
                "sequence_id": 1,
                "has_missed_smoke": False,
                "is_unsure": False,
                "annotation": {
                    "sequences_bbox": []  # Empty but wrong stage
                },
                "processing_stage": "imported"  # Not READY_TO_ANNOTATE
            }
        )
        
        assert response.status_code == 201
        
        # Verify auto-generation was NOT called for wrong processing stage
        mock_auto_gen.assert_not_called()


@pytest.mark.asyncio
async def test_auto_generation_uses_default_parameters(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that auto-generation uses default parameters when not specified."""
    
    mock_generated_annotation = SequenceAnnotationData(
        sequences_bbox=[
            SequenceBBox(
                is_smoke=True,
                false_positive_types=[],
                bboxes=[
                    BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.8, 0.9])
                ]
            )
        ]
    )
    
    with patch("app.api.api_v1.endpoints.sequence_annotations.auto_generate_annotation", return_value=mock_generated_annotation) as mock_auto_gen:
        
        # Create sequence annotation without specifying generation parameters
        response = await authenticated_client.post(
            "/annotations/sequences/",
            json={
                "sequence_id": 1,
                "has_missed_smoke": False,
                "is_unsure": False,
                "annotation": {
                    "sequences_bbox": []
                },
                "processing_stage": "ready_to_annotate"
                # No configuration parameters specified
            }
        )
        
        assert response.status_code == 201
        
        # Verify auto-generation was called with default parameters
        mock_auto_gen.assert_called_once()
        call_args = mock_auto_gen.call_args
        assert call_args[1]["confidence_threshold"] == 0.5  # Default
        assert call_args[1]["iou_threshold"] == 0.3  # Default
        assert call_args[1]["min_cluster_size"] == 1  # Default


@pytest.mark.asyncio
async def test_auto_generation_failure_handling(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    """Test that annotation creation continues even if auto-generation fails."""
    
    with patch("app.api.api_v1.endpoints.sequence_annotations.auto_generate_annotation", return_value=None) as mock_auto_gen:
        
        # Create sequence annotation with auto-generation that fails
        response = await authenticated_client.post(
            "/annotations/sequences/",
            json={
                "sequence_id": 1,
                "has_missed_smoke": False,
                "is_unsure": False,
                "annotation": {
                    "sequences_bbox": []
                },
                "processing_stage": "ready_to_annotate"
            }
        )
        
        # Should still create the annotation successfully even if auto-generation fails
        assert response.status_code == 201
        
        # Verify auto-generation was attempted
        mock_auto_gen.assert_called_once()
        
        # Response should contain the original empty annotation since generation failed
        response_data = response.json()
        assert response_data["annotation"]["sequences_bbox"] == []


@pytest.mark.asyncio
async def test_should_trigger_auto_generation_logic():
    """Test the should_trigger_auto_generation helper function logic."""
    
    from app.api.api_v1.endpoints.sequence_annotations import should_trigger_auto_generation
    
    # Should trigger: READY_TO_ANNOTATE with empty annotation
    empty_annotation = SequenceAnnotationData(sequences_bbox=[])
    assert should_trigger_auto_generation(SequenceAnnotationProcessingStage.READY_TO_ANNOTATE, empty_annotation) == True
    
    # Should NOT trigger: READY_TO_ANNOTATE with existing annotation
    filled_annotation = SequenceAnnotationData(
        sequences_bbox=[
            SequenceBBox(
                is_smoke=True,
                false_positive_types=[],
                bboxes=[BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.8, 0.9])]
            )
        ]
    )
    assert should_trigger_auto_generation(SequenceAnnotationProcessingStage.READY_TO_ANNOTATE, filled_annotation) == False
    
    # Should NOT trigger: Wrong processing stage even with empty annotation
    assert should_trigger_auto_generation(SequenceAnnotationProcessingStage.IMPORTED, empty_annotation) == False
    assert should_trigger_auto_generation(SequenceAnnotationProcessingStage.ANNOTATED, empty_annotation) == False
    
    # Should trigger: READY_TO_ANNOTATE with None annotation
    assert should_trigger_auto_generation(SequenceAnnotationProcessingStage.READY_TO_ANNOTATE, None) == True