"""
CLI script to generate GIFs for sequence annotations.

This script processes sequence annotations in the 'imported' stage to generate
both main (full-frame with bounding box overlays) and crop GIFs from detection images.
The generated GIFs are uploaded to S3 storage and linked to the annotations.

Usage:
  # Generate GIFs for all annotations in imported stage
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --all-imported --loglevel info

  # Generate GIFs for a specific annotation
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --annotation-id 123 --loglevel info

  # Generate GIFs for multiple annotations
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --annotation-ids 123,456,789 --loglevel info

  # Generate GIFs for annotations of specific sequence
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --sequence-id 123 --loglevel info

  # Generate GIFs for sequences in a date range
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info

  # Preview without generating (dry run)
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --all-imported --dry-run --loglevel debug

  # Force regeneration of existing GIFs
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --annotation-id 123 --force --loglevel info

Arguments:
  --url-api-annotation (url): Annotation API base URL (default: http://localhost:5050)
  --annotation-id (int): Single annotation ID to process
  --annotation-ids (str): Comma-separated list of annotation IDs to process
  --sequence-id (int): Process annotation for specific sequence ID
  --sequence-ids (str): Comma-separated list of sequence IDs to process
  --date-from (date): Start date for sequence range (YYYY-MM-DD format)
  --date-end (date): End date for sequence range (YYYY-MM-DD format)
  --all-imported: Process all sequence annotations in 'imported' stage
  --dry-run: Preview GIF generation without actually creating them
  --force: Regenerate GIFs even if they already exist (default: skip existing)
  --update-stage: Update processing stage to 'ready_to_annotate' after successful generation
  --max-concurrent (int): Maximum concurrent GIF generations (default: 3)
  --continue-on-error: Continue processing other annotations if some fail
  --loglevel (str): Logging level (debug/info/warning/error, default: info)

Examples:
  # Basic usage - all imported annotations
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --all-imported

  # Process specific annotation with stage update
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --annotation-id 123 --update-stage

  # Process annotations for multiple sequences
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --sequence-ids 123,456,789

  # Force regeneration for date range
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --date-from 2024-01-01 --date-end 2024-01-02 --force

  # Test mode - see what would be processed
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --all-imported --dry-run --loglevel debug

  # Concurrent processing with error tolerance
  uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_gifs --all-imported --max-concurrent 5 --continue-on-error
"""

import argparse
import logging
import sys
from datetime import date, datetime
from typing import List, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

from tqdm import tqdm

from app.clients.annotation_api import (
    ValidationError,
    NotFoundError,
    ServerError,
    list_sequences,
    list_sequence_annotations,
    update_sequence_annotation,
    generate_sequence_annotation_gifs,
)
from app.models import SequenceAnnotationProcessingStage


def valid_date(s: str) -> date:
    """
    Datetime parser for the CLI.
    """
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        msg = f"not a valid date: {s!r}"
        raise argparse.ArgumentTypeError(msg)


