"""
CLI script for end-to-end platform data import and processing.

This script provides a streamlined workflow to fetch platform data and generate annotations:
1. Fetch sequences and detections from the Pyronear platform API
2. Import successfully fetched data into the annotation API
3. Generate annotations from AI predictions for successfully imported sequences only
4. Set sequences to READY_TO_ANNOTATE stage

Usage:
  # Basic usage - full pipeline for date range
  uv run python -m scripts.data_transfer.ingestion.platform.import --date-from 2024-01-01 --date-end 2024-01-02

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
import re
import sys
import time
from datetime import datetime
from typing import List, Optional

from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    Progress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    TaskProgressColumn,
)

# Import new modular components
from .progress_management import ErrorCollector, StepManager, LogSuppressor
from .worker_config import WorkerConfig
from .sequence_fetching import fetch_all_sequences_within
from .annotation_management import (
    valid_date,
    create_simple_sequence_annotation,
    create_placeholder_sequence_annotation,
)
from . import shared
from . import client as platform_client
from app.clients import annotation_api
from app.models import SequenceAnnotationProcessingStage

load_dotenv()



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
        required=False,
        default=None,
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
        help="Platform API URL (alertapi.pyronear.org for Pyronear French, apicenia.pyronear.org for CENIA)",
        type=str,
        choices=["https://alertapi.pyronear.org", "https://apicenia.pyronear.org"],
        default="https://alertapi.pyronear.org",
    )
    parser.add_argument(
        "--url-api-annotation",
        help="Annotation API URL",
        type=str,
        default="http://localhost:5050",
    )
    parser.add_argument(
        "--source-annotation-url",
        help=(
            "Optional source annotation API URL to clone sequences/detections from, "
            "bypassing the platform API"
        ),
        type=str,
    )
    parser.add_argument(
        "--clone-processing-stage",
        help=(
            "When cloning from annotation API, filter sequences by processing stage. "
            "Default: no_annotation (only sequences without annotation record). Use 'all' to disable filter."
        ),
        type=str,
        choices=["no_annotation", "imported", "ready_to_annotate", "annotated", "all"],
        default="no_annotation",
    )
    parser.add_argument(
        "--clone-count-only",
        action="store_true",
        help="In clone mode, only fetch and display the number of sequences matching the filter, then exit",
    )
    parser.add_argument(
        "--max-sequences",
        help="Maximum number of sequences to clone from source annotation API",
        type=int,
        default=10,
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
    parser.add_argument(
        "--sequence-list",
        help=(
            "Comma-separated list of sequence alert_api_id (e.g. 158,16851,168468) "
            "or path to a text file containing the list"
        ),
        type=str,
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


def get_source_api_from_url(url: str) -> str:
    """
    Map platform URL to source_api enum value.

    Args:
        url: Platform API URL

    Returns:
        source_api enum value for the database
    """
    url_to_source_api = {
        "https://alertapi.pyronear.org": "pyronear_french",
        "https://apicenia.pyronear.org": "api_cenia",
    }
    return url_to_source_api.get(url, "pyronear_french")


def validate_args(args: argparse.Namespace, clone_from_annotation: bool) -> bool:
    """
    Validate parsed command line arguments.

    Args:
        args: Parsed arguments namespace
        clone_from_annotation: Whether we are cloning from annotation API

    Returns:
        True if arguments are valid, False otherwise
    """
    # Validate date range only when using platform mode
    if not clone_from_annotation:
        if args.date_from is None:
            logging.error("--date-from is required when using platform API")
            return False
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

    if args.max_sequences is not None and args.max_sequences < 1:
        logging.error("--max-sequences must be at least 1 when provided")
        return False

    # Validate worker count
    if args.max_workers < 1:
        logging.error("--max-workers must be at least 1")
        return False

    return True


def test_annotation_credentials(
    base_url: str, login: str, password: str, label: str, console: Console
) -> bool:
    """
    Attempt to authenticate against an annotation API endpoint.
    """
    try:
        annotation_api.get_auth_token(base_url, username=login, password=password)
        console.print(
            f"[green]✅ {label} auth OK[/] [dim]({login}@{base_url})[/]"
        )
        return True
    except Exception as exc:
        console.print(
            f"[red]❌ {label} auth failed[/]: {exc}"
        )
        return False


def parse_sequence_selection(sequence_arg: str) -> List[int]:
    """
    Parse a comma/whitespace-separated sequence list from CLI or a file.

    Args:
        sequence_arg: Raw CLI input or file path

    Returns:
        List of sequence IDs (alert_api_id)

    Raises:
        ValueError: If any entry cannot be parsed as int
    """
    if not sequence_arg:
        return []

    content = sequence_arg
    if os.path.isfile(sequence_arg):
        with open(sequence_arg, "r", encoding="utf-8") as handle:
            content = handle.read()

    tokens = [token.strip() for token in re.split(r"[,\s]+", content) if token.strip()]
    sequence_ids: List[int] = []
    for token in tokens:
        try:
            sequence_ids.append(int(token))
        except ValueError as exc:
            raise ValueError(f"Invalid sequence id '{token}' in sequence list") from exc

    return sequence_ids


def get_source_annotation_credentials() -> tuple[str, str]:
    """
    Resolve credentials for the source annotation API (clone mode).
    """
    login = os.getenv("MAIN_ANNOTATION_LOGIN") or os.getenv(
        "ANNOTATOR_LOGIN", "admin"
    )
    password = os.getenv("MAIN_ANNOTATION_PASSWORD") or os.getenv(
        "ANNOTATOR_PASSWORD", "admin12345"
    )
    return login, password


def count_sequences_from_annotation_api(
    source_annotation_url: str,
    clone_processing_stage: str,
    console: Console,
) -> int:
    """
    Count sequences from annotation API with a processing_stage filter.
    """
    login, password = get_source_annotation_credentials()
    auth_token = annotation_api.get_auth_token(
        source_annotation_url, username=login, password=password
    )
    params = {
        "page": 1,
        "size": 1,
    }
    if clone_processing_stage != "all":
        params["processing_stage"] = clone_processing_stage

    seq_page = annotation_api.list_sequences(
        source_annotation_url,
        auth_token,
        **params,
    )
    total = seq_page.get("total", len(seq_page.get("items", [])))
    console.print(
        f"[blue]ℹ️  Source annotation sequences matching processing_stage={clone_processing_stage}: [bold]{total}[/]"
    )
    return total


def fetch_records_from_annotation_api(
    source_annotation_url: str,
    selected_sequence_list: List[int],
    console: Console,
    suppress_logs: bool,
    max_sequences: Optional[int] = None,
    clone_processing_stage: str = "no_annotation",
) -> tuple[List[dict], str]:
    """
    Fetch sequences and detections directly from an annotation API instance.

    Args:
        source_annotation_url: Base URL of the source annotation API
        selected_sequence_list: List of alert_api_id to copy (empty means all)
        console: Rich console for output
        suppress_logs: Whether to suppress logs during progress
        max_sequences: Optional limit of sequences to clone

    Returns:
        Tuple of (records in platform-format, source_api value)
    """
    login, password = get_source_annotation_credentials()

    if not login or not password:
        raise ValueError("Missing source annotation credentials")

    console.print(
        f"[blue]🔄 Cloning from source annotation API at {source_annotation_url}[/]"
    )
    auth_token = annotation_api.get_auth_token(
        source_annotation_url, username=login, password=password
    )

    records: List[dict] = []
    source_api = None
    size = 100
    page = 1
    found_ids = set()
    targets = (
        set(selected_sequence_list[:max_sequences])
        if selected_sequence_list and max_sequences
        else set(selected_sequence_list)
        if selected_sequence_list
        else None
    )
    max_sequences = max_sequences if max_sequences and max_sequences > 0 else None
    cloned_sequences = 0
    total_detections = 0

    with LogSuppressor(suppress=suppress_logs):
        while True:
            seq_page = annotation_api.list_sequences(
                source_annotation_url,
                auth_token,
                page=page,
                size=size,
                processing_stage=None if clone_processing_stage == "all" else clone_processing_stage,
            )
            items = seq_page.get("items", [])
            console.print(
                f"[blue]📥 Page {page}/{seq_page.get('pages', 1)}: found {len(items)} sequences (cloned so far: {cloned_sequences})[/]"
            )

            for seq in items:
                alert_id = seq.get("alert_api_id")
                if targets and alert_id not in targets:
                    continue

                source_api = source_api or seq.get("source_api", "pyronear_french")
                found_ids.add(alert_id)
                cloned_sequences += 1

                # Fetch detections for this sequence
                det_page_num = 1
                while True:
                    det_page = annotation_api.list_detections(
                        source_annotation_url,
                        auth_token,
                        sequence_id=seq["id"],
                        page=det_page_num,
                        size=size,
                    )
                    detections = det_page.get("items", [])

                    for det in detections:
                        total_detections += 1
                        det_url = annotation_api.get_detection_url(
                            source_annotation_url, auth_token, det["id"]
                        )
                        records.append(
                            {
                                "organization_id": seq["organisation_id"],
                                "organization_name": seq["organisation_name"],
                                "camera_id": seq["camera_id"],
                                "camera_name": seq["camera_name"],
                                "camera_lat": seq.get("lat"),
                                "camera_lon": seq.get("lon"),
                                "camera_is_trustable": seq.get("camera_is_trustable"),
                                "camera_angle_of_view": seq.get("camera_angle_of_view"),
                                "sequence_id": seq.get("alert_api_id"),
                                "sequence_is_wildfire": seq.get(
                                    "is_wildfire_alertapi"
                                ),
                                "sequence_started_at": seq.get("recorded_at"),
                                "sequence_last_seen_at": seq.get("last_seen_at")
                                or seq.get("recorded_at"),
                                "sequence_azimuth": seq.get("azimuth"),
                                "detection_id": det.get("alert_api_id") or det["id"],
                                "detection_created_at": det.get("created_at")
                                or det.get("recorded_at"),
                                "detection_azimuth": det.get("azimuth"),
                                "detection_url": det_url,
                                "detection_bboxes": det.get("algo_predictions", {}),
                            "detection_bucket_key": det.get("bucket_key"),
                        }
                    )

                    if det_page_num >= det_page.get("pages", 1):
                        break
                    det_page_num += 1

                if max_sequences and cloned_sequences >= max_sequences:
                    console.print(
                        f"[yellow]⏹️ Reached max_sequences limit ({max_sequences}), stopping clone[/]"
                    )
                    break

            if max_sequences and cloned_sequences >= max_sequences:
                break

            if targets and found_ids >= targets:
                break
            if page >= seq_page.get("pages", 1):
                break
            page += 1

    console.print(
        f"[green]✅ Cloned {len(records)} detection records from source annotation API[/]"
    )
    console.print(
        f"   • [bold]{cloned_sequences}[/] sequences, [bold]{total_detections}[/] detections"
    )

    missing = (
        targets - found_ids if targets else set()
    )
    if missing:
        console.print(
            f"[yellow]⚠️ Missing {len(missing)} requested sequence(s) in source annotation API: {sorted(missing)}[/]"
        )

    return records, source_api or "pyronear_french"


def main() -> None:
    """Main execution function with comprehensive error handling and progress tracking."""
    parser = make_cli_parser()
    args = parser.parse_args()

    clone_from_annotation = bool(args.source_annotation_url)
    max_sequences = args.max_sequences
    clone_processing_stage = args.clone_processing_stage
    clone_count_only = args.clone_count_only

    # Setup logging
    logging.basicConfig(
        level=args.loglevel.upper(),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    logger = logging.getLogger(__name__)

    # Validate arguments
    if not validate_args(args, clone_from_annotation):
        sys.exit(1)

    # Get source_api from platform URL (can be overridden in clone mode)
    source_api = get_source_api_from_url(args.url_api_platform)

    # Initialize components
    worker_config = WorkerConfig(args.max_workers)
    console = Console()
    suppress_logs = args.loglevel != "debug"  # Suppress logs unless in debug mode
    step_manager = StepManager(console, show_timing=True)
    error_collector = ErrorCollector()

    # Initialize comprehensive statistics
    stats = {
        # Import statistics (Step 1)
        "records_fetched": 0,
        "sequences_attempted_import": 0,
        "sequences_import_successful": 0,
        "sequences_import_failed": 0,
        "detections_attempted_import": 0,
        "detections_import_successful": 0,
        "detections_import_failed": 0,
        # Annotation statistics (Step 4)
        "total_sequences_for_annotation": 0,
        "annotations_successful": 0,
        "annotations_failed": 0,
        "annotations_created": 0,
    }

    # Initialize organization early to avoid reference errors in exception handlers
    organization = (
        os.getenv("PLATFORM_LOGIN") if not clone_from_annotation else "annotation-clone"
    ) or "unknown"
    selected_sequence_list: List[int] = []
    sequence_list_source = "CLI input"

    # Parse optional sequence restriction
    if args.sequence_list:
        try:
            if os.path.isfile(args.sequence_list):
                sequence_list_source = f"file {args.sequence_list}"
            selected_sequence_list = parse_sequence_selection(args.sequence_list)
        except ValueError as exc:
            logging.error(exc)
            sys.exit(1)

    if selected_sequence_list:
        if max_sequences and len(selected_sequence_list) > max_sequences:
            console.print(
                f"[blue]ℹ️  Restricting to first {max_sequences} of "
                f"{len(selected_sequence_list)} provided sequence alert_api_id(s)[/]"
            )
            selected_sequence_list = selected_sequence_list[:max_sequences]
        console.print(
            f"[blue]ℹ️  Restricting to {len(selected_sequence_list)} sequence alert_api_id(s) ({sequence_list_source})[/]"
        )

    # Early credential checks for target (and source if cloning)
    target_login, target_password = shared.get_annotation_credentials(
        args.url_api_annotation
    )
    target_ok = test_annotation_credentials(
        args.url_api_annotation, target_login, target_password, "Target annotation", console
    )

    source_ok = True
    if clone_from_annotation:
        source_login, source_password = get_source_annotation_credentials()
        source_ok = test_annotation_credentials(
            args.source_annotation_url,
            source_login,
            source_password,
            "Source annotation",
            console,
        )

    if not target_ok or (clone_from_annotation and not source_ok):
        console.print("[red]❌ Aborting due to authentication failure[/]")
        sys.exit(1)

    # In clone count-only mode, just display the count and exit
    if clone_from_annotation and clone_count_only:
        count_sequences_from_annotation_api(
            args.source_annotation_url, clone_processing_stage, console
        )
        sys.exit(0)

    # Print header
    console.print()
    console.print(
        Panel(
            "[bold blue]Platform Data Import & Processing[/]",
            title="🔥 Pyronear Data Import",
            border_style="blue",
            padding=(0, 2),
        )
    )

    if args.loglevel == "debug":
        if clone_from_annotation:
            console.print(
                f"[blue]ℹ️  Clone source annotation API: {args.source_annotation_url}[/]"
            )
            if max_sequences:
                console.print(
                    f"[blue]ℹ️  Max sequences to clone: {max_sequences}[/]"
                )
            console.print(
                f"[blue]ℹ️  Clone processing_stage filter: {clone_processing_stage}[/]"
            )
        else:
            console.print(
                f"[blue]ℹ️  Date range: {args.date_from} to {args.date_end}[/]"
            )
            console.print(
                f"[blue]ℹ️  Platform: {args.url_api_platform} (source_api: {source_api})[/]"
            )
        console.print(f"[blue]ℹ️  Worker config: {worker_config}[/]")
        console.print(
            f"[blue]ℹ️  Analysis config: confidence={args.confidence_threshold}, iou={args.iou_threshold}, min_cluster={args.min_cluster_size}[/]"
        )

    try:
        # Step 1: Fetch platform data
        successfully_imported_sequence_ids = []
        step_manager.start_step(
            1,
            "Platform Data Import" if not clone_from_annotation else "Annotation Clone",
            (
                f"Cloning sequences from {args.source_annotation_url}"
                if clone_from_annotation
                else f"Fetching {organization} data from {args.date_from} to {args.date_end} using {worker_config.base_workers} workers"
            ),
        )

        if not clone_from_annotation and not shared.validate_available_env_variables():
            console.print(
                "[red]❌ Missing required environment variables for platform API[/]"
            )
            step_manager.complete_step(False, "Missing environment variables")
            sys.exit(1)

        if clone_from_annotation:
            # Fetch records directly from another annotation API instance
            try:
                records, source_api = fetch_records_from_annotation_api(
                    source_annotation_url=args.source_annotation_url,
                    selected_sequence_list=selected_sequence_list,
                    console=console,
                    suppress_logs=suppress_logs,
                    max_sequences=max_sequences,
                    clone_processing_stage=clone_processing_stage,
                )
            except Exception as e:
                error_collector.add_error(f"Annotation clone failed: {e}")
                step_manager.complete_step(False, f"Annotation clone failed: {e}")
                error_collector.print_summary(console, "Annotation Clone Errors")
                sys.exit(1)
        else:
            # Get platform credentials
            platform_login = os.getenv("PLATFORM_LOGIN")
            platform_password = os.getenv("PLATFORM_PASSWORD")
            platform_admin_login = os.getenv("PLATFORM_ADMIN_LOGIN")
            platform_admin_password = os.getenv("PLATFORM_ADMIN_PASSWORD")

            if not all(
                [
                    platform_login,
                    platform_password,
                    platform_admin_login,
                    platform_admin_password,
                ]
            ):
                error_collector.add_error("Missing platform credentials")
                step_manager.complete_step(False, "Missing platform credentials")
                sys.exit(1)

            # Get access tokens with progress display
            auth_start_time = time.time()
            with console.status(
                f"[bold blue]🔐 Authenticating with platform API ({organization})...",
                spinner="dots",
            ) as status:
                try:
                    status.update(f"[bold blue]🔐 Getting {organization} access token...")
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
                    console.print(
                        f"[green]✅ Authentication successful[/] [dim]({auth_duration:.1f}s)[/]"
                    )

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
                    selected_sequence_list=selected_sequence_list or None,
                    max_sequences=max_sequences,
                    suppress_logs=suppress_logs,
                    console=console,
                    error_collector=error_collector,
                    organization=organization,
                )
            except Exception as e:
                error_collector.add_error(f"Platform data fetching failed: {e}")
                step_manager.complete_step(False, f"Platform data fetching failed: {e}")
                error_collector.print_summary(console, "Platform Data Fetching Errors")
                sys.exit(1)

        if not records and not args.dry_run:
            msg = (
                "No records fetched from source annotation API"
                if clone_from_annotation
                else "No records fetched from platform API"
            )
            step_manager.complete_step(False, msg)
            sys.exit(0)

        # Post to annotation API (if not dry run)
        if not args.dry_run:
            console.print(
                f"[blue]🚀 Posting {len(records)} records to annotation API...[/]"
            )

            try:
                result = shared.post_records_to_annotation_api(
                    args.url_api_annotation,
                    records,
                    max_workers=worker_config.api_posting,
                    max_detection_workers=worker_config.detection_per_sequence,
                    suppress_logs=suppress_logs,
                    source_api=source_api,
                )

                # Capture import statistics in main stats and get successfully imported sequence IDs
                stats["records_fetched"] = len(records)
                stats["sequences_attempted_import"] = result["total_sequences"]
                stats["sequences_import_successful"] = result["successful_sequences"]
                stats["sequences_import_failed"] = result["failed_sequences"]
                stats["detections_attempted_import"] = result["total_detections"]
                stats["detections_import_successful"] = result["successful_detections"]
                stats["detections_import_failed"] = result["failed_detections"]
                successfully_imported_sequence_ids = result["successful_sequence_ids"]

                # Prepare step completion stats for display
                step_stats = {
                    "Records fetched": len(records),
                    "Sequences posted": f"{result['successful_sequences']}/{result['total_sequences']}",
                    "Sequences skipped": result.get("skipped_sequences", 0),
                    "Detections posted": f"{result['successful_detections']}/{result['total_detections']}",
                }

                step_success = (
                    result["failed_sequences"] == 0 and result["failed_detections"] == 0
                )
                step_message = (
                    "Platform data successfully imported"
                    if step_success
                    else "Platform data imported with some failures"
                )

                step_manager.complete_step(step_success, step_message, step_stats)

                if result["failed_sequences"] > 0 or result["failed_detections"] > 0:
                    error_collector.add_warning(
                        f"{result['failed_sequences']} sequences and {result['failed_detections']} detections failed to import (likely duplicates). "
                        "Enable --loglevel debug to see per-sequence errors."
                    )

            except Exception as e:
                error_collector.add_error(f"Failed to post data to annotation API: {e}")
                step_manager.complete_step(
                    False, f"Failed to post data to annotation API: {e}"
                )
                error_collector.print_summary(console, "Platform Data Import Errors")
                sys.exit(1)
        else:
            # For dry run, capture what would have been imported but don't set sequence IDs
            stats["records_fetched"] = len(records)
            step_stats = {"Records that would be posted": len(records)}
            step_manager.complete_step(
                True, "DRY RUN: Platform data fetch completed", step_stats
            )

        # Step 2: Prepare sequences for annotation generation
        step_manager.start_step(
            2,
            "Sequence Preparation",
            f"Preparing successfully imported {organization} sequences for annotation generation",
        )

        # Use only successfully imported sequences for annotation processing
        sequence_ids = successfully_imported_sequence_ids

        if not sequence_ids:
            step_message = "No sequences successfully imported - nothing to process for annotation generation"
            step_manager.complete_step(True, step_message)

            # Show final summary with zero processing and exit gracefully
            console.print()
            panel = Panel(
                f"[yellow]No sequences were successfully imported from {organization} platform data.\n"
                f"Check import statistics above for details (likely all were duplicates).[/]",
                title=f"⚠️ Processing Complete - {organization} - No Annotations Generated",
                border_style="yellow",
                padding=(1, 2),
            )
            console.print(panel)
            sys.exit(0)

        stats["total_sequences_for_annotation"] = len(sequence_ids)
        step_stats = {"Successfully imported sequences": len(sequence_ids)}
        step_manager.complete_step(
            True,
            f"Prepared {len(sequence_ids)} sequences for annotation generation",
            step_stats,
        )

        # Step 3: Create sequence annotations with auto-generation
        step_manager.start_step(
            3,
            "Sequence Annotation Creation",
            (
                f"Creating sequence annotations for {len(sequence_ids)} sequences (auto-generation enabled)"
                if not clone_from_annotation
                else f"Creating placeholder sequence annotations for {len(sequence_ids)} sequences (under annotation)"
            ),
        )

        # Prepare annotation configuration
        annotation_config = {
            "confidence_threshold": args.confidence_threshold,
            "iou_threshold": args.iou_threshold,
            "min_cluster_size": args.min_cluster_size,
        }

        with concurrent.futures.ThreadPoolExecutor(
            max_workers=worker_config.annotation_processing
        ) as executor:
            # Submit all sequence annotation tasks
            future_to_sequence_id = {
                (
                    executor.submit(
                        create_simple_sequence_annotation,
                        sequence_id=sequence_id,
                        annotation_api_url=args.url_api_annotation,
                        config=annotation_config,
                        dry_run=args.dry_run,
                        processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
                    )
                    if not clone_from_annotation
                    else executor.submit(
                        create_placeholder_sequence_annotation,
                        sequence_id=sequence_id,
                        annotation_api_url=args.url_api_annotation,
                        processing_stage=SequenceAnnotationProcessingStage.UNDER_ANNOTATION,
                        dry_run=args.dry_run,
                    )
                ): sequence_id
                for sequence_id in sequence_ids
            }

            # Collect results with progress tracking
            with LogSuppressor(suppress=suppress_logs):
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[bold blue]Creating sequence annotations"),
                    BarColumn(bar_width=40),
                    TaskProgressColumn(),
                    console=Console(),
                    transient=True,
                ) as progress_bar:
                    task = progress_bar.add_task(
                        "Processing sequences", total=len(future_to_sequence_id)
                    )
                    for future in concurrent.futures.as_completed(
                        future_to_sequence_id
                    ):
                        sequence_id = future_to_sequence_id[future]
                        try:
                            result = future.result()

                            # Update annotation statistics
                            if result["errors"]:
                                stats["annotations_failed"] += 1
                                for error in result["errors"]:
                                    error_collector.add_error(
                                        f"Sequence {sequence_id}: {error}"
                                    )
                            else:
                                stats["annotations_successful"] += 1

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
                            stats["annotations_failed"] += 1
                            progress_bar.advance(task)

        # Complete Step 3 with annotation statistics
        step_3_success = stats["annotations_failed"] == 0
        final_stats = {
            "Sequences processed": stats["total_sequences_for_annotation"],
            "Annotations successful": stats["annotations_successful"],
            "Annotations failed": stats["annotations_failed"],
            "Annotations created": stats["annotations_created"],
        }

        step_3_message = (
            "All sequence annotations created successfully"
            if step_3_success
            else f"{stats['annotations_failed']} annotation(s) failed"
        )
        if args.dry_run:
            step_3_message = "DRY RUN: " + step_3_message

        step_manager.complete_step(step_3_success, step_3_message, final_stats)

        # Show any accumulated errors/warnings
        if error_collector.has_issues():
            error_collector.print_summary(console, "Processing Summary")

        # Enhanced final summary panel with import and annotation breakdown
        console.print()

        # Determine overall success (critical failures, not including expected duplicates)
        has_critical_failures = (
            stats["annotations_failed"] > 0 or error_collector.get_error_count() > 0
        )

        success = not has_critical_failures
        style = "green" if success else "red"
        icon = "✅" if success else "❌"

        # Build comprehensive summary
        summary_parts = []

        # Platform Import Section
        if not args.dry_run:
            import_section = f"""[bold cyan]PLATFORM IMPORT:[/]
