"""
CLI script to generate sequence annotations from AI predictions.

This script analyzes sequences and their detections to automatically generate
sequence annotations by clustering overlapping bounding boxes across temporal frames.
The generated annotations are marked with the specified processing stage (default: ready_to_annotate).

Usage:
  # Generate annotation for a single sequence
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --sequence-id 123 --loglevel info

  # Generate annotations for multiple specific sequences
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --sequence-ids 123,456,789 --loglevel info

  # Generate annotations for sequences in a date range
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info

  # Generate annotations for ALL sequences without annotations
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --all-without-annotations --loglevel info

  # Preview annotations without creating them (dry run)
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --sequence-id 123 --dry-run --loglevel debug

Arguments:
  --url-api-annotation (url): Annotation API base URL (default: http://localhost:5050)
  --sequence-id (int): Single sequence ID to process
  --sequence-ids (str): Comma-separated list of sequence IDs to process
  --date-from (date): Start date for sequence range (YYYY-MM-DD format)
  --date-end (date): End date for sequence range (YYYY-MM-DD format)
  --all-without-annotations: Process all sequences that do not have annotations yet
  --confidence-threshold (float): Minimum AI prediction confidence (default: 0.5)
  --iou-threshold (float): Minimum IoU for clustering overlapping boxes (default: 0.3)
  --min-cluster-size (int): Minimum boxes required in a cluster (default: 1)
  --dry-run: Preview annotations without creating them
  --force: Overwrite existing annotations (default: skip existing)
  --loglevel (str): Logging level (debug/info/warning/error, default: info)

Examples:
  # Basic usage - single sequence
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --sequence-id 123

  # Process all sequences without annotations
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --all-without-annotations

  # High confidence predictions only
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --sequence-id 123 --confidence-threshold 0.8

  # Process ALL predictions (no confidence filtering)
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --sequence-id 123 --confidence-threshold 0

  # Stricter clustering (higher IoU threshold)
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --sequence-id 123 --iou-threshold 0.5

  # Require multiple detections per cluster
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --sequence-id 123 --min-cluster-size 3

  # Test mode - see what would be generated
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations --sequence-id 123 --dry-run --loglevel debug
"""

import argparse
import logging
import sys
from datetime import date, datetime
from typing import List, Optional

from tqdm import tqdm

from app.clients.annotation_api import (
    ValidationError,
    create_sequence_annotation,
    update_sequence_annotation,
    list_sequences,
    list_sequence_annotations,
)
from app.models import SequenceAnnotationProcessingStage

from .sequence_analyzer import SequenceAnalyzer


def valid_date(s: str) -> date:
    """
    Datetime parser for the CLI.
    """
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        msg = f"not a valid date: {s!r}"
        raise argparse.ArgumentTypeError(msg)


def parse_sequence_ids(s: str) -> List[int]:
    """
    Parse comma-separated sequence IDs.
    """
    try:
        return [int(x.strip()) for x in s.split(",") if x.strip()]
    except ValueError:
        msg = f"invalid sequence IDs format: {s!r}. Expected comma-separated integers."
        raise argparse.ArgumentTypeError(msg)


def make_cli_parser() -> argparse.ArgumentParser:
    """
    Create the CLI argument parser.
    """
    parser = argparse.ArgumentParser(
        description="Generate sequence annotations from AI predictions",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Arguments:")[0].split("Usage:")[1].strip(),
    )

    # API configuration
    parser.add_argument(
        "--url-api-annotation",
        help="Annotation API base URL",
        type=str,
        default="http://localhost:5050",
    )

    # Sequence selection (mutually exclusive group)
    sequence_group = parser.add_mutually_exclusive_group(required=True)
    sequence_group.add_argument(
        "--sequence-id",
        help="Single sequence ID to process",
        type=int,
    )
    sequence_group.add_argument(
        "--sequence-ids",
        help="Comma-separated list of sequence IDs to process",
        type=parse_sequence_ids,
    )
    sequence_group.add_argument(
        "--date-from",
        help="Start date for sequence range (YYYY-MM-DD format)",
        type=valid_date,
    )
    sequence_group.add_argument(
        "--all-without-annotations",
        action="store_true",
        help="Process all sequences that do not have annotations yet",
    )
    parser.add_argument(
        "--date-end",
        help="End date for sequence range (YYYY-MM-DD format, defaults to today)",
        type=valid_date,
        default=datetime.now().date(),
    )

    # Analysis parameters
    parser.add_argument(
        "--confidence-threshold",
        help="Minimum AI prediction confidence (0.0-1.0). Use 0.0 to disable filtering and process all predictions.",
        type=float,
        default=0.5,
    )
    parser.add_argument(
        "--iou-threshold",
        help="Minimum IoU for clustering overlapping boxes (0.0-1.0)",
        type=float,
        default=0.3,
    )
    parser.add_argument(
        "--min-cluster-size",
        help="Minimum number of boxes required in a cluster",
        type=int,
        default=1,
    )

    # Execution options
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview annotations without creating them",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing annotations (default: skip existing)",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        help="Logging level (debug/info/warning/error)",
        choices=["debug", "info", "warning", "error"],
    )

    return parser


