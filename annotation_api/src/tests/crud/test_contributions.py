# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

import pytest
from datetime import datetime, UTC
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy import select

from app.crud import SequenceAnnotationCRUD, DetectionAnnotationCRUD
from app.models import (
    User, 
    SequenceAnnotationContribution,
    DetectionAnnotationContribution,
    SequenceAnnotationProcessingStage,
    DetectionAnnotationProcessingStage,
)
from app.schemas.sequence_annotations import SequenceAnnotationCreate, SequenceAnnotationUpdate
from app.schemas.detection_annotations import DetectionAnnotationCreate, DetectionAnnotationUpdate


@pytest.fixture
async def second_user(async_session: AsyncSession) -> User:
    """Create a second test user."""
    user = User(
        username="seconduser",
        email="second@example.com",
        hashed_password="hashed_password_456",
        is_active=True,
        is_superuser=False,
    )
    async_session.add(user)
    await async_session.commit()
    await async_session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_sequence_annotation_contribution_tracking(
    sequence_session: AsyncSession, regular_user: User
):
    """Test that sequence annotation contributions are tracked properly."""
    crud = SequenceAnnotationCRUD(sequence_session)
    
    annotation_data = SequenceAnnotationCreate(
        sequence_id=1,  # Use sequence from SEQ_TABLE
        has_missed_smoke=False,
        annotation={
            "sequences_bbox": [{
                "is_smoke": True,
                "false_positive_types": [],
                "bboxes": []
            }]
        },
        processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
    )
    
    # Create annotation
    annotation = await crud.create(annotation_data, regular_user.id)
    
    # Check that contribution was recorded
    query = select(SequenceAnnotationContribution).where(
        SequenceAnnotationContribution.sequence_annotation_id == annotation.id,
        SequenceAnnotationContribution.user_id == regular_user.id
    )
    result = await sequence_session.execute(query)
    contributions = result.scalars().all()
    
    assert len(contributions) == 1
    assert contributions[0].sequence_annotation_id == annotation.id
    assert contributions[0].user_id == regular_user.id
    assert contributions[0].contributed_at is not None


@pytest.mark.asyncio
async def test_detection_annotation_contribution_tracking(
    detection_session: AsyncSession, regular_user: User
):
    """Test that detection annotation contributions are tracked properly."""
    crud = DetectionAnnotationCRUD(detection_session)
    
    annotation_data = DetectionAnnotationCreate(
        detection_id=1,  # Use detection from DET_TABLE
        annotation={"annotation": []},
        processing_stage=DetectionAnnotationProcessingStage.VISUAL_CHECK
    )
    
    # Create annotation
    annotation = await crud.create(annotation_data, regular_user.id)
    
    # Check that contribution was recorded
    query = select(DetectionAnnotationContribution).where(
        DetectionAnnotationContribution.detection_annotation_id == annotation.id,
        DetectionAnnotationContribution.user_id == regular_user.id
    )
    result = await detection_session.execute(query)
    contributions = result.scalars().all()
    
    assert len(contributions) == 1
    assert contributions[0].detection_annotation_id == annotation.id
    assert contributions[0].user_id == regular_user.id
    assert contributions[0].contributed_at is not None


@pytest.mark.asyncio
async def test_sequence_annotation_update_contribution_tracking(
    sequence_session: AsyncSession, regular_user: User, second_user: User
):
    """Test that updating sequence annotations records contributions."""
    crud = SequenceAnnotationCRUD(sequence_session)
    
    # Create annotation with first user
    annotation_data = SequenceAnnotationCreate(
        sequence_id=1,
        has_missed_smoke=False,
        annotation={
            "sequences_bbox": [{
                "is_smoke": True,
                "false_positive_types": [],
                "bboxes": []
            }]
        },
        processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
    )
    annotation = await crud.create(annotation_data, regular_user.id)
    
    # Update annotation with second user
    update_data = SequenceAnnotationUpdate(
        processing_stage=SequenceAnnotationProcessingStage.ANNOTATED
    )
    await crud.update(annotation.id, update_data, second_user.id)
    
    # Check that both users have contributions
    query = select(SequenceAnnotationContribution).where(
        SequenceAnnotationContribution.sequence_annotation_id == annotation.id
    )
    result = await sequence_session.execute(query)
    contributions = result.scalars().all()
    
    assert len(contributions) == 2
    user_ids = {contrib.user_id for contrib in contributions}
    assert user_ids == {regular_user.id, second_user.id}


@pytest.mark.asyncio
async def test_sequence_annotation_get_contributors(
    sequence_session: AsyncSession, regular_user: User, second_user: User
):
    """Test getting contributors for sequence annotations."""
    crud = SequenceAnnotationCRUD(sequence_session)
    
    # Create and update annotation with different users
    annotation_data = SequenceAnnotationCreate(
        sequence_id=1,
        has_missed_smoke=False,
        annotation={
            "sequences_bbox": [{
                "is_smoke": True,
                "false_positive_types": [],
                "bboxes": []
            }]
        },
        processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
    )
    annotation = await crud.create(annotation_data, regular_user.id)
    
    update_data = SequenceAnnotationUpdate(
        processing_stage=SequenceAnnotationProcessingStage.ANNOTATED
    )
    await crud.update(annotation.id, update_data, second_user.id)
    
    # Get contributors
    contributors = await crud.get_annotation_contributors(annotation.id)
    
    assert len(contributors) == 2
    contributor_usernames = {user.username for user in contributors}
    assert len(contributor_usernames) == 2  # Two different users


@pytest.mark.asyncio
async def test_sequence_annotation_cascade_delete(
    sequence_session: AsyncSession, regular_user: User
):
    """Test that sequence annotation contributions are cascade deleted."""
    crud = SequenceAnnotationCRUD(sequence_session)
    
    # Create annotation
    annotation_data = SequenceAnnotationCreate(
        sequence_id=1,
        has_missed_smoke=False,
        annotation={
            "sequences_bbox": [{
                "is_smoke": True,
                "false_positive_types": [],
                "bboxes": []
            }]
        },
        processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
    )
    annotation = await crud.create(annotation_data, regular_user.id)
    
    # Verify contribution exists
    query = select(SequenceAnnotationContribution).where(
        SequenceAnnotationContribution.sequence_annotation_id == annotation.id
    )
    result = await sequence_session.execute(query)
    contributions = result.scalars().all()
    assert len(contributions) == 1
    
    # Delete annotation
    await crud.delete(annotation.id)
    
    # Verify contribution is deleted (CASCADE)
    result = await sequence_session.execute(query)
    contributions = result.scalars().all()
    assert len(contributions) == 0


@pytest.mark.asyncio
async def test_user_contribution_count(
    sequence_session: AsyncSession, regular_user: User
):
    """Test getting user contribution count."""
    crud = SequenceAnnotationCRUD(sequence_session)
    
    # Create multiple annotations with the same user using different sequences
    for sequence_id in [1, 2]:  # Use available sequences from SEQ_TABLE
        annotation_data = SequenceAnnotationCreate(
            sequence_id=sequence_id,
            has_missed_smoke=False,
            annotation={
                "sequences_bbox": [{
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": []
                }]
            },
            processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
        )
        await crud.create(annotation_data, regular_user.id)
    
    # Check contribution count
    count = await crud.get_user_contribution_count(regular_user.id)
    assert count == 2