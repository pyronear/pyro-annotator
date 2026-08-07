"""
CLI script for end-to-end alert API data import and processing.

This script provides a streamlined workflow to fetch alert API data and generate annotations:
1. Fetch sequences and detections from the Pyronear alert API
2. Split each alert sequence into one object sequence per detected object
   (sibling objects sharing the same set of frames). Sequences where no object
   reaches the spawn threshold are imported whole as a single sequence
   (fallback); when at least one object qualifies, boxes that never reach the
   threshold are dropped (same rule as the platform frontend), so annotation happens
   per object rather than per camera event
3. Import the resulting object sequences into the annotation API
4. Generate annotations from AI predictions for successfully imported object sequences only
5. Set object sequences to READY_TO_ANNOTATE stage

Usage:
  # Basic usage - full pipeline for date range
  uv run python -m scripts.data_transfer.ingestion.alert_api.import --date-from 2024-01-01 --date-end 2024-01-02

  # Route images via the /from-url endpoint (needed when the annotation API
  # can't reach the alert API's S3 bucket, e.g. local dev with LocalStack)
  uv run python -m scripts.data_transfer.ingestion.alert_api.import --date-from 2024-01-01 --image-transfer url

  # Dry run to preview what would be processed
  uv run python -m scripts.data_transfer.ingestion.alert_api.import --date-from 2024-01-01 --dry-run

Arguments:
  --date-from (date): Start date for sequences (YYYY-MM-DD format)
  --date-end (date): End date for sequences (YYYY-MM-DD format, defaults to today)
  --alert-api-url (str): Alert API URL (default: https://alertapi.pyronear.org)
  --annotation-api-url (str): Annotation API URL (default: http://localhost:5050)
  --max-sequences (int): Maximum number of sequences to import (default: 0, 0 = no cap)
  --frames-limit (int): Maximum number of images to import per sequence (default: 30)
  --sequence-list (str): Comma-separated list of sequence alert_api_id, or path to a file
  --image-transfer (str): How detection images reach the annotation API (bucket-copy/url; default: bucket-copy for the French alert API, url for CENIA)
  --max-workers (int): Max workers for parallel processing, auto-scales for different operations (default: 4)
  --dry-run: Preview actions without execution
  --loglevel (str): Logging level (debug/info/warning/error, default: info)

Environment variables required:
  ALERT_API_LOGIN (str): Alert API login
  ALERT_API_PASSWORD (str): Alert API password
  ALERT_API_ADMIN_LOGIN (str): Admin login for organization access
  ALERT_API_ADMIN_PASSWORD (str): Admin password for organization access
  (legacy PLATFORM_* names are still accepted as a deprecated fallback)
  MAIN_ANNOTATION_LOGIN / MAIN_ANNOTATION_PASSWORD (str): Annotation API credentials
    used when --annotation-api-url is not localhost (remote target)
  LOCAL_ANNOTATION_LOGIN / LOCAL_ANNOTATION_PASSWORD (str): Annotation API credentials
    used when --annotation-api-url is localhost/127.*
  Both fall back to ANNOTATOR_LOGIN / ANNOTATOR_PASSWORD if unset (see
  shared.get_annotation_credentials)

Examples:
  # Basic usage
  uv run python -m scripts.data_transfer.ingestion.alert_api.import --date-from 2024-01-01 --date-end 2024-01-02

  # Restrict to a specific list of sequences
  uv run python -m scripts.data_transfer.ingestion.alert_api.import --date-from 2024-01-01 --sequence-list 158,16851,168468

  # Dry run to see what would be processed
  uv run python -m scripts.data_transfer.ingestion.alert_api.import --date-from 2024-01-01 --dry-run --loglevel debug

  # High-performance processing with more workers
  uv run python -m scripts.data_transfer.ingestion.alert_api.import --date-from 2024-01-01 --max-workers 8
"""

import argparse
import logging
import os
import re
import sys
from datetime import datetime
from typing import List, Optional

from dotenv import load_dotenv
from rich.console import Console

from .annotation_management import valid_date
from .runner import ImportConfig, run_import
from . import shared
from app.clients import annotation_api

load_dotenv()