def parse_annotation_ids(s: str) -> List[int]:
    """
    Parse comma-separated annotation IDs.
    """
    try:
        return [int(x.strip()) for x in s.split(",") if x.strip()]
    except ValueError:
        msg = (
            f"invalid annotation IDs format: {s!r}. Expected comma-separated integers."
        )
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
        description="Generate GIFs for sequence annotations",
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

    # Annotation/sequence selection (mutually exclusive group)
    selection_group = parser.add_mutually_exclusive_group(required=True)
    selection_group.add_argument(
        "--annotation-id",
        help="Single annotation ID to process",
        type=int,
    )
    selection_group.add_argument(
        "--annotation-ids",
        help="Comma-separated list of annotation IDs to process",
        type=parse_annotation_ids,
    )
    selection_group.add_argument(
        "--sequence-id",
        help="Process annotation for specific sequence ID",
        type=int,
    )
    selection_group.add_argument(
        "--sequence-ids",
        help="Comma-separated list of sequence IDs to process",
        type=parse_sequence_ids,
    )
    selection_group.add_argument(
        "--date-from",
        help="Start date for sequence range (YYYY-MM-DD format)",
        type=valid_date,
    )
    selection_group.add_argument(
        "--all-imported",
        action="store_true",
        help="Process all sequence annotations in 'imported' stage",
    )

    parser.add_argument(
        "--date-end",
        help="End date for sequence range (YYYY-MM-DD format, defaults to today)",
        type=valid_date,
        default=datetime.now().date(),
    )

    # Processing options
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview GIF generation without actually creating them",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate GIFs even if they already exist (default: skip existing)",
    )
    parser.add_argument(
        "--update-stage",
        action="store_true",
        help="Update processing stage to 'ready_to_annotate' after successful generation",
    )
    parser.add_argument(
        "--max-concurrent",
        help="Maximum concurrent GIF generations",
        type=int,
        default=3,
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Continue processing other annotations if some fail",
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

    # Validate max_concurrent
    if args.max_concurrent < 1:
        logging.error("--max-concurrent must be at least 1")
        return False

    if args.max_concurrent > 10:
        logging.warning(
            f"--max-concurrent={args.max_concurrent} may overwhelm S3/OpenCV resources. Consider using <= 10"
        )

    return True


def get_annotations_from_sequences(
    base_url: str, sequence_ids: List[int]
) -> List[Dict[str, Any]]:
    """
    Get annotations for specific sequence IDs.

    Args:
        base_url: API base URL
        sequence_ids: List of sequence IDs

    Returns:
        List of annotation dictionaries
    """
    try:
        all_annotations = []

        for sequence_id in sequence_ids:
            logging.debug(f"Fetching annotations for sequence {sequence_id}")

            # Fetch annotations for this sequence with pagination
            page = 1
            page_size = 100

            while True:
                response = list_sequence_annotations(
                    base_url,
                    sequence_id=sequence_id,
                    processing_stage=SequenceAnnotationProcessingStage.IMPORTED.value,
                    page=page,
                    size=page_size,
                )

                # Handle paginated response
                if isinstance(response, dict) and "items" in response:
                    annotations = response["items"]
                    total_pages = response.get("pages", 1)
                else:
                    annotations = response
                    total_pages = 1

                if not annotations:
                    break

                all_annotations.extend(annotations)

                if page >= total_pages:
                    break
                page += 1

        logging.info(
            f"Found {len(all_annotations)} imported annotations for {len(sequence_ids)} sequences"
        )
        return all_annotations

    except Exception as e:
        logging.error(f"Error fetching annotations for sequences: {e}")
        return []


def get_annotations_from_date_range(
    base_url: str, date_from: date, date_end: date
) -> List[Dict[str, Any]]:
    """
    Get imported annotations for sequences in a date range.

    Args:
        base_url: API base URL
        date_from: Start date
        date_end: End date

    Returns:
        List of annotation dictionaries
    """
    try:
        # Format dates for API query
        date_from_str = date_from.strftime("%Y-%m-%d")
        date_end_str = date_end.strftime("%Y-%m-%d")

        logging.info(
            f"Fetching imported annotations for sequences from {date_from_str} to {date_end_str}"
        )

        # First get sequences in date range
        all_sequences = []
        page = 1
        page_size = 100

        while True:
            response = list_sequences(
                base_url,
                page=page,
                size=page_size,
                # Note: API date filtering not available, using client-side filtering
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

            # Filter by date range (client-side filtering)
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

        # Get annotations for these sequences
        if all_sequences:
            return get_annotations_from_sequences(base_url, all_sequences)
        return []

    except Exception as e:
        logging.error(f"Error fetching annotations for date range: {e}")
        return []


def get_all_imported_annotations(base_url: str) -> List[Dict[str, Any]]:
    """
    Get all sequence annotations in 'imported' processing stage.

    Args:
        base_url: API base URL

    Returns:
        List of annotation dictionaries
    """
    try:
        logging.info("Fetching all sequence annotations in 'imported' stage")

        # Fetch annotations with pagination
        all_annotations = []
        page = 1
        page_size = 100

        while True:
            response = list_sequence_annotations(
                base_url,
                processing_stage=SequenceAnnotationProcessingStage.IMPORTED.value,
                page=page,
                size=page_size,
            )

            # Handle paginated response
            if isinstance(response, dict) and "items" in response:
                annotations = response["items"]
                total_pages = response.get("pages", 1)
            else:
                annotations = response
                total_pages = 1

            if not annotations:
                break

            all_annotations.extend(annotations)

            if page >= total_pages:
                break
            page += 1

        logging.info(f"Found {len(all_annotations)} annotations in 'imported' stage")
        return all_annotations

    except Exception as e:
        logging.error(f"Error fetching imported annotations: {e}")
        return []


def has_existing_gifs(annotation: Dict[str, Any]) -> bool:
    """
    Check if annotation already has GIFs generated.

    Args:
        annotation: Annotation dictionary

    Returns:
        True if GIFs already exist, False otherwise
    """
    try:
        annotation_data = annotation.get("annotation", {})
        sequences_bbox = annotation_data.get("sequences_bbox", [])

        for bbox in sequences_bbox:
            if bbox.get("gif_url_main") or bbox.get("gif_url_crop"):
                return True

        return False
    except Exception:
        return False


def generate_gifs_for_annotation(
    base_url: str,
    annotation: Dict[str, Any],
    dry_run: bool = False,
    update_stage: bool = False,
) -> Dict[str, Any]:
    """
    Generate GIFs for a single annotation.

    Args:
        base_url: API base URL
        annotation: Annotation dictionary
        dry_run: If True, don't actually generate GIFs
        update_stage: If True, update processing stage after success

    Returns:
        Dictionary with result information
    """
    annotation_id = annotation["id"]
    sequence_id = annotation["sequence_id"]

    try:
        if dry_run:
            logging.info(
                f"DRY RUN: Would generate GIFs for annotation {annotation_id} (sequence {sequence_id})"
            )
            return {
                "annotation_id": annotation_id,
                "sequence_id": sequence_id,
                "success": True,
                "gif_count": 0,  # Unknown in dry run
                "message": "DRY RUN - no GIFs generated",
            }

        # Generate GIFs
        result = generate_sequence_annotation_gifs(base_url, annotation_id)

        gif_count = result.get("gif_count", 0)
        logging.info(
            f"Generated {gif_count} GIFs for annotation {annotation_id} (sequence {sequence_id})"
        )

        # Update processing stage if requested and GIFs were generated
        if update_stage and gif_count > 0:
            try:
                update_data = {
                    "processing_stage": SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value
                }
                update_sequence_annotation(base_url, annotation_id, update_data)
                logging.info(
                    f"Updated annotation {annotation_id} to 'ready_to_annotate' stage"
                )
            except Exception as e:
                logging.warning(
                    f"Failed to update processing stage for annotation {annotation_id}: {e}"
                )

        return {
            "annotation_id": annotation_id,
            "sequence_id": sequence_id,
            "success": True,
            "gif_count": gif_count,
            "message": f"Generated {gif_count} GIFs successfully",
        }

    except NotFoundError as e:
        logging.error(f"Annotation {annotation_id} not found: {e}")
        return {
            "annotation_id": annotation_id,
            "sequence_id": sequence_id,
            "success": False,
            "gif_count": 0,
            "error": "annotation_not_found",
            "message": str(e),
        }

    except ValidationError as e:
        logging.warning(f"Validation error for annotation {annotation_id}: {e}")
        return {
            "annotation_id": annotation_id,
            "sequence_id": sequence_id,
            "success": False,
            "gif_count": 0,
            "error": "validation_error",
            "message": str(e),
        }

    except ServerError as e:
        logging.error(
            f"Server error generating GIFs for annotation {annotation_id}: {e}"
        )
        return {
            "annotation_id": annotation_id,
            "sequence_id": sequence_id,
            "success": False,
            "gif_count": 0,
            "error": "server_error",
            "message": str(e),
        }

    except Exception as e:
        logging.error(
            f"Unexpected error generating GIFs for annotation {annotation_id}: {e}"
        )
        return {
            "annotation_id": annotation_id,
            "sequence_id": sequence_id,
            "success": False,
            "gif_count": 0,
            "error": "unexpected_error",
            "message": str(e),
        }


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

    logger.info("Starting sequence annotation GIF generation")

    # Determine annotations to process
    annotations = []
    if args.annotation_id:
        # Single annotation - need to fetch it
        try:
            response = list_sequence_annotations(
                args.url_api_annotation, page=1, size=1000
            )
            all_annotations = (
                response["items"] if isinstance(response, dict) else response
            )
            annotation = next(
                (a for a in all_annotations if a["id"] == args.annotation_id), None
            )
            if annotation:
                annotations = [annotation]
            else:
                logger.error(f"Annotation {args.annotation_id} not found")
                sys.exit(1)
        except Exception as e:
            logger.error(f"Error fetching annotation {args.annotation_id}: {e}")
            sys.exit(1)

    elif args.annotation_ids:
        # Multiple annotations - need to fetch them
        try:
            response = list_sequence_annotations(
                args.url_api_annotation, page=1, size=1000
            )
            all_annotations = (
                response["items"] if isinstance(response, dict) else response
            )
            annotations = [a for a in all_annotations if a["id"] in args.annotation_ids]
            if len(annotations) != len(args.annotation_ids):
                found_ids = [a["id"] for a in annotations]
                missing_ids = [
                    aid for aid in args.annotation_ids if aid not in found_ids
                ]
                logger.warning(f"Some annotations not found: {missing_ids}")
        except Exception as e:
            logger.error(f"Error fetching annotations: {e}")
            sys.exit(1)

    elif args.sequence_id:
        annotations = get_annotations_from_sequences(
            args.url_api_annotation, [args.sequence_id]
        )
    elif args.sequence_ids:
        annotations = get_annotations_from_sequences(
            args.url_api_annotation, args.sequence_ids
        )
    elif args.date_from:
        annotations = get_annotations_from_date_range(
            args.url_api_annotation, args.date_from, args.date_end
        )
    elif args.all_imported:
        annotations = get_all_imported_annotations(args.url_api_annotation)

    if not annotations:
        logger.error("No annotations found to process")
        sys.exit(1)

    logger.info(f"Processing {len(annotations)} annotations")

    # Filter out annotations that already have GIFs (unless --force)
    if not args.force:
        original_count = len(annotations)
        annotations = [a for a in annotations if not has_existing_gifs(a)]
        skipped_count = original_count - len(annotations)
        if skipped_count > 0:
            logger.info(
                f"Skipping {skipped_count} annotations that already have GIFs (use --force to regenerate)"
            )

    if not annotations:
        logger.info("No annotations need GIF generation")
        sys.exit(0)

    # Process annotations
    successful_generations = 0
    failed_generations = 0
    total_gifs_generated = 0

    # Use concurrent processing if requested
    if args.max_concurrent > 1:
        logger.info(
            f"Using concurrent processing with max {args.max_concurrent} workers"
        )

        with ThreadPoolExecutor(max_workers=args.max_concurrent) as executor:
            # Submit all tasks
            future_to_annotation = {
                executor.submit(
                    generate_gifs_for_annotation,
                    args.url_api_annotation,
                    annotation,
                    args.dry_run,
                    args.update_stage,
                ): annotation
                for annotation in annotations
            }

            # Process completed tasks with progress bar
            with tqdm(total=len(annotations), desc="Generating GIFs") as pbar:
                for future in as_completed(future_to_annotation):
                    annotation = future_to_annotation[future]
                    try:
                        result = future.result()
                        pbar.set_description(
                            f"Processing annotation {result['annotation_id']}"
                        )

                        if result["success"]:
                            successful_generations += 1
                            total_gifs_generated += result["gif_count"]
                        else:
                            failed_generations += 1
                            if not args.continue_on_error:
                                logger.error(
                                    f"Stopping due to error: {result['message']}"
                                )
                                # Cancel remaining tasks
                                for f in future_to_annotation:
                                    f.cancel()
                                break
                    except Exception as e:
                        failed_generations += 1
                        logger.error(
                            f"Task failed for annotation {annotation['id']}: {e}"
                        )
                        if not args.continue_on_error:
                            break

                    pbar.update(1)
    else:
        # Sequential processing
        for annotation in tqdm(annotations, desc="Generating GIFs"):
            logger.info(
                f"Processing annotation {annotation['id']} (sequence {annotation['sequence_id']})"
            )

            result = generate_gifs_for_annotation(
                args.url_api_annotation, annotation, args.dry_run, args.update_stage
            )

            if result["success"]:
                successful_generations += 1
                total_gifs_generated += result["gif_count"]
            else:
                failed_generations += 1
                if not args.continue_on_error:
                    logger.error(f"Stopping due to error: {result['message']}")
                    break

    # Report final statistics
    logger.info("GIF generation completed")
    logger.info("Results:")
    logger.info(f"  Total annotations processed: {len(annotations)}")
    logger.info(f"  Successful generations: {successful_generations}")
    logger.info(f"  Failed generations: {failed_generations}")
    logger.info(f"  Total GIFs generated: {total_gifs_generated}")

    if args.dry_run:
        logger.info("DRY RUN: No GIFs were actually generated")

    # Exit with appropriate code
    if failed_generations > 0 and not args.continue_on_error:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
