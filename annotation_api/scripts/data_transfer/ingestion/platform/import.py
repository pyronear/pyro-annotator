"""
CLI script for end-to-end platform data import and processing.

This script combines platform data fetching and annotation generation into a streamlined workflow:
1. Fetch sequences and detections from the Pyronear platform API
2. For each sequence: generate annotations from AI predictions and set ready for annotation

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
  --max-workers (int): Max workers for parallel processing, auto-scales for different operations (default: 4)
  --dry-run: Preview actions without execution
  --skip-platform-fetch: Skip step 1 (use existing sequences in annotation API)
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

  # High-performance processing with more workers
  uv run python -m scripts.data_transfer.ingestion.platform.import --date-from 2024-01-01 --max-workers 8
"""

import argparse
import concurrent.futures
import logging
import os
import sys
import time
from datetime import datetime
from typing import Dict, Any

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

# Import new modular components
from .progress_management import ErrorCollector, StepManager, LogSuppressor
from .worker_config import WorkerConfig
from .annotation_processing import SequenceAnalyzer
from .sequence_fetching import fetch_all_sequences_within
from .annotation_management import (
    valid_date,
    get_sequences_from_annotation_api,
    process_single_sequence,
)

# Import platform functionality
from . import client as platform_client
from . import shared


def make_cli_parser() -> argparse.ArgumentParser:
    """
    Create the CLI argument parser with comprehensive options.
    
    Returns:
        Configured ArgumentParser instance
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

    # Concurrency control
    parser.add_argument(
        "--max-workers",
        help="Maximum number of workers for parallel processing (auto-scales for different operations)",
        type=int,
        default=4,
    )

    # Logging
    parser.add_argument(
        "--loglevel",
        default="info",
        help="Logging level (debug/info/warning/error). Use 'debug' for verbose output during progress.",
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

    # Validate worker count
    if args.max_workers < 1:
        logging.error("--max-workers must be at least 1")
        return False

    return True


def main() -> None:
    """Main execution function with comprehensive error handling and progress tracking."""
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

    # Initialize components
    worker_config = WorkerConfig(args.max_workers)
    console = Console()
    suppress_logs = args.loglevel != "debug"  # Suppress logs unless in debug mode
    step_manager = StepManager(console, show_timing=True)
    error_collector = ErrorCollector()
    
    # Initialize statistics
    stats = {
        "total_sequences": 0,
        "successful_sequences": 0,
        "failed_sequences": 0,
        "annotations_created": 0,
    }

    # Print header
    console.print()
    console.print(Panel(
        "[bold blue]Platform Data Import & Processing[/]",
        title="🔥 Pyronear Data Import",
        border_style="blue",
        padding=(0, 2)
    ))

    if args.loglevel == "debug":
        console.print(f"[blue]ℹ️  Date range: {args.date_from} to {args.date_end}[/]")
        console.print(f"[blue]ℹ️  Worker config: {worker_config}[/]")
        console.print(f"[blue]ℹ️  Analysis config: confidence={args.confidence_threshold}, iou={args.iou_threshold}, min_cluster={args.min_cluster_size}[/]")

    try:
        # Step 1: Fetch platform data (if not skipped)
        if not args.skip_platform_fetch:
            step_manager.start_step(
                1, 
                "Platform Data Import",
                f"Fetching data from {args.date_from} to {args.date_end} using {worker_config.base_workers} workers"
            )

            if not shared.validate_available_env_variables():
                console.print("[red]❌ Missing required environment variables for platform API[/]")
                step_manager.complete_step(False, "Missing environment variables")
                sys.exit(1)

            # Get platform credentials
            platform_login = os.getenv("PLATFORM_LOGIN")
            platform_password = os.getenv("PLATFORM_PASSWORD")
            platform_admin_login = os.getenv("PLATFORM_ADMIN_LOGIN")
            platform_admin_password = os.getenv("PLATFORM_ADMIN_PASSWORD")

            if not all([platform_login, platform_password, platform_admin_login, platform_admin_password]):
                error_collector.add_error("Missing platform credentials")
                step_manager.complete_step(False, "Missing platform credentials")
                sys.exit(1)

            # Get access tokens with progress display
            auth_start_time = time.time()
            with console.status("[bold blue]🔐 Authenticating with platform API...", spinner="dots") as status:
                try:
                    status.update("[bold blue]🔐 Getting user access token...")
                    access_token = platform_client.get_api_access_token(
                        api_endpoint=args.url_api_platform,
                        username=platform_login,
                        password=platform_password,
                    )
                    
                    status.update("[bold blue]🔐 Getting admin access token...")
                    access_token_admin = platform_client.get_api_access_token(
                        api_endpoint=args.url_api_platform,
                        username=platform_admin_login,
                        password=platform_admin_password,
                    )
                    
                    auth_duration = time.time() - auth_start_time
                    console.print(f"[green]✅ Authentication successful[/] [dim]({auth_duration:.1f}s)[/]")
                    
                except Exception as e:
                    error_collector.add_error(f"Authentication failed: {e}")
                    step_manager.complete_step(False, f"Authentication failed: {e}")
                    sys.exit(1)

            # Fetch platform records
            try:
                records = fetch_all_sequences_within(
                    date_from=args.date_from,
                    date_end=args.date_end,
                    detections_limit=args.detections_limit,
                    detections_order_by=args.detections_order_by,
                    api_endpoint=args.url_api_platform,
                    access_token=access_token,
                    access_token_admin=access_token_admin,
                    worker_config=worker_config,
                    suppress_logs=suppress_logs,
                    console=console,
                    error_collector=error_collector,
                )
            except Exception as e:
                error_collector.add_error(f"Platform data fetching failed: {e}")
                step_manager.complete_step(False, f"Platform data fetching failed: {e}")
                error_collector.print_summary(console, "Platform Data Fetching Errors")
                sys.exit(1)

            if not records and not args.dry_run:
                step_manager.complete_step(False, "No records fetched from platform API")
                sys.exit(0)

            # Post to annotation API (if not dry run)
            if not args.dry_run:
                console.print(f"[blue]🚀 Posting {len(records)} records to annotation API...[/]")
                
                try:
                    result = shared.post_records_to_annotation_api(
                        args.url_api_annotation, 
                        records, 
                        max_workers=worker_config.api_posting,
                        max_detection_workers=worker_config.detection_per_sequence,
                        suppress_logs=suppress_logs
                    )

                    # Prepare step completion stats
                    step_stats = {
                        "Records fetched": len(records),
                        "Sequences posted": f"{result['successful_sequences']}/{result['total_sequences']}",
                        "Detections posted": f"{result['successful_detections']}/{result['total_detections']}"
                    }
                    
                    step_success = result["failed_sequences"] == 0 and result["failed_detections"] == 0
                    step_message = "Platform data successfully imported" if step_success else "Platform data imported with some failures"
                    
                    step_manager.complete_step(step_success, step_message, step_stats)
                    
                    if result["failed_sequences"] > 0 or result["failed_detections"] > 0:
                        error_collector.add_warning(
                            f"{result['failed_sequences']} sequences and {result['failed_detections']} detections failed to import"
                        )

                except Exception as e:
                    error_collector.add_error(f"Failed to post data to annotation API: {e}")
                    step_manager.complete_step(False, f"Failed to post data to annotation API: {e}")
                    error_collector.print_summary(console, "Platform Data Import Errors")
                    sys.exit(1)
            else:
                step_stats = {"Records that would be posted": len(records)}
                step_manager.complete_step(True, "DRY RUN: Platform data fetch completed", step_stats)

        else:
            step_manager.start_step(1, "Platform Data Import", "Skipped per user request")
            step_manager.complete_step(True, "Platform data fetch skipped")

        # Step 2: Get sequences to process
        step_manager.start_step(
            2, 
            "Sequence Discovery",
            f"Finding sequences in annotation API for date range {args.date_from} to {args.date_end}"
        )
        
        try:
            sequence_ids = get_sequences_from_annotation_api(
                args.url_api_annotation,
                args.date_from,
                args.date_end,
            )

            if not sequence_ids:
                step_manager.complete_step(False, "No sequences found to process")
                sys.exit(1)

            stats["total_sequences"] = len(sequence_ids)
            step_stats = {"Sequences found": len(sequence_ids)}
            step_manager.complete_step(True, f"Found {len(sequence_ids)} sequences to process", step_stats)
            
        except Exception as e:
            error_collector.add_error(f"Failed to fetch sequences from annotation API: {e}")
            step_manager.complete_step(False, f"Failed to fetch sequences: {e}")
            error_collector.print_summary(console, "Sequence Discovery Errors")
            sys.exit(1)

        # Step 3: Initialize sequence analyzer
        step_manager.start_step(
            3, 
            "Analysis Setup",
            f"Configuring sequence analyzer (confidence={args.confidence_threshold}, iou={args.iou_threshold})"
        )
        
        try:
            analyzer = SequenceAnalyzer(
                base_url=args.url_api_annotation,
                confidence_threshold=args.confidence_threshold,
                iou_threshold=args.iou_threshold,
                min_cluster_size=args.min_cluster_size,
            )
            
            analyzer_stats = {
                "Confidence threshold": args.confidence_threshold,
                "IoU threshold": args.iou_threshold,
                "Min cluster size": args.min_cluster_size,
                "Workers": worker_config.annotation_processing
            }
            step_manager.complete_step(True, "Sequence analyzer configured", analyzer_stats)
            
        except Exception as e:
            error_collector.add_error(f"Failed to initialize sequence analyzer: {e}")
            step_manager.complete_step(False, f"Failed to initialize analyzer: {e}")
            sys.exit(1)

        # Step 4: Process each sequence
        step_manager.start_step(
            4,
            "Annotation Generation", 
            f"Processing {len(sequence_ids)} sequences with {worker_config.annotation_processing} workers"
        )

        with concurrent.futures.ThreadPoolExecutor(max_workers=worker_config.annotation_processing) as executor:
            # Submit all sequence processing tasks
            future_to_sequence_id = {
                executor.submit(
                    process_single_sequence,
                    sequence_id=sequence_id,
                    analyzer=analyzer,
                    annotation_api_url=args.url_api_annotation,
                    dry_run=args.dry_run,
                ): sequence_id
                for sequence_id in sequence_ids
            }

            # Collect results with progress tracking
            with LogSuppressor(suppress=suppress_logs):
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[bold blue]Generating annotations"),
                    BarColumn(bar_width=40),
                    TaskProgressColumn(),
                    console=Console(),
                    transient=True
                ) as progress_bar:
                    task = progress_bar.add_task("Processing sequences", total=len(future_to_sequence_id))
                    for future in concurrent.futures.as_completed(future_to_sequence_id):
                        sequence_id = future_to_sequence_id[future]
                        try:
                            result = future.result()

                            # Update statistics
                            if result["errors"]:
                                stats["failed_sequences"] += 1
                                for error in result["errors"]:
                                    error_collector.add_error(f"Sequence {sequence_id}: {error}")
                            else:
                                stats["successful_sequences"] += 1

                            if result["annotation_created"]:
                                stats["annotations_created"] += 1

                            # Log progress (suppressed unless debug)
                            logger.debug(
                                f"Sequence {sequence_id}: "
                                f"annotation={'✓' if result['annotation_created'] else '✗'}, "
                                f"stage={result['final_stage'] or 'failed'}"
                            )
                            progress_bar.advance(task)

                        except Exception as e:
                            error_msg = f"Unexpected error processing sequence {sequence_id}: {e}"
                            error_collector.add_error(error_msg)
                            stats["failed_sequences"] += 1
                            progress_bar.advance(task)

        # Complete Step 4 with final statistics
        step_4_success = stats["failed_sequences"] == 0
        final_stats = {
            "Total sequences": stats['total_sequences'],
            "Successful": stats['successful_sequences'],
            "Failed": stats['failed_sequences'],
            "Annotations created": stats['annotations_created']
        }
        
        step_4_message = "All sequences processed successfully" if step_4_success else f"{stats['failed_sequences']} sequences failed"
        if args.dry_run:
            step_4_message = "DRY RUN: " + step_4_message
            
        step_manager.complete_step(step_4_success, step_4_message, final_stats)
        
        # Show any accumulated errors/warnings
        if error_collector.has_issues():
            error_collector.print_summary(console, "Processing Summary")

        # Final summary panel
        console.print()
        success = stats["failed_sequences"] == 0
        style = "green" if success else "red"
        icon = "✅" if success else "❌"
        
        summary_text = f"""[bold]Total Sequences:[/] {stats['total_sequences']}
[bold]Successful:[/] {stats['successful_sequences']}
[bold]Failed:[/] {stats['failed_sequences']}
[bold]Annotations Created:[/] {stats['annotations_created']}"""
        
        if args.dry_run:
            summary_text += "\n\n[yellow]DRY RUN: No actual changes were made[/]"
        
        panel = Panel(
            summary_text,
            title=f"{icon} Processing Complete",
            border_style=style,
            padding=(1, 2)
        )
        console.print(panel)

        # Exit with appropriate code
        if stats["failed_sequences"] > 0:
            sys.exit(1)
        else:
            sys.exit(0)

    except KeyboardInterrupt:
        console.print("\n[yellow]⚠️  Processing interrupted by user[/]")
        error_collector.print_summary(console, "Errors Before Interruption")
        sys.exit(1)
    except Exception as e:
        error_collector.add_error(f"Unexpected error during processing: {e}")
        console.print(f"\n[red]❌ Unexpected error during processing: {e}[/]")
        error_collector.print_summary(console, "Critical Processing Errors")
        sys.exit(1)


if __name__ == "__main__":
    main()