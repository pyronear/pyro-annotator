"""
CLI script for end-to-end platform data import and processing.

This script combines the functionality of three separate scripts into a streamlined workflow:
1. Fetch sequences and detections from the Pyronear platform API
2. For each sequence: generate annotations from AI predictions
3. For each sequence: generate GIFs and update processing stage

Usage:
  # Basic usage - full pipeline for date range  
  uv run python -m scripts.data_transfer.ingestion.platform.import --date-from 2024-01-01 --date-end 2024-01-02

  # Skip platform fetch (use existing sequences)
  uv run python -m scripts.data_transfer.ingestion.platform.import --date-from 2024-01-01 --skip-platform-fetch

  # Process ALL predictions (confidence 0.0) 
  uv run python -m scripts.data_transfer.ingestion.platform.import --date-from 2024-01-01 --confidence-threshold 0.0

  # Dry run to preview what would be processed
  uv run python -m scripts.data_transfer.ingestion.platform.import --date-from 2024-01-01 --dry-run

Arguments:
  --date-from (date): Start date for sequences (YYYY-MM-DD format)
  --date-end (date): End date for sequences (YYYY-MM-DD format, defaults to today)
  --url-api-platform (str): Platform API URL (default: https://alertapi.pyronear.org)
  --url-api-annotation (str): Annotation API URL (default: http://localhost:5050)
  --detections-limit (int): Max detections per sequence (default: 30)
  --detections-order-by (str): Order detections by created_at (asc/desc, default: asc)
  --confidence-threshold (float): Min AI confidence for bboxes (default: 0.0)
  --iou-threshold (float): Min IoU for clustering overlapping boxes (default: 0.3)
  --min-cluster-size (int): Min boxes per cluster (default: 1)
  --dry-run: Preview actions without execution
  --skip-platform-fetch: Skip step 1 (use existing sequences in annotation API)
  --max-concurrent-gifs (int): Concurrent GIF generations per sequence (default: 3)
  --loglevel (str): Logging level (debug/info/warning/error, default: info)

Environment variables required:
  PLATFORM_LOGIN (str): Platform API login
  PLATFORM_PASSWORD (str): Platform API password
  PLATFORM_ADMIN_LOGIN (str): Admin login for organization access
  PLATFORM_ADMIN_PASSWORD (str): Admin password for organization access

Examples:
  # Basic usage
  uv run python -m scripts.data_transfer.ingestion.platform.import --date-from 2024-01-01 --date-end 2024-01-02

  # Process all predictions (no confidence filtering)
  uv run python -m scripts.data_transfer.ingestion.platform.import --date-from 2024-01-01 --confidence-threshold 0.0

  # Dry run to see what would be processed
  uv run python -m scripts.data_transfer.ingestion.platform.import --date-from 2024-01-01 --dry-run --loglevel debug
"""

import argparse
import logging
import os
import sys
from datetime import date, datetime
from typing import List, Dict, Any, Optional

from tqdm import tqdm

# Import platform fetching functionality
from . import client as platform_client
from . import shared
from . import utils as platform_utils
from .fetch_platform_sequences import (
    valid_date,
    validate_parsed_args,
    fetch_all_sequences_within,
)

# Import annotation generation functionality
from ...annotation_generation.generate_sequence_annotations import (
    check_existing_annotation,
    create_annotation_from_data,
)
from ...annotation_generation.sequence_analyzer import SequenceAnalyzer

# Import GIF generation functionality
from ...annotation_generation.generate_sequence_gifs import (
    generate_gifs_for_annotation,
)

# Import API client and models
from app.clients.annotation_api import (
    ValidationError,
    NotFoundError,
    ServerError,
    list_sequences,
    list_sequence_annotations,
    update_sequence_annotation,
)
from app.models import SequenceAnnotationProcessingStage


