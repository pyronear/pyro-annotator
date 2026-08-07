"""
Annotation management utilities for annotation API interactions.

This module handles interactions with the annotation API including checking for existing
annotations, creating new annotations with server-side auto-generation, and updating
annotations using the simplified API-based workflow.

Functions:
    check_existing_annotation: Check if a sequence already has an annotation
    create_annotation_from_data: Create or update a sequence annotation
    annotate_split_sequence: Write the single-track annotation for one imported object sequence
    valid_date: Datetime parser for CLI arguments
"""

import argparse
import logging
from datetime import date, datetime
from typing import Dict, Any, Optional

from app.clients.annotation_api import (
    list_sequence_annotations,
    create_sequence_annotation,
    update_sequence_annotation,
    delete_sequence,
)
from .object_split import build_single_track_annotation
from app.models import SequenceAnnotationProcessingStage
from app.schemas.annotation_validation import SequenceAnnotationData


def valid_date(s: str) -> date:
    """
    Datetime parser for CLI argument validation.

    Converts a string in YYYY-MM-DD format to a date object.

    Args:
        s: Date string in YYYY-MM-DD format

    Returns:
        date object

    Raises:
        argparse.ArgumentTypeError: If the string is not a valid date

    Example:
        >>> date_obj = valid_date("2024-01-15")
        >>> print(date_obj)
        2024-01-15
        >>> valid_date("invalid")  # Raises ArgumentTypeError
    """
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        msg = "not a valid date: {0!r}".format(s)
        raise argparse.ArgumentTypeError(msg)


def check_existing_annotation(
    base_url: str, sequence_id: int, auth_token: str
) -> Optional[int]:
    """
    Check if a sequence already has an annotation.

    Args:
        base_url: Base URL of the annotation API
        sequence_id: ID of the sequence to check
        auth_token: JWT held by the caller. This stage never mints its own —
            a login costs ~143ms of bcrypt on the API's single event loop,
            and it was previously paid once per sequence here.

    Returns:
        Annotation ID if found, None if no annotation exists

    Example:
        >>> annotation_id = check_existing_annotation(
        ...     "http://localhost:5050", 123, auth_token
        ... )
        >>> if annotation_id:
        ...     print(f"Found existing annotation with ID: {annotation_id}")
        >>> else:
        ...     print("No existing annotation found")
    """
    try:
        response = list_sequence_annotations(
            base_url, auth_token, sequence_id=sequence_id
        )

        if isinstance(response, dict) and "items" in response:
            annotations = response["items"]
        else:
            annotations = response

        if len(annotations) > 0:
            return annotations[0]["id"]
        return None

    except Exception as e:
        logging.debug(
            f"Error checking existing annotation for sequence {sequence_id}: {e}"
        )
        return None