def make_cli_parser() -> argparse.ArgumentParser:
    """
    Create the CLI argument parser with comprehensive options.

    Returns:
        Configured ArgumentParser instance
    """
    parser = argparse.ArgumentParser(
        description="End-to-end alert API data import and processing",
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
        "--alert-api-url",
        help="Alert API URL (alertapi.pyronear.org for Pyronear French, apicenia.pyronear.org for CENIA)",
        type=str,
        choices=["https://alertapi.pyronear.org", "https://apicenia.pyronear.org"],
        default="https://alertapi.pyronear.org",
    )
    parser.add_argument(
        "--annotation-api-url",
        help="Annotation API URL",
        type=str,
        default="http://localhost:5050",
    )
    parser.add_argument(
        "--max-sequences",
        help="Maximum number of sequences to import from the alert API (0 = no cap)",
        type=int,
        default=0,
    )

    # Alert API fetching options
    parser.add_argument(
        "--frames-limit",
        help="Maximum number of images to import per sequence",
        type=int,
        default=30,
    )
    parser.add_argument(
        "--sequence-list",
        help=(
            "Comma-separated list of sequence alert_api_id (e.g. 158,16851,168468) "
            "or path to a text file containing the list"
        ),
        type=str,
    )

    # Processing control
    parser.add_argument(
        "--image-transfer",
        help=(
            "How detection images reach the annotation API: 'bucket-copy' asks the "
            "server to copy the object straight from the alert API's S3 bucket; "
            "'url' posts via the /from-url endpoint instead. Default: bucket-copy "
            "for the French alert API, url for CENIA (the server can only "
            "bucket-copy from the French alert API's buckets). 'url' is also "
            "required for local dev where the annotation API can't reach the "
            "alert API bucket (e.g. LocalStack)."
        ),
        type=str,
        choices=["bucket-copy", "url"],
        default=None,
    )
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
    Map alert API URL to source_api enum value.

    Args:
        url: Alert API URL

    Returns:
        source_api enum value for the database
    """
    url_to_source_api = {
        "https://alertapi.pyronear.org": "pyronear_french",
        "https://apicenia.pyronear.org": "api_cenia",
    }
    return url_to_source_api.get(url, "pyronear_french")


def validate_args(args: argparse.Namespace) -> bool:
    """
    Validate parsed command line arguments.

    Args:
        args: Parsed arguments namespace

    Returns:
        True if arguments are valid, False otherwise
    """
    if args.date_from > args.date_end:
        logging.error("--date-from must be earlier than or equal to --date-end")
        return False

    if args.max_sequences is not None and args.max_sequences < 0:
        logging.error("--max-sequences must be 0 or greater when provided")
        return False

    # Validate worker count
    if args.max_workers < 1:
        logging.error("--max-workers must be at least 1")
        return False

    return True


def authenticate_annotation_api(
    base_url: str, login: str, password: str, label: str, console: Console
) -> Optional[str]:
    """
    Attempt to authenticate against an annotation API endpoint.

    Returns the access token, or None when authentication failed.
    """
    try:
        token = annotation_api.get_auth_token(
            base_url, username=login, password=password
        )
        console.print(f"[green]✅ {label} auth OK[/] [dim]({login}@{base_url})[/]")
        return token
    except Exception as exc:
        console.print(f"[red]❌ {label} auth failed[/]: {exc}")
        return None


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


def main() -> None:
    """Parse argv and the environment into an ImportConfig, then run the import."""
    parser = make_cli_parser()
    args = parser.parse_args()

    max_sequences = args.max_sequences

    # Setup logging
    logging.basicConfig(
        level=args.loglevel.upper(),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    # bucket-copy derives its source bucket from the French deployment's
    # config (PLATFORM_SERVER_NAME), so it cannot work against CENIA.
    is_cenia = "apicenia" in args.alert_api_url
    if args.image_transfer is None:
        args.image_transfer = "url" if is_cenia else "bucket-copy"
        if is_cenia:
            logging.info(
                "Auto-selected --image-transfer url for the CENIA alert API "
                "(bucket-copy only works against the French alert API's buckets)"
            )
    elif args.image_transfer == "bucket-copy" and is_cenia:
        logging.warning(
            "--image-transfer bucket-copy against the CENIA alert API will fail: "
            "the annotation API copies from the French alert API's buckets. "
            "Every detection will error and its sequence will be rolled back."
        )

    # Validate arguments
    if not validate_args(args):
        sys.exit(1)

    # Get source_api from alert API URL
    source_api = get_source_api_from_url(args.alert_api_url)

    console = Console()

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

    # Early credential check for target annotation API
    target_login, target_password = shared.get_annotation_credentials(
        args.annotation_api_url
    )
    annotation_api_token = authenticate_annotation_api(
        args.annotation_api_url,
        target_login,
        target_password,
        "Target annotation",
        console,
    )

    if annotation_api_token is None:
        console.print("[red]❌ Aborting due to authentication failure[/]")
        sys.exit(1)

    if not shared.validate_available_env_variables():
        console.print("[red]❌ Missing required environment variables for alert API[/]")
        sys.exit(1)

    config = ImportConfig(
        alert_api_url=args.alert_api_url,
        login=shared.getenv_with_fallback("ALERT_API_LOGIN") or "",
        password=shared.getenv_with_fallback("ALERT_API_PASSWORD") or "",
        admin_login=shared.getenv_with_fallback("ALERT_API_ADMIN_LOGIN") or "",
        admin_password=shared.getenv_with_fallback("ALERT_API_ADMIN_PASSWORD") or "",
        annotation_api_url=args.annotation_api_url,
        annotation_api_token=annotation_api_token,
        date_from=args.date_from,
        date_end=args.date_end,
        source_api=source_api,
        image_transfer=args.image_transfer,
        max_workers=args.max_workers,
        frames_limit=args.frames_limit,
        max_sequences=max_sequences,
        dry_run=args.dry_run,
        # The CLI is the interactive caller: it wants the rich progress output
        # that the worker suppresses.
        quiet=False,
        selected_sequence_ids=selected_sequence_list or None,
    )

    result = run_import(config)
    sys.exit(0 if result.ok else 1)


if __name__ == "__main__":
    main()
