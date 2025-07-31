# Copyright (C) 2025, Pyronear.

import json
from datetime import datetime
from typing import List

from fastapi import (
    APIRouter,
    Body,
    Depends,
    Path,
    status,
)

from app.api.dependencies import get_sequence_annotation_crud
from app.crud import SequenceAnnotationCRUD
from app.schemas.annotation_validation import SequenceAnnotationData
from app.schemas.sequence_annotations import (
    SequenceAnnotationCreate,
    SequenceAnnotationRead,
    SequenceAnnotationUpdate,
)

router = APIRouter()


def derive_has_smoke(annotation_data: SequenceAnnotationData) -> bool:
    """Derive has_smoke from annotation data."""
    return any(bbox.is_smoke for bbox in annotation_data.sequences_bbox)


def derive_has_false_positives(annotation_data: SequenceAnnotationData) -> bool:
    """Derive has_false_positives from annotation data."""
    return any(bbox.false_positive_types for bbox in annotation_data.sequences_bbox)


def derive_false_positive_types(annotation_data: SequenceAnnotationData) -> str:
    """Derive false_positive_types from annotation data as a JSON string."""
    all_types = []
    for bbox in annotation_data.sequences_bbox:
        all_types.extend([fp_type.value for fp_type in bbox.false_positive_types])
    # Remove duplicates while preserving order
    unique_types = list(dict.fromkeys(all_types))
    return json.dumps(unique_types)


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_sequence_annotation(
    create_data: SequenceAnnotationCreate = Body(...),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> SequenceAnnotationRead:
    # Derive values from annotation data
    has_smoke = derive_has_smoke(create_data.annotation)
    has_false_positives = derive_has_false_positives(create_data.annotation)
    false_positive_types = derive_false_positive_types(create_data.annotation)

    # Create database model with derived values
    from app.models import SequenceAnnotation

    sequence_annotation = SequenceAnnotation(
        sequence_id=create_data.sequence_id,
        has_smoke=has_smoke,
        has_false_positives=has_false_positives,
        false_positive_types=false_positive_types,
        has_missed_smoke=create_data.has_missed_smoke,
        annotation=create_data.annotation.model_dump(),
        processing_stage=create_data.processing_stage,
        created_at=create_data.created_at,
    )

    # Add and commit directly
    annotations.session.add(sequence_annotation)
    await annotations.session.commit()
    await annotations.session.refresh(sequence_annotation)

    return sequence_annotation


@router.get("/")
async def list_sequence_annotations(
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> List[SequenceAnnotationRead]:
    return await annotations.fetch_all()


@router.get("/{annotation_id}")
async def get_sequence_annotation(
    annotation_id: int = Path(..., gt=0),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> SequenceAnnotationRead:
    return await annotations.get(annotation_id, strict=True)


@router.patch("/{annotation_id}")
async def update_sequence_annotation(
    annotation_id: int = Path(..., gt=0),
    payload: SequenceAnnotationUpdate = Body(...),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> SequenceAnnotationRead:
    # Get existing annotation
    existing = await annotations.get(annotation_id, strict=True)

    # Start with existing data
    update_dict = {"updated_at": datetime.utcnow()}

    # If annotation is being updated, derive new values
    if payload.annotation is not None:
        update_dict.update(
            {
                "has_smoke": derive_has_smoke(payload.annotation),
                "has_false_positives": derive_has_false_positives(payload.annotation),
                "false_positive_types": derive_false_positive_types(payload.annotation),
                "annotation": payload.annotation.model_dump(),
            }
        )

    # Add other updateable fields
    if payload.has_missed_smoke is not None:
        update_dict["has_missed_smoke"] = payload.has_missed_smoke
    if payload.processing_stage is not None:
        update_dict["processing_stage"] = payload.processing_stage

    # Update the model
    for key, value in update_dict.items():
        setattr(existing, key, value)

    await annotations.session.commit()
    await annotations.session.refresh(existing)

    return existing


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sequence_annotation(
    annotation_id: int = Path(..., gt=0),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> None:
    await annotations.delete(annotation_id)