def validate_args(args: argparse.Namespace) -> bool:
    """
    Validate parsed command line arguments.

    Args:
        args: Parsed arguments namespace

    Returns:
        True if arguments are valid, False otherwise
    """
    # Validate date range if provided
    if args.date_from and args.date_end and args.date_from > args.date_end:
        logging.error("--date-from must be earlier than or equal to --date-end")
        return False

    # Validate numeric thresholds
    if not (0.0 <= args.confidence_threshold <= 1.0):
        logging.error("--confidence-threshold must be between 0.0 and 1.0")
        return False

    if not (0.0 <= args.iou_threshold <= 1.0):
        logging.error("--iou-threshold must be between 0.0 and 1.0")
        return False

    if args.min_cluster_size < 1:
        logging.error("--min-cluster-size must be at least 1")
        return False

    return True


def get_sequences_from_date_range(
    base_url: str, date_from: date, date_end: date
) -> List[int]:
    """
    Get sequence IDs for a date range.

    Args:
        base_url: API base URL
        date_from: Start date
        date_end: End date

    Returns:
        List of sequence IDs
    """
    try:
        # Format dates for API query
        date_from_str = date_from.strftime("%Y-%m-%d")
        date_end_str = date_end.strftime("%Y-%m-%d")

        logging.info(f"Fetching sequences from {date_from_str} to {date_end_str}")

        # Fetch sequences in date range with pagination
        all_sequences = []
        page = 1
        page_size = 100

        while True:
            response = list_sequences(
                base_url,
                page=page,
                size=page_size,
                # Note: Add date filtering parameters when available in API
            )

            # Handle paginated response
            if isinstance(response, dict) and "items" in response:
                sequences = response["items"]
                total_pages = response.get("pages", 1)
            else:
                sequences = response
                total_pages = 1

            if not sequences:
                break

            # Filter by date range (client-side filtering since API might not support date filtering)
            for seq in sequences:
                recorded_at = seq.get("recorded_at")
                if recorded_at:
                    try:
                        seq_date = datetime.fromisoformat(
                            recorded_at.replace("Z", "+00:00")
                        ).date()
                        if date_from <= seq_date <= date_end:
                            all_sequences.append(seq["id"])
                    except (ValueError, TypeError):
                        continue

            if page >= total_pages:
                break
            page += 1

        logging.info(f"Found {len(all_sequences)} sequences in date range")
        return all_sequences

    except Exception as e:
        logging.error(f"Error fetching sequences for date range: {e}")
        return []


def get_sequences_without_annotations(base_url: str) -> List[int]:
    """
    Get all sequence IDs that do not have annotations.

    Args:
        base_url: API base URL

    Returns:
        List of sequence IDs without annotations
    """
    try:
        logging.info("Fetching sequences without annotations")

        # Fetch sequences without annotations with pagination
        all_sequences = []
        page = 1
        page_size = 100

        while True:
            response = list_sequences(
                base_url,
                has_annotation=False,
                page=page,
                size=page_size,
            )

            # Handle paginated response
            if isinstance(response, dict) and "items" in response:
                sequences = response["items"]
                total_pages = response.get("pages", 1)
            else:
                sequences = response
                total_pages = 1

            if not sequences:
                break

            # Extract sequence IDs
            for seq in sequences:
                all_sequences.append(seq["id"])

            if page >= total_pages:
                break
            page += 1

        logging.info(f"Found {len(all_sequences)} sequences without annotations")
        return all_sequences

    except Exception as e:
        logging.error(f"Error fetching sequences without annotations: {e}")
        return []


def check_existing_annotation(base_url: str, sequence_id: int) -> Optional[int]:
    """
    Check if a sequence already has an annotation.

    Args:
        base_url: API base URL
        sequence_id: Sequence ID to check

    Returns:
        Annotation ID if annotation exists, None otherwise
    """
    try:
        response = list_sequence_annotations(base_url, sequence_id=sequence_id)

        # Handle paginated response
        if isinstance(response, dict) and "items" in response:
            annotations = response["items"]
        else:
            annotations = response

        if len(annotations) > 0:
            return annotations[0]["id"]  # Return the annotation ID
        return None

    except Exception as e:
        logging.debug(
            f"Error checking existing annotation for sequence {sequence_id}: {e}"
        )
        return None


