# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

import pytest
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
from app.schemas.sequence_annotations import (
    SequenceAnnotationCreate,
    SequenceAnnotationUpdate,
)
from app.schemas.detection_annotations import (
    DetectionAnnotationCreate,
)


@pytest.fixture
async def second_user(async_session: AsyncSession) -> User:
    """Create a second test user."""
    user = User(
        username="seconduser",
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
    """Test that sequence annotation contributions are only tracked for annotated stage."""
    crud = SequenceAnnotationCRUD(sequence_session)

    # Test creating annotation in READY_TO_ANNOTATE stage - should NOT record contribution
    annotation_data = SequenceAnnotationCreate(
        sequence_id=1,  # Use sequence from SEQ_TABLE
        has_missed_smoke=False,
        annotation={
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": []}
            ]
        },
        processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
    )

    # Create annotation
    annotation = await crud.create(annotation_data, regular_user.id)

    # Check that NO contribution was recorded for non-annotated stage
    query = select(SequenceAnnotationContribution).where(
        SequenceAnnotationContribution.sequence_annotation_id == annotation.id,
        SequenceAnnotationContribution.user_id == regular_user.id,
    )
    result = await sequence_session.execute(query)
    contributions = result.scalars().all()
    assert len(contributions) == 0

    # Test creating annotation in ANNOTATED stage - should record contribution
    annotation_data_annotated = SequenceAnnotationCreate(
        sequence_id=2,  # Use different sequence
        has_missed_smoke=False,
        annotation={
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": []}
            ]
        },
        processing_stage=SequenceAnnotationProcessingStage.ANNOTATED,
    )

    # Create annotation in annotated stage
    annotation_annotated = await crud.create(annotation_data_annotated, regular_user.id)

    # Check that contribution WAS recorded for annotated stage
    query_annotated = select(SequenceAnnotationContribution).where(
        SequenceAnnotationContribution.sequence_annotation_id
        == annotation_annotated.id,
        SequenceAnnotationContribution.user_id == regular_user.id,
    )
    result = await sequence_session.execute(query_annotated)
    contributions = result.scalars().all()

    assert len(contributions) == 1
    assert contributions[0].sequence_annotation_id == annotation_annotated.id
    assert contributions[0].user_id == regular_user.id
    assert contributions[0].contributed_at is not None


@pytest.mark.asyncio
async def test_detection_annotation_contribution_tracking(
    detection_session: AsyncSession, regular_user: User
):
    """Test that detection annotation contributions are only tracked for annotated stage."""
    crud = DetectionAnnotationCRUD(detection_session)

    # Test creating annotation in VISUAL_CHECK stage - should NOT record contribution
    annotation_data = DetectionAnnotationCreate(
        detection_id=1,  # Use detection from DET_TABLE
        annotation={"annotation": []},
        processing_stage=DetectionAnnotationProcessingStage.VISUAL_CHECK,
    )

    # Create annotation
    annotation = await crud.create(annotation_data, regular_user.id)

    # Check that NO contribution was recorded for non-annotated stage
    query = select(DetectionAnnotationContribution).where(
        DetectionAnnotationContribution.detection_annotation_id == annotation.id,
        DetectionAnnotationContribution.user_id == regular_user.id,
    )
    result = await detection_session.execute(query)
    contributions = result.scalars().all()
    assert len(contributions) == 0

    # Test creating annotation in ANNOTATED stage - should record contribution
    annotation_data_annotated = DetectionAnnotationCreate(
        detection_id=2,  # Use different detection
        annotation={"annotation": []},
        processing_stage=DetectionAnnotationProcessingStage.ANNOTATED,
    )

    # Create annotation in annotated stage
    annotation_annotated = await crud.create(annotation_data_annotated, regular_user.id)

    # Check that contribution WAS recorded for annotated stage
    query_annotated = select(DetectionAnnotationContribution).where(
        DetectionAnnotationContribution.detection_annotation_id
        == annotation_annotated.id,
        DetectionAnnotationContribution.user_id == regular_user.id,
    )
    result = await detection_session.execute(query_annotated)
    contributions = result.scalars().all()

    assert len(contributions) == 1
    assert contributions[0].detection_annotation_id == annotation_annotated.id
    assert contributions[0].user_id == regular_user.id
    assert contributions[0].contributed_at is not None


