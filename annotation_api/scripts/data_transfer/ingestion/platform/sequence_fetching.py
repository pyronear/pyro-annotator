"""
Platform data fetching utilities for sequence and detection retrieval.

This module handles fetching sequences and detections from the Pyronear platform API,
including parallel processing, metadata loading, and error handling with progress tracking.

Functions:
    get_dates_within: Generate list of dates between start and end dates
    fetch_sequences_for_date: Fetch sequences for a specific date
    process_single_sequence_detections: Process detections for a single sequence
    fetch_all_sequences_within: Main function to fetch all sequences and detections

Example:
    >>> from sequence_fetching import fetch_all_sequences_within
    >>> from worker_config import WorkerConfig
    >>> from progress_management import ErrorCollector
    >>> from rich.console import Console
    >>>
    >>> console = Console()
    >>> error_collector = ErrorCollector()
    >>> worker_config = WorkerConfig(4)
    >>>
    >>> records = fetch_all_sequences_within(
    ...     date_from=date(2024, 1, 1),
    ...     date_end=date(2024, 1, 2),
    ...     detections_limit=30,
    ...     detections_order_by="asc",
    ...     api_endpoint="https://api.example.com",
    ...     access_token="token123",
    ...     access_token_admin="admin_token456",
    ...     worker_config=worker_config,
    ...     console=console,
    ...     error_collector=error_collector
    ... )
"""

import concurrent.futures
import logging
import time
from datetime import date, timedelta
from typing import List, Dict, Any, Optional

from rich.console import Console
from rich.progress import (
    Progress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    TaskProgressColumn,
)

from . import client as platform_client
from . import utils as platform_utils
from .progress_management import ErrorCollector, LogSuppressor
from .worker_config import WorkerConfig


def get_dates_within(date_from: date, date_end: date) -> List[date]:
    """
    Get all dates between date_from and date_end (inclusive).

    Args:
        date_from: Start date (inclusive)
        date_end: End date (inclusive)

    Returns:
        List of date objects from start to end

    Example:
        >>> from datetime import date
        >>> dates = get_dates_within(date(2024, 1, 1), date(2024, 1, 3))
        >>> len(dates)
        3
        >>> dates[0]
        datetime.date(2024, 1, 1)
    """
    dates = []
    current_date = date_from
    while current_date <= date_end:
        dates.append(current_date)
        current_date += timedelta(days=1)
    return dates


def fetch_sequences_for_date(
    api_endpoint: str, target_date: date, access_token: str
) -> List[Dict[str, Any]]:
    """
    Fetch sequences for a specific date from the platform API.

    Args:
        api_endpoint: Platform API endpoint URL
        target_date: Date to fetch sequences for
        access_token: API access token for authentication

    Returns:
        List of sequence dictionaries for the specified date

    Example:
        >>> sequences = fetch_sequences_for_date(
        ...     "https://api.example.com",
        ...     date(2024, 1, 1),
        ...     "token123"
        ... )
        >>> print(f"Found {len(sequences)} sequences")
    """
    try:
        sequences = platform_client.list_sequences_for_date(
            api_endpoint=api_endpoint,
            date=target_date,
            limit=1000,  # Large limit to get all sequences for the date
            offset=0,
            access_token=access_token,
        )
        return sequences
    except Exception as e:
        logging.error(f"Error fetching sequences for date {target_date}: {e}")
        return []


def process_single_sequence_detections(
    sequence: Dict[str, Any],
    indexed_cameras: Dict[int, Dict[str, Any]],
    indexed_organizations: Dict[int, Dict[str, Any]],
    api_endpoint: str,
    access_token: str,
    detections_limit: int,
    detections_order_by: str,
) -> List[Dict[str, Any]]:
    """
    Process detections for a single sequence.

    This function fetches detections for a sequence and builds flattened records
    by combining sequence, detection, camera, and organization metadata.

    Args:
        sequence: Sequence data dictionary
        indexed_cameras: Camera lookup dictionary (camera_id -> camera_data)
        indexed_organizations: Organization lookup dictionary (org_id -> org_data)
        api_endpoint: Platform API endpoint URL
        access_token: API access token for authentication
        detections_limit: Maximum number of detections to fetch per sequence
        detections_order_by: Order direction for detections ("asc" or "desc")

    Returns:
        List of flattened detection record dictionaries

    Example:
        >>> records = process_single_sequence_detections(
        ...     sequence={"id": 123, "camera_id": 456},
        ...     indexed_cameras={456: {"name": "Camera1", "organization_id": 789}},
        ...     indexed_organizations={789: {"name": "Org1"}},
        ...     api_endpoint="https://api.example.com",
        ...     access_token="token123",
        ...     detections_limit=30,
        ...     detections_order_by="asc"
        ... )
    """
    try:
        camera_id = sequence.get("camera_id")
        camera = indexed_cameras.get(camera_id, {})
        org_id = camera.get("organization_id")
        organization = indexed_organizations.get(org_id, {})

        # Fetch detections for this sequence
        detections = platform_client.list_sequence_detections(
            api_endpoint=api_endpoint,
            sequence_id=sequence["id"],
            access_token=access_token,
            limit=detections_limit,
            desc=(detections_order_by == "desc"),
        )

        # Build flattened records (one per detection) using the proven platform_utils.to_record function
        records = []
        for detection in detections:
            record = platform_utils.to_record(
                detection=detection,
                camera=camera,
                organization=organization,
                sequence=sequence,
            )
            records.append(record)

        return records

    except Exception as e:
        logging.error(f"Error processing sequence {sequence.get('id', 'unknown')}: {e}")
        return []