def create_annotation_from_data(
    base_url: str,
    sequence_id: int,
    annotation_data,
    dry_run: bool = False,
    existing_annotation_id: Optional[int] = None,
    processing_stage: SequenceAnnotationProcessingStage = SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
) -> bool:
    """
    Create or update a sequence annotation from analyzed data.

    Args:
        base_url: API base URL
        sequence_id: Sequence ID
        annotation_data: SequenceAnnotationData object
        dry_run: If True, don't actually create/update the annotation
        existing_annotation_id: If provided, update existing annotation via PATCH instead of creating new one
        processing_stage: Processing stage to set for the annotation

    Returns:
        True if successful, False otherwise
    """
    try:
        if existing_annotation_id:
            # Update existing annotation (PATCH)
            update_dict = {
                "annotation": annotation_data.model_dump(),
                "processing_stage": processing_stage.value,
                "has_missed_smoke": False,  # Default to False, can be updated during human review
            }

            if dry_run:
                logging.info(
                    f"DRY RUN: Would update annotation {existing_annotation_id} for sequence {sequence_id}"
                )
                logging.debug(f"Update data: {update_dict}")
                return True

            # Update the annotation
            result = update_sequence_annotation(
                base_url, existing_annotation_id, update_dict
            )
            logging.info(
                f"Updated annotation for sequence {sequence_id}: annotation_id={existing_annotation_id}"
            )
            return True

        else:
            # Create new annotation (POST)
            annotation_dict = {
                "sequence_id": sequence_id,
                "annotation": annotation_data.model_dump(),
                "processing_stage": processing_stage.value,
                "has_smoke": any(
                    seq_bbox.is_smoke for seq_bbox in annotation_data.sequences_bbox
                ),
                "has_false_positives": any(
                    len(seq_bbox.false_positive_types) > 0
                    for seq_bbox in annotation_data.sequences_bbox
                ),
                "has_missed_smoke": False,  # Default to False, can be updated during human review
                "false_positive_types": "",  # Will be populated during human review
            }

            if dry_run:
                logging.info(
                    f"DRY RUN: Would create annotation for sequence {sequence_id}"
                )
                logging.debug(f"Annotation data: {annotation_dict}")
                return True

            # Create the annotation
            result = create_sequence_annotation(base_url, annotation_dict)
            logging.info(
                f"Created annotation for sequence {sequence_id}: annotation_id={result.get('id')}"
            )
            return True

    except ValidationError as e:
        logging.error(
            f"Validation error creating annotation for sequence {sequence_id}: {e.message}"
        )
        if hasattr(e, "field_errors") and e.field_errors:
            for error in e.field_errors:
                logging.error(f"  Field error: {error}")
        return False

    except Exception as e:
        logging.error(f"Error creating annotation for sequence {sequence_id}: {e}")
        return False


def main():
    """Main execution function."""
    parser = make_cli_parser()
    args = parser.parse_args()

    # Setup logging
    logging.basicConfig(
        level=args.loglevel.upper(),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    logger = logging.getLogger(__name__)

    # Validate arguments
    if not validate_args(args):
        sys.exit(1)

    logger.info("Starting sequence annotation generation")
    logger.info(
        f"Configuration: confidence_threshold={args.confidence_threshold}, "
        f"iou_threshold={args.iou_threshold}, min_cluster_size={args.min_cluster_size}"
    )

    # Determine sequence IDs to process
    sequence_ids = []
    if args.sequence_id:
        sequence_ids = [args.sequence_id]
    elif args.sequence_ids:
        sequence_ids = args.sequence_ids
    elif args.date_from:
        sequence_ids = get_sequences_from_date_range(
            args.url_api_annotation, args.date_from, args.date_end
        )
        if not sequence_ids:
            logger.error("No sequences found in specified date range")
            sys.exit(1)
    elif args.all_without_annotations:
        sequence_ids = get_sequences_without_annotations(args.url_api_annotation)
        if not sequence_ids:
            logger.error("No sequences without annotations found")
            sys.exit(1)

    logger.info(f"Processing {len(sequence_ids)} sequences")

    # Initialize sequence analyzer
    analyzer = SequenceAnalyzer(
        base_url=args.url_api_annotation,
        confidence_threshold=args.confidence_threshold,
        iou_threshold=args.iou_threshold,
        min_cluster_size=args.min_cluster_size,
    )

    # Process sequences
    successful_annotations = 0
    skipped_existing = 0
    failed_annotations = 0

    for sequence_id in tqdm(sequence_ids, desc="Processing sequences"):
        logger.info(f"Processing sequence {sequence_id}")

        # Check for existing annotation
        existing_annotation_id = check_existing_annotation(
            args.url_api_annotation, sequence_id
        )

        if existing_annotation_id and not args.force:
            logger.info(
                f"Sequence {sequence_id} already has annotation, skipping (use --force to overwrite)"
            )
            skipped_existing += 1
            continue

        # Analyze sequence
        annotation_data = analyzer.analyze_sequence(sequence_id)
        if annotation_data is None:
            logger.warning(f"Failed to analyze sequence {sequence_id}")
            failed_annotations += 1
            continue

        # Create or update annotation
        if create_annotation_from_data(
            args.url_api_annotation,
            sequence_id,
            annotation_data,
            args.dry_run,
            existing_annotation_id,
        ):
            successful_annotations += 1
        else:
            failed_annotations += 1

    # Report final statistics
    logger.info("Sequence annotation generation completed")
    logger.info("Results:")
    logger.info(f"  Total sequences processed: {len(sequence_ids)}")
    logger.info(f"  Successful annotations: {successful_annotations}")
    logger.info(f"  Skipped (existing): {skipped_existing}")
    logger.info(f"  Failed: {failed_annotations}")

    if args.dry_run:
        logger.info("DRY RUN: No annotations were actually created")

    # Exit with appropriate code
    if failed_annotations > 0:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