@pytest.mark.asyncio
async def test_sequence_annotation_update_contribution_tracking(
    sequence_session: AsyncSession, regular_user: User, second_user: User
):
    """Test that updating sequence annotations only records contributions when moving to annotated stage."""
    crud = SequenceAnnotationCRUD(sequence_session)

    # Create annotation with first user in READY_TO_ANNOTATE stage (no contribution)
    annotation_data = SequenceAnnotationCreate(
        sequence_id=1,
        has_missed_smoke=False,
        annotation={
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": []}
            ]
        },
        processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
    )
    annotation = await crud.create(annotation_data, regular_user.id)

    # Update annotation to ANNOTATED stage with second user (should record contribution)
    update_data = SequenceAnnotationUpdate(
        processing_stage=SequenceAnnotationProcessingStage.ANNOTATED
    )
    await crud.update(annotation.id, update_data, second_user.id)

    # Check that only second user has contribution (the one who moved to annotated)
    query = select(SequenceAnnotationContribution).where(
        SequenceAnnotationContribution.sequence_annotation_id == annotation.id
    )
    result = await sequence_session.execute(query)
    contributions = result.scalars().all()

    assert len(contributions) == 1
    assert contributions[0].user_id == second_user.id


@pytest.mark.asyncio
async def test_sequence_annotation_get_contributors(
    sequence_session: AsyncSession, regular_user: User, second_user: User
):
    """Test getting contributors for sequence annotations."""
    crud = SequenceAnnotationCRUD(sequence_session)

    # Create annotation in READY_TO_ANNOTATE with first user (no contribution)
    annotation_data = SequenceAnnotationCreate(
        sequence_id=1,
        has_missed_smoke=False,
        annotation={
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": []}
            ]
        },
        processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
    )
    annotation = await crud.create(annotation_data, regular_user.id)

    # Update to ANNOTATED stage with second user (records contribution)
    update_data = SequenceAnnotationUpdate(
        processing_stage=SequenceAnnotationProcessingStage.ANNOTATED
    )
    await crud.update(annotation.id, update_data, second_user.id)

    # Update again while in ANNOTATED stage with first user (records contribution)
    update_data2 = SequenceAnnotationUpdate(
        has_missed_smoke=True  # Change some annotation data
    )
    await crud.update(annotation.id, update_data2, regular_user.id)

    # Get contributors - should have both users (second moved to annotated, first edited while annotated)
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

    # Create annotation in ANNOTATED stage to ensure contribution exists
    annotation_data = SequenceAnnotationCreate(
        sequence_id=1,
        has_missed_smoke=False,
        annotation={
            "sequences_bbox": [
                {"is_smoke": True, "false_positive_types": [], "bboxes": []}
            ]
        },
        processing_stage=SequenceAnnotationProcessingStage.ANNOTATED,
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

    # Create multiple annotations in ANNOTATED stage with the same user using different sequences
    for sequence_id in [1, 2]:  # Use available sequences from SEQ_TABLE
        annotation_data = SequenceAnnotationCreate(
            sequence_id=sequence_id,
            has_missed_smoke=False,
            annotation={
                "sequences_bbox": [
                    {"is_smoke": True, "false_positive_types": [], "bboxes": []}
                ]
            },
            processing_stage=SequenceAnnotationProcessingStage.ANNOTATED,
        )
        await crud.create(annotation_data, regular_user.id)

    # Check contribution count
    count = await crud.get_user_contribution_count(regular_user.id)
    assert count == 2
