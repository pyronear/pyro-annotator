# Copyright (C) 2025, Pyronear.

import json
from datetime import datetime
from typing import List

from fastapi import APIRouter, Body, Depends, Form, HTTPException, Path, status
from pydantic import ValidationError

from app.api.dependencies import get_detection_annotation_crud
from app.crud import DetectionAnnotationCRUD
from app.models import DetectionAnnotationProcessingStage
from app.schemas.detection_annotations import (
    DetectionAnnotationCreate,
    DetectionAnnotationRead,
    DetectionAnnotationUpdate,
)
from app.schemas.annotation_validation import DetectionAnnotationData

router = APIRouter()


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_detection_annotation(
    detection_id: int = Form(...),
    annotation: str = Form(..., description="JSON string of annotation object"),
    processing_stages: DetectionAnnotationProcessingStage = Form(
        ..., description="Processing stage for annotation"
    ),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
) -> DetectionAnnotationRead:
    # Parse and validate annotation
    parsed_annotation = json.loads(annotation)
    
    try:
        validated_annotation = DetectionAnnotationData(**parsed_annotation)
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid annotation format: {e.errors()}"
        )
    
    # Create database model with validated data
    from app.models import DetectionAnnotation
    detection_annotation = DetectionAnnotation(
        detection_id=detection_id,
        annotation=validated_annotation.model_dump(),
        processing_stages=processing_stages,
        created_at=datetime.utcnow(),
    )
    
    # Add and commit directly
    annotations.session.add(detection_annotation)
    await annotations.session.commit()
    await annotations.session.refresh(detection_annotation)
    
    return detection_annotation


@router.get("/")
async def list_annotations(
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
) -> List[DetectionAnnotationRead]:
    return await annotations.fetch_all()


@router.get("/{annotation_id}")
async def get_annotation(
    annotation_id: int = Path(..., gt=0),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
) -> DetectionAnnotationRead:
    return await annotations.get(annotation_id, strict=True)


@router.patch("/{annotation_id}")
async def update_annotation(
    annotation_id: int = Path(..., gt=0),
    payload: DetectionAnnotationUpdate = Body(...),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
) -> DetectionAnnotationRead:
    # Get existing annotation
    existing = await annotations.get(annotation_id, strict=True)
    
    # Start with existing data
    update_dict = {"updated_at": datetime.utcnow()}
    
    # If annotation is being updated, validate it
    if payload.annotation is not None:
        update_dict.update({
            "annotation": payload.annotation.model_dump(),
        })
    
    # Add other updateable fields
    if payload.processing_stages is not None:
        update_dict["processing_stages"] = payload.processing_stages
    
    # Update the model
    for key, value in update_dict.items():
        setattr(existing, key, value)
    
    await annotations.session.commit()
    await annotations.session.refresh(existing)
    
    return existing


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: int = Path(..., gt=0),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
) -> None:
    await annotations.delete(annotation_id)