def fetch_all_sequences_within(
    date_from: date,
    date_end: date,
    detections_limit: int,
    detections_order_by: str,
    api_endpoint: str,
    access_token: str,
    access_token_admin: str,
    worker_config: WorkerConfig,
    selected_sequence_list: Optional[List[int]] = None,
    max_sequences: Optional[int] = None,
    suppress_logs: bool = True,
    console: Optional[Console] = None,
    error_collector: Optional[ErrorCollector] = None,
    organization: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch all sequences and detections between date_from and date_end.

    This is the main function for fetching platform data. It:
    1. Loads metadata (cameras and organizations) with progress display
    2. Fetches sequences for each date in the range using parallel processing
    3. Processes detections for each sequence using parallel processing
    4. Returns flattened records ready for annotation API posting

    Args:
        date_from: Start date for sequence fetching
        date_end: End date for sequence fetching
        detections_limit: Maximum detections per sequence
        detections_order_by: Order direction for detections ("asc" or "desc")
        api_endpoint: Platform API endpoint URL
        access_token: Regular user access token
        access_token_admin: Admin access token (for organization access)
        worker_config: WorkerConfig instance for intelligent scaling
        selected_sequence_list: Optional list of alert_api_id to restrict processing
        max_sequences: Optional maximum number of sequences to process after filtering
        suppress_logs: Whether to suppress log output during progress display
        console: Rich console for enhanced output (created if None)
        error_collector: Error collector for clean error reporting (created if None)

    Returns:
        List of flattened detection record dictionaries

    Raises:
        Exception: If metadata loading fails or other critical errors occur

    Example:
        >>> from datetime import date
        >>> from worker_config import WorkerConfig
        >>> from rich.console import Console
        >>>
        >>> console = Console()
        >>> worker_config = WorkerConfig(4)
        >>>
        >>> records = fetch_all_sequences_within(
        ...     date_from=date(2024, 1, 1),
        ...     date_end=date(2024, 1, 2),
        ...     detections_limit=30,
        ...     detections_order_by="asc",
        ...     api_endpoint="https://api.example.com",
        ...     access_token="token123",
        ...     access_token_admin="admin_token456",
        ...     worker_config=worker_config,
        ...     console=console
        ... )
        >>> print(f"Fetched {len(records)} detection records")
    """
    # Initialize defaults if not provided
    if console is None:
        console = Console()
    if error_collector is None:
        error_collector = ErrorCollector()

    # Load metadata with progress display
    metadata_start_time = time.time()
    with console.status(
        "[bold blue]📡 Loading platform metadata...", spinner="dots"
    ) as status:
        try:
            status.update("[bold blue]📡 Loading cameras...")
            cameras = platform_client.list_cameras(
                api_endpoint=api_endpoint, access_token=access_token
            )
            indexed_cameras = platform_utils.index_by(cameras, key="id")

            status.update("[bold blue]📡 Loading organizations...")
            organizations = platform_client.list_organizations(
                api_endpoint=api_endpoint,
                access_token=access_token_admin,
            )
            indexed_organizations = platform_utils.index_by(organizations, key="id")

            metadata_duration = time.time() - metadata_start_time
            console.print(
                f"[green]✅ Metadata loaded[/] [dim]({metadata_duration:.1f}s)[/]"
            )
            console.print(
                f"   • [bold]{len(cameras)}[/] cameras, [bold]{len(organizations)}[/] organizations"
            )

        except Exception as e:
            error_msg = f"Failed to load platform metadata: {e}"
            error_collector.add_error(error_msg)
            raise Exception(error_msg)

    # Prepare date range
    dates = get_dates_within(date_from=date_from, date_end=date_end)

    # Better date range display
    if len(dates) == 1:
        console.print(f"[blue]📅 Processing [bold]1 day[/]: {dates[0]:%Y-%m-%d}[/]")
    elif len(dates) <= 3:
        date_list = ", ".join(d.strftime("%Y-%m-%d") for d in dates)
        console.print(f"[blue]📅 Processing [bold]{len(dates)} days[/]: {date_list}[/]")
    else:
        console.print(
            f"[blue]📅 Processing [bold]{len(dates)} days[/]: {dates[0]:%Y-%m-%d} to {dates[-1]:%Y-%m-%d}[/]"
        )

    # Fetch sequences for all dates using parallel processing
    sequences = []
    with concurrent.futures.ProcessPoolExecutor() as executor:
        future_to_date = {
            executor.submit(
                fetch_sequences_for_date, api_endpoint, mdate, access_token
            ): mdate
            for mdate in dates
        }
        with LogSuppressor(suppress=suppress_logs):
            with Progress(
                SpinnerColumn(),
                TextColumn("[bold blue]Fetching sequences by date"),
                BarColumn(bar_width=40),
                TaskProgressColumn(),
                console=Console(),
                transient=True,
            ) as progress_bar:
                task = progress_bar.add_task(
                    "Processing dates", total=len(future_to_date)
                )
                for future in concurrent.futures.as_completed(future_to_date):
                    sequences.extend(future.result())
                    progress_bar.advance(task)

    # Optionally filter sequences by alert_api_id
    if selected_sequence_list:
        pre_filter_count = len(sequences)
        sequences = [
            sequence
            for sequence in sequences
            if sequence.get("alert_api_id") in selected_sequence_list
        ]
        filtered_out = pre_filter_count - len(sequences)
        console.print(
            f"[blue]🔍 Filtered sequences by alert_api_id[/] "
            f"[dim]({filtered_out} skipped, {len(sequences)} remaining)[/]"
        )

    # Optionally cap total sequences
    if max_sequences is not None and max_sequences > 0 and len(sequences) > max_sequences:
        sequences = sequences[:max_sequences]
        console.print(
            f"[blue]🔍 Applying max_sequences cap[/] "
            f"[dim](processing first {max_sequences} sequences)[/]"
        )

    console.print(f"[green]✅ Found {len(sequences)} sequences[/]")

    # Now fetch detections and build flattened records using parallel processing
    records = []
    first_sequence_logged = False

    # Create organization-aware processing message
    org_context = f" {organization}" if organization else ""
    console.print(
        f"[blue]🔄 Processing{org_context} sequences with {worker_config.detection_fetching} workers[/]"
    )
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=worker_config.detection_fetching
    ) as executor:
        # Submit all tasks
        future_to_sequence = {
            executor.submit(
                process_single_sequence_detections,
                sequence,
                indexed_cameras,
                indexed_organizations,
                api_endpoint,
                access_token,
                detections_limit,
                detections_order_by,
            ): sequence
            for sequence in sequences
        }

        # Collect results with progress tracking
        with LogSuppressor(suppress=suppress_logs):
            # Create organization-aware progress text
            progress_text = f"[bold blue]Processing{org_context} sequence detections"
            with Progress(
                SpinnerColumn(),
                TextColumn(progress_text),
                BarColumn(bar_width=40),
                TaskProgressColumn(),
                console=Console(),
                transient=True,
            ) as progress_bar:
                task = progress_bar.add_task(
                    "Fetching detections", total=len(future_to_sequence)
                )
                for future in concurrent.futures.as_completed(future_to_sequence):
                    sequence = future_to_sequence[future]
                    try:
                        sequence_records = future.result()

                        # Debug logging for first successful sequence (only if not suppressed)
                        if not first_sequence_logged and sequence_records:
                            first_sequence_logged = True
                            camera_id = sequence.get("camera_id")
                            camera = indexed_cameras.get(camera_id, {})
                            org_id = camera.get("organization_id")
                            organization = indexed_organizations.get(org_id, {})

                            logging.debug(f"Sample sequence structure: {sequence}")
                            logging.debug(f"Sample camera structure: {camera}")
                            logging.debug(
                                f"Sample organization structure: {organization}"
                            )
                            logging.debug(
                                f"Sample record structure: {sequence_records[0] if sequence_records else 'No records'}"
                            )

                        records.extend(sequence_records)
                        progress_bar.advance(task)

                    except Exception as e:
                        # Collect errors instead of logging immediately
                        error_msg = f"Error processing sequence {sequence.get('id', 'unknown')}: {e}"
                        error_collector.add_error(error_msg)
                        progress_bar.advance(task)
                        continue

    # Show final results
    console.print("[green]✅ Processing complete[/]")
    console.print(
        f"   • [bold]{len(records)}[/] detection records from [bold]{len(sequences)}[/] sequences"
    )

    # Show errors if any occurred
    if error_collector.has_issues():
        error_collector.print_summary(console, "Sequence Processing Issues")

    return records