• Records fetched: {stats['records_fetched']}
• Sequences attempted: {stats['sequences_attempted_import']}
• Successfully imported: {stats['sequences_import_successful']}
• Failed/duplicates: {stats['sequences_import_failed']}"""
            summary_parts.append(import_section)

        # Annotation Generation Section
        annotation_section = f"""[bold blue]ANNOTATION GENERATION:[/]
• Sequences processed: {stats['total_sequences_for_annotation']}
• Annotations successful: {stats['annotations_successful']}
• Annotations failed: {stats['annotations_failed']}
• Annotations created: {stats['annotations_created']}"""
        summary_parts.append(annotation_section)

        # Join sections
        summary_text = "\n\n".join(summary_parts)

        # Add dry run notice
        if args.dry_run:
            summary_text += "\n\n[yellow]DRY RUN: No actual changes were made[/]"

        # Add context note about duplicates if applicable
        if (
            stats.get("sequences_import_failed", 0) > 0
            and stats["annotations_failed"] == 0
        ):
            summary_text += f"\n\n[dim]Note: {stats['sequences_import_failed']} sequences failed import (likely duplicates from re-running same dates)[/]"

        panel = Panel(
            summary_text,
            title=f"{icon} Processing Complete - {organization}",
            border_style=style,
            padding=(1, 2),
        )
        console.print(panel)

        # Exit with appropriate code (only exit with error for critical failures)
        if has_critical_failures:
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
