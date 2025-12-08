"""
Annotation management utilities for annotation API interactions.

This module handles interactions with the annotation API including checking for existing
annotations, creating new annotations with server-side auto-generation, and updating
annotations using the simplified API-based workflow.

Functions:
    check_existing_annotation: Check if a sequence already has an annotation
    create_annotation_from_data: Create or update a sequence annotation
    create_simple_sequence_annotation: Create annotation with server-side auto-generation
    valid_date: Datetime parser for CLI arguments

Example:
    >>> from annotation_management import create_simple_sequence_annotation
    >>>
    >>> config = {
    ...     "confidence_threshold": 0.0,
    ...     "iou_threshold": 0.3,
    ...     "min_cluster_size": 1
    ... }
    >>> result = create_simple_sequence_annotation(
    ...     sequence_id=123,
    ...     annotation_api_url="http://localhost:5050",
    ...     config=config,
    ...     dry_run=False
    ... )
    >>> if result["annotation_created"]:
    ...     print("Annotation created with server-side auto-generation!")
"""

import argparse
import logging
from datetime import date, datetime
from typing import Dict, Any, Optional

from . import shared
from app.clients.annotation_api import (
    get_auth_token,
    list_sequence_annotations,
    create_sequence_annotation,
    update_sequence_annotation,
)
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


def check_existing_annotation(base_url: str, sequence_id: int) -> Optional[int]:
    """
    Check if a sequence already has an annotation.

    Args:
        base_url: Base URL of the annotation API
        sequence_id: ID of the sequence to check

    Returns:
        Annotation ID if found, None if no annotation exists

    Example:
        >>> annotation_id = check_existing_annotation("http://localhost:5050", 123)
        >>> if annotation_id:
        ...     print(f"Found existing annotation with ID: {annotation_id}")
        >>> else:
        ...     print("No existing annotation found")
    """
    try:
        # Get authentication token
        login, password = shared.get_annotation_credentials(base_url)
        auth_token = get_auth_token(base_url, login, password)
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
        ...     dry_run=False,
        ...     processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
        ... )
        >>>
        >>> # Update existing annotation
        >>> success = create_annotation_from_data(
        ...     base_url="http://localhost:5050",
        ...     sequence_id=123,
        ...     annotation_data=updated_data,
        ...     existing_annotation_id=456,
        ...     dry_run=False
        ... )
    """
    try:
        # Get authentication token
        login, password = shared.get_annotation_credentials(base_url)
        auth_token = get_auth_token(base_url, login, password)

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
                        "iou_threshold": config.get("iou_threshold", 0.3),
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
                        "iou_threshold": config.get("iou_threshold", 0.3),
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


def create_simple_sequence_annotation(
    sequence_id: int,
    annotation_api_url: str,
    config: Dict[str, Any],
    dry_run: bool = False,
    processing_stage: SequenceAnnotationProcessingStage = SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
) -> Dict[str, Any]:
    """
    Create a simple sequence annotation with auto-generation enabled.

    This simplified function creates a sequence annotation with READY_TO_ANNOTATE stage
    and empty annotation content, allowing the API to automatically generate the annotation
    content server-side using the provided configuration parameters.

    Args:
        sequence_id: Sequence ID to process
        annotation_api_url: Annotation API base URL
        config: Configuration parameters for auto-generation including:
                - confidence_threshold: float
                - iou_threshold: float
                - min_cluster_size: int
        dry_run: If True, preview actions without executing them

    Returns:
        Dictionary with processing results:
        - sequence_id: The processed sequence ID
        - annotation_created: Whether annotation was successfully created/updated
        - annotation_id: ID of created/updated annotation ("new" for new annotations)
        - errors: List of error messages if any occurred
        - final_stage: Processing stage set for the annotation

    Example:
        >>> config = {
        ...     "confidence_threshold": 0.7,
        ...     "iou_threshold": 0.3,
        ...     "min_cluster_size": 2
        ... }
        >>> result = create_simple_sequence_annotation(
        ...     sequence_id=123,
        ...     annotation_api_url="http://localhost:5050",
        ...     config=config,
        ...     dry_run=False
        ... )
        >>>
        >>> if result["annotation_created"]:
        ...     print(f"Successfully processed sequence {result['sequence_id']}")
        >>> else:
        ...     print(f"Failed to process sequence: {result['errors']}")
    """
    result = {
        "sequence_id": sequence_id,
        "annotation_created": False,
        "annotation_id": None,
        "errors": [],
        "final_stage": None,
    }

    try:
        logging.info(f"Creating sequence annotation for sequence {sequence_id}")

        # Check for existing annotation
        existing_annotation_id = check_existing_annotation(
            annotation_api_url, sequence_id
        )

        # Create empty annotation data (will be auto-generated by API)
        empty_annotation_data = SequenceAnnotationData(sequences_bbox=[])

        # Create annotation with auto-generation parameters
        if create_annotation_from_data(
            annotation_api_url,
            sequence_id,
            empty_annotation_data,
            dry_run,
            existing_annotation_id,
            processing_stage,
            config,  # Pass config for auto-generation
        ):
            result["annotation_created"] = True
            result["annotation_id"] = (
                existing_annotation_id if existing_annotation_id else "new"
            )
            result["final_stage"] = (
                SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value
            )
            logging.info(
                f"Successfully created sequence annotation for sequence {sequence_id} - auto-generation enabled"
            )
            return result
        else:
            error_msg = f"Failed to create annotation for sequence {sequence_id}"
            logging.error(error_msg)
            result["errors"].append(error_msg)
            return result

    except Exception as e:
        error_msg = f"Unexpected error processing sequence {sequence_id}: {e}"
        logging.error(error_msg)
        result["errors"].append(error_msg)
        return result


def create_placeholder_sequence_annotation(
    sequence_id: int,
    annotation_api_url: str,
    processing_stage: SequenceAnnotationProcessingStage,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Create an empty sequence annotation with a specific processing stage (no auto-generation).
    """
    result = {
        "sequence_id": sequence_id,
        "annotation_created": False,
        "annotation_id": None,
        "errors": [],
        "final_stage": None,
    }

    try:
        existing_annotation_id = check_existing_annotation(annotation_api_url, sequence_id)
        empty_annotation_data = SequenceAnnotationData(sequences_bbox=[])

        if create_annotation_from_data(
            annotation_api_url,
            sequence_id,
            empty_annotation_data,
            dry_run,
            existing_annotation_id,
            processing_stage,
            config=None,
        ):
            result["annotation_created"] = True
            result["annotation_id"] = (
                existing_annotation_id if existing_annotation_id else "new"
            )
            result["final_stage"] = processing_stage.value
            logging.info(
                f"Created placeholder sequence annotation for sequence {sequence_id} "
                f"with stage {processing_stage.value}"
            )
        else:
            error_msg = f"Failed to create placeholder annotation for sequence {sequence_id}"
            logging.error(error_msg)
            result["errors"].append(error_msg)
        return result
    except Exception as e:
        error_msg = f"Unexpected error processing sequence {sequence_id}: {e}"
        logging.error(error_msg)
        result["errors"].append(error_msg)
        return result