def make_cli_parser() -> argparse.ArgumentParser:
    """
    Create the CLI argument parser.
    """
    parser = argparse.ArgumentParser(
        description="End-to-end platform data import and processing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Arguments:")[0].split("Usage:")[1].strip(),
    )

    # Required parameters
    parser.add_argument(
        "--date-from",
        help="Start date for sequences (YYYY-MM-DD format)",
        type=valid_date,
        required=True,
    )
    parser.add_argument(
        "--date-end",
        help="End date for sequences (YYYY-MM-DD format, defaults to today)",
        type=valid_date,
        default=datetime.now().date(),
    )

    # API configuration
    parser.add_argument(
        "--url-api-platform",
        help="Platform API URL",
        type=str,
        default="https://alertapi.pyronear.org",
    )
    parser.add_argument(
        "--url-api-annotation",
        help="Annotation API URL",
        type=str,
        default="http://localhost:5050",
    )

    # Platform fetching options
    parser.add_argument(
        "--detections-limit",
        help="Maximum number of detections to fetch per sequence",
        type=int,
        default=30,
    )
    parser.add_argument(
        "--detections-order-by",
        help="Order detections by created_at in descending or ascending order",
        choices=["desc", "asc"],
        type=str,
        default="asc",
    )

    # Annotation analysis options
    parser.add_argument(
        "--confidence-threshold",
        help="Minimum AI prediction confidence (0.0-1.0). Use 0.0 to process all predictions.",
        type=float,
        default=0.0,
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

    # Processing control
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview actions without executing them",
    )
    parser.add_argument(
        "--skip-platform-fetch",
        action="store_true",
        help="Skip platform data fetching (use existing sequences in annotation API)",
    )
    parser.add_argument(
        "--max-concurrent-gifs",
        help="Maximum concurrent GIF generations per sequence",
        type=int,
        default=3,
    )

    # Logging
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
    # Validate date range
    if args.date_from > args.date_end:
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

    if args.max_concurrent_gifs < 1:
        logging.error("--max-concurrent-gifs must be at least 1")
        return False

    if args.max_concurrent_gifs > 10:
        logging.warning(
            f"--max-concurrent-gifs={args.max_concurrent_gifs} may overwhelm S3/OpenCV resources. Consider using <= 10"
        )

    return True