def create_annotation_from_data(
    base_url: str,
    sequence_id: int,
    annotation_data: SequenceAnnotationData,
    auth_token: str,
    dry_run: bool = False,
    existing_annotation_id: Optional[int] = None,
    processing_stage: SequenceAnnotationProcessingStage = SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
    config: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Create or update a sequence annotation from analyzed data.

    This function handles both creating new annotations and updating existing ones
    based on whether an existing annotation ID is provided.

    Args:
        base_url: Base URL of the annotation API
        sequence_id: ID of the sequence to annotate
        annotation_data: SequenceAnnotationData containing the annotation
        auth_token: JWT held by the caller. This stage never mints its own —
            a login costs ~143ms of bcrypt on the API's single event loop,
            and it was previously paid once per sequence here.
        dry_run: If True, only log what would be done without making changes
        existing_annotation_id: ID of existing annotation to update (None to create new)
        processing_stage: Processing stage to set for the annotation

    Returns:
        True if annotation was created/updated successfully, False otherwise

    Example:
        >>> from app.schemas.annotation_validation import SequenceAnnotationData
        >>> from app.models import SequenceAnnotationProcessingStage
        >>>
        >>> # Create new annotation
        >>> success = create_annotation_from_data(
        ...     base_url="http://localhost:5050",
        ...     sequence_id=123,
        ...     annotation_data=annotation_data,
        ...     auth_token=auth_token,
        ...     dry_run=False,
        ...     processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
        ... )
        >>>
        >>> # Update existing annotation
        >>> success = create_annotation_from_data(
        ...     base_url="http://localhost:5050",
        ...     sequence_id=123,
        ...     annotation_data=updated_data,
        ...     auth_token=auth_token,
        ...     existing_annotation_id=456,
        ...     dry_run=False
        ... )
    """
    try:
        if existing_annotation_id:
            # Update existing annotation (PATCH)
            update_dict = {
                "annotation": annotation_data.model_dump(),
                "processing_stage": processing_stage.value,
                "has_missed_smoke": False,
            }

            # Add configuration parameters for auto-generation if provided
            if config:
                update_dict.update(
                    {
                        "confidence_threshold": config.get("confidence_threshold", 0.0),
                        "iou_threshold": config.get("iou_threshold", 0.0),
                        "min_cluster_size": config.get("min_cluster_size", 1),
                    }
                )

            if dry_run:
                logging.info(
                    f"DRY RUN: Would update annotation {existing_annotation_id} for sequence {sequence_id}"
                )
                logging.debug(f"Update data: {update_dict}")
                return True

            result = update_sequence_annotation(
                base_url, auth_token, existing_annotation_id, update_dict
            )
            if result:
                logging.debug(
                    f"Successfully updated annotation {existing_annotation_id} for sequence {sequence_id}"
                )
                return True
            else:
                logging.error(
                    f"Failed to update annotation {existing_annotation_id} for sequence {sequence_id}"
                )
                return False

        else:
            # Create new annotation (POST)
            create_dict = {
                "sequence_id": sequence_id,
                "annotation": annotation_data.model_dump(),
                "processing_stage": processing_stage.value,
                "has_missed_smoke": False,
                "has_smoke": False,
                "has_false_positives": False,
                "false_positive_types": [],
                "smoke_types": [],
                "is_unsure": False,
            }

            # Add configuration parameters for auto-generation if provided
            if config:
                create_dict.update(
                    {
                        "confidence_threshold": config.get("confidence_threshold", 0.0),
                        "iou_threshold": config.get("iou_threshold", 0.0),
                        "min_cluster_size": config.get("min_cluster_size", 1),
                    }
                )

            if dry_run:
                logging.info(
                    f"DRY RUN: Would create new annotation for sequence {sequence_id}"
                )
                logging.debug(f"Create data: {create_dict}")
                return True

            result = create_sequence_annotation(base_url, auth_token, create_dict)
            if result:
                logging.debug(
                    f"Successfully created annotation for sequence {sequence_id}"
                )
                return True
            else:
                logging.error(f"Failed to create annotation for sequence {sequence_id}")
                return False

    except Exception as e:
        logging.error(
            f"Error creating/updating annotation for sequence {sequence_id}: {e}"
        )
        return False


def _rollback_sequence(
    sequence_id: int, annotation_api_url: str, auth_token: str
) -> None:
    """Delete a sequence as part of the `annotate_split_sequence` rollback path."""
    try:
        delete_sequence(annotation_api_url, auth_token, sequence_id)
    except Exception as exc:
        logging.warning(f"Rollback delete of sequence {sequence_id} failed: {exc}")


def annotate_split_sequence(
    seq_result: Dict[str, Any],
    annotation_api_url: str,
    auth_token: str,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Write the single-track annotation for one imported object sequence.

    If the object's detections were only partially imported, or if writing
    the annotation fails outright, delete the sequence instead (a
    half-imported or annotation-less object would 409 on the next run and
    never be completed), and report the rollback as an error.

    `auth_token` is the token the posting stage already holds. This stage runs
    once per object lane, so minting one here cost two ~143ms bcrypt logins per
    lane, serialized on the API's single event loop.
    """
    sequence_id = seq_result["sequence_id"]
    result: Dict[str, Any] = {
        "sequence_id": sequence_id,
        "annotation_created": False,
        "annotation_id": None,
        "errors": [],
        "final_stage": None,
    }

    if seq_result["failed_detections"] > 0:
        _rollback_sequence(sequence_id, annotation_api_url, auth_token)
        result["errors"].append(
            f"sequence {sequence_id} rolled back: "
            f"{seq_result['failed_detections']}/{seq_result['total_detections']} detections failed"
        )
        return result

    try:
        annotation_data = build_single_track_annotation(
            seq_result.get("detection_results", [])
        )
        existing_annotation_id = check_existing_annotation(
            annotation_api_url, sequence_id, auth_token
        )
        if create_annotation_from_data(
            annotation_api_url,
            sequence_id,
            annotation_data,
            auth_token,
            dry_run,
            existing_annotation_id,
            SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
            config=None,
        ):
            result["annotation_created"] = True
            result["annotation_id"] = (
                existing_annotation_id if existing_annotation_id else "new"
            )
            result["final_stage"] = (
                SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value
            )
        else:
            if not dry_run:
                _rollback_sequence(sequence_id, annotation_api_url, auth_token)
            result["errors"].append(
                f"sequence {sequence_id} rolled back: failed to create annotation"
            )
    except Exception as exc:
        if not dry_run:
            _rollback_sequence(sequence_id, annotation_api_url, auth_token)
        result["errors"].append(
            f"sequence {sequence_id} rolled back: unexpected error building annotation: {exc}"
        )
    return result