def get_sequences_from_annotation_api(
    base_url: str, date_from: date, date_end: date
) -> List[int]:
    """
    Get sequence IDs from the annotation API for a date range.

    Args:
        base_url: Annotation API base URL
        date_from: Start date
        date_end: End date

    Returns:
        List of sequence IDs
    """
    try:
        # Format dates for filtering
        date_from_str = date_from.strftime("%Y-%m-%d")
        date_end_str = date_end.strftime("%Y-%m-%d")

        logging.info(f"Fetching sequences from annotation API from {date_from_str} to {date_end_str}")

        # Fetch sequences with pagination
        all_sequence_ids = []
        page = 1
        page_size = 100

        while True:
            response = list_sequences(
                base_url,
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

            # Filter by date range (client-side filtering)
            for seq in sequences:
                recorded_at = seq.get("recorded_at")
                if recorded_at:
                    try:
                        seq_date = datetime.fromisoformat(
                            recorded_at.replace("Z", "+00:00")
                        ).date()
                        if date_from <= seq_date <= date_end:
                            all_sequence_ids.append(seq["id"])
                    except (ValueError, TypeError):
                        continue

            if page >= total_pages:
                break
            page += 1

        logging.info(f"Found {len(all_sequence_ids)} sequences in annotation API for date range")
        return all_sequence_ids

    except Exception as e:
        logging.error(f"Error fetching sequences from annotation API: {e}")
        return []


def process_single_sequence(
    sequence_id: int,
    analyzer: SequenceAnalyzer,
    annotation_api_url: str,
    dry_run: bool = False,
    max_concurrent_gifs: int = 3,
) -> Dict[str, Any]:
    """
    Process a single sequence: generate annotation and GIFs.

    Args:
        sequence_id: Sequence ID to process
        analyzer: SequenceAnalyzer instance
        annotation_api_url: Annotation API base URL
        dry_run: If True, don't actually create annotations/GIFs
        max_concurrent_gifs: Max concurrent GIF generations

    Returns:
        Dictionary with processing results
    """
    result = {
        "sequence_id": sequence_id,
        "annotation_created": False,
        "annotation_id": None,
        "gifs_generated": False,
        "gif_count": 0,
        "errors": [],
        "final_stage": None,
    }

    try:
        logging.info(f"Processing sequence {sequence_id}")

        # Step 1: Generate annotation
        logging.debug(f"Analyzing sequence {sequence_id}")
        annotation_data = analyzer.analyze_sequence(sequence_id)
        
        if annotation_data is None:
            error_msg = f"Failed to analyze sequence {sequence_id} - no detections or analysis failed"
            logging.warning(error_msg)
            result["errors"].append(error_msg)
            return result

        # Check for existing annotation
        existing_annotation_id = check_existing_annotation(annotation_api_url, sequence_id)

        # Create or update annotation
        if create_annotation_from_data(
            annotation_api_url,
            sequence_id,
            annotation_data,
            dry_run,
            existing_annotation_id,
        ):
            result["annotation_created"] = True
            result["annotation_id"] = existing_annotation_id if existing_annotation_id else "new"
            result["final_stage"] = SequenceAnnotationProcessingStage.IMPORTED.value
            logging.info(f"Successfully created/updated annotation for sequence {sequence_id}")
        else:
            error_msg = f"Failed to create annotation for sequence {sequence_id}"
            logging.error(error_msg)
            result["errors"].append(error_msg)
            return result

        if dry_run:
            logging.info(f"DRY RUN: Would generate GIFs for sequence {sequence_id}")
            result["gifs_generated"] = True
            result["final_stage"] = SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value
            return result

        # Step 2: Generate GIFs
        # First, get the annotation ID if we don't have it
        if result["annotation_id"] == "new":
            # Refetch to get the actual annotation ID
            actual_annotation_id = check_existing_annotation(annotation_api_url, sequence_id)
            if actual_annotation_id:
                result["annotation_id"] = actual_annotation_id
            else:
                error_msg = f"Could not find annotation ID for sequence {sequence_id} after creation"
                logging.error(error_msg)
                result["errors"].append(error_msg)
                return result

        # Get the annotation object for GIF generation
        try:
            annotations_response = list_sequence_annotations(
                annotation_api_url, 
                sequence_id=sequence_id,
                page=1,
                size=1
            )
            
            # Handle paginated response
            if isinstance(annotations_response, dict) and "items" in annotations_response:
                annotations = annotations_response["items"]
            else:
                annotations = annotations_response

            if not annotations:
                error_msg = f"No annotations found for sequence {sequence_id}"
                logging.error(error_msg)
                result["errors"].append(error_msg)
                return result

            annotation_obj = annotations[0]

        except Exception as e:
            error_msg = f"Error fetching annotation for sequence {sequence_id}: {e}"
            logging.error(error_msg)
            result["errors"].append(error_msg)
            return result

        # Generate GIFs
        logging.debug(f"Generating GIFs for sequence {sequence_id}")
        gif_result = generate_gifs_for_annotation(
            annotation_api_url,
            annotation_obj,
            dry_run=False,  # We handle dry_run above
            update_stage=True,  # Always update stage to ready_to_annotate
        )

        if gif_result["success"]:
            result["gifs_generated"] = True
            result["gif_count"] = gif_result["gif_count"]
            result["final_stage"] = SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value
            logging.info(f"Successfully generated {gif_result['gif_count']} GIFs for sequence {sequence_id}")
        else:
            error_msg = f"Failed to generate GIFs for sequence {sequence_id}: {gif_result.get('message', 'Unknown error')}"
            logging.error(error_msg)
            result["errors"].append(error_msg)

        return result

    except Exception as e:
        error_msg = f"Unexpected error processing sequence {sequence_id}: {e}"
        logging.error(error_msg)
        result["errors"].append(error_msg)
        return result


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

    logger.info("Starting end-to-end platform data import and processing")
    logger.info(f"Date range: {args.date_from} to {args.date_end}")
    logger.info(
        f"Configuration: confidence_threshold={args.confidence_threshold}, "
        f"iou_threshold={args.iou_threshold}, min_cluster_size={args.min_cluster_size}"
    )

    # Initialize statistics
    stats = {
        "total_sequences": 0,
        "successful_sequences": 0,
        "failed_sequences": 0,
        "annotations_created": 0,
        "gifs_generated": 0,
        "total_gifs": 0,
    }

    try:
        # Step 1: Fetch platform data (if not skipped)
        if not args.skip_platform_fetch:
            logger.info("Step 1: Fetching platform data")
            
            if not shared.validate_available_env_variables():
                logger.error("Missing required environment variables for platform API")
                sys.exit(1)

            # Get platform credentials
            platform_login = os.getenv("PLATFORM_LOGIN")
            platform_password = os.getenv("PLATFORM_PASSWORD")
            platform_admin_login = os.getenv("PLATFORM_ADMIN_LOGIN")
            platform_admin_password = os.getenv("PLATFORM_ADMIN_PASSWORD")

            if not all([platform_login, platform_password, platform_admin_login, platform_admin_password]):
                logger.error("Missing platform credentials")
                sys.exit(1)

            # Get access tokens
            logger.info("Getting platform API access tokens")
            access_token = platform_client.get_api_access_token(
                api_endpoint=args.url_api_platform,
                username=platform_login,
                password=platform_password,
            )
            access_token_admin = platform_client.get_api_access_token(
                api_endpoint=args.url_api_platform,
                username=platform_admin_login,
                password=platform_admin_password,
            )

            # Fetch platform records
            logger.info(f"Fetching platform data from {args.date_from} to {args.date_end}")
            records = fetch_all_sequences_within(
                date_from=args.date_from,
                date_end=args.date_end,
                detections_limit=args.detections_limit,
                detections_order_by=args.detections_order_by,
                api_endpoint=args.url_api_platform,
                access_token=access_token,
                access_token_admin=access_token_admin,
            )

            logger.info(f"Fetched {len(records)} detection records from platform API")

            if not records and not args.dry_run:
                logger.warning("No records fetched from platform API")
                sys.exit(0)

            # Post to annotation API (if not dry run)
            if not args.dry_run:
                logger.info("Posting platform data to annotation API")
                result = shared.post_records_to_annotation_api(args.url_api_annotation, records)
                
                logger.info("Platform data import results:")
                logger.info(f"  Sequences: {result['successful_sequences']}/{result['total_sequences']} successful")
                logger.info(f"  Detections: {result['successful_detections']}/{result['total_detections']} successful")
                
                if result["failed_sequences"] > 0 or result["failed_detections"] > 0:
                    logger.warning("Some platform data failed to import, but continuing with processing")
            else:
                logger.info("DRY RUN: Skipping platform data posting")

        else:
            logger.info("Step 1: Skipping platform data fetch")

        # Step 2: Get sequences to process
        logger.info("Step 2: Getting sequences to process")
        sequence_ids = get_sequences_from_annotation_api(
            args.url_api_annotation,
            args.date_from,
            args.date_end,
        )

        if not sequence_ids:
            logger.error("No sequences found to process")
            sys.exit(1)

        stats["total_sequences"] = len(sequence_ids)
        logger.info(f"Found {len(sequence_ids)} sequences to process")

        # Step 3: Initialize sequence analyzer
        logger.info("Step 3: Initializing sequence analyzer")
        analyzer = SequenceAnalyzer(
            base_url=args.url_api_annotation,
            confidence_threshold=args.confidence_threshold,
            iou_threshold=args.iou_threshold,
            min_cluster_size=args.min_cluster_size,
        )

        # Step 4: Process each sequence
        logger.info("Step 4: Processing sequences")
        
        for sequence_id in tqdm(sequence_ids, desc="Processing sequences"):
            result = process_single_sequence(
                sequence_id=sequence_id,
                analyzer=analyzer,
                annotation_api_url=args.url_api_annotation,
                dry_run=args.dry_run,
                max_concurrent_gifs=args.max_concurrent_gifs,
            )

            # Update statistics
            if result["errors"]:
                stats["failed_sequences"] += 1
                for error in result["errors"]:
                    logger.error(f"Sequence {sequence_id}: {error}")
            else:
                stats["successful_sequences"] += 1

            if result["annotation_created"]:
                stats["annotations_created"] += 1

            if result["gifs_generated"]:
                stats["gifs_generated"] += 1
                stats["total_gifs"] += result["gif_count"]

            # Log progress
            logger.debug(
                f"Sequence {sequence_id}: "
                f"annotation={'✓' if result['annotation_created'] else '✗'}, "
                f"gifs={'✓' if result['gifs_generated'] else '✗'} ({result['gif_count']}), "
                f"stage={result['final_stage'] or 'failed'}"
            )

        # Final statistics
        logger.info("Processing completed!")
        logger.info("Final Statistics:")
        logger.info(f"  Total sequences: {stats['total_sequences']}")
        logger.info(f"  Successful sequences: {stats['successful_sequences']}")
        logger.info(f"  Failed sequences: {stats['failed_sequences']}")
        logger.info(f"  Annotations created: {stats['annotations_created']}")
        logger.info(f"  Sequences with GIFs: {stats['gifs_generated']}")
        logger.info(f"  Total GIFs generated: {stats['total_gifs']}")

        if args.dry_run:
            logger.info("DRY RUN: No actual changes were made")

        # Exit with appropriate code
        if stats["failed_sequences"] > 0:
            logger.warning(f"{stats['failed_sequences']} sequences had errors")
            sys.exit(1)
        else:
            logger.info("All sequences processed successfully ✅")
            sys.exit(0)

    except KeyboardInterrupt:
        logger.info("Processing interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error during processing: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()