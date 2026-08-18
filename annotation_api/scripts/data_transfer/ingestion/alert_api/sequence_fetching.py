"""
Alert API data fetching utilities for sequence and detection retrieval.

This module handles fetching sequences and detections from the Pyronear alert API,
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
from typing import List, Dict, Any, Optional, Set, Tuple

from rich.console import Console
from rich.progress import (
    Progress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    TaskProgressColumn,
)

from . import client as alert_api_client
from . import utils as alert_api_utils
from .progress_management import ErrorCollector, LogSuppressor
from .worker_config import WorkerConfig


def temporal_scores_unsupported(sequences: List[Dict[str, Any]]) -> bool:
    """True when the alert API never sends the temporal-model score field.

    `temporal_model_score` is a declared field on the alert API's SequenceRead,
    so it is always serialized — as `null` for a sequence the platform never
    scored. Its total absence across every fetched sequence therefore means the
    alert API predates temporal validation (pyro-api #615, 2026-06-11) rather
    than "nothing scored today".

    The distinction matters because both cases otherwise import identically:
    every sequence lands with a NULL score and the run reports success. Empty
    input is not evidence either way, so it returns False.
    """
    if not sequences:
        return False
    return not any("temporal_model_score" in sequence for sequence in sequences)


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
    api_endpoint: str,
    target_date: date,
    access_token: str,
    risk_score: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch sequences for a specific date from the alert API.

    Args:
        api_endpoint: Alert API endpoint URL
        target_date: Date to fetch sequences for
        access_token: API access token for authentication
        risk_score: Optional FWI class override forwarded to the alert API.
            None applies the default per-camera risk filter (drops low-FWI sequences).

    Returns:
        List of sequence dictionaries for the specified date
    """
    page_size = 1000
    offset = 0
    sequences: List[Dict[str, Any]] = []
    try:
        while True:
            page = alert_api_client.list_sequences_for_date(
                api_endpoint=api_endpoint,
                date=target_date,
                limit=page_size,
                offset=offset,
                access_token=access_token,
                risk_score=risk_score,
            )
            sequences.extend(page)
            if len(page) < page_size:
                break
            offset += page_size
        return sequences
    except Exception as e:
        logging.error(f"Error fetching sequences for date {target_date}: {e}")
        return sequences


def filter_sequences(
    sequences: List[Dict[str, Any]],
    *,
    camera_org: Dict[int, Optional[int]],
    organization_ids: Optional[Set[int]],
    skip_ids: Set[int],
) -> List[Dict[str, Any]]:
    """Drop sequences we must not, or need not, fetch detections for.

    Applied immediately after the date listing and before any per-sequence
    detection call — that ordering is the whole point. The importer otherwise
    only discovers "already exists" at POST time, after paying for every fetch.

    A sequence whose camera is absent from the index cannot be attributed to an
    organization; it is dropped when filtering by organization (importing it
    would silently ingest an org the operator never enabled) and kept when not.
    """
    kept = []
    for sequence in sequences:
        if sequence["id"] in skip_ids:
            continue
        if organization_ids is not None:
            org = camera_org.get(sequence.get("camera_id"))
            if org is None or org not in organization_ids:
                continue
        kept.append(sequence)
    return kept


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
        api_endpoint: Alert API endpoint URL
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
    camera_id = sequence.get("camera_id")
    camera = indexed_cameras.get(camera_id, {})
    org_id = camera.get("organization_id")
    organization = indexed_organizations.get(org_id, {})

    # The alert API stores one Detection row per bbox even when several boxes
    # share the same image (each row carries `bbox` + the siblings in
    # `others_bboxes`). We dedupe by `bucket_key` below to import one record
    # per image, and `to_record` then re-assembles all boxes for that image
    # from the retained row's bbox + others_bboxes.
    #
    # The alert API's /sequences/{id}/detections endpoint doesn't support
    # offset pagination and caps `limit` at 100. When `detections_limit > 0`
    # we fetch a small buffer above the requested count so the unique-image
    # count stays close to what the caller asked for even when a few images
    # carry multiple bboxes; `<= 0` means "no limit, fetch all the API will
    # return" (matches the `--max-sequences 0` convention used elsewhere).
    if detections_limit and detections_limit > 0:
        fetch_limit = min(detections_limit + 10, 100)
        unique_cap: Optional[int] = detections_limit
    else:
        fetch_limit = 100
        unique_cap = None

    detections = alert_api_client.list_sequence_detections(
        api_endpoint=api_endpoint,
        sequence_id=sequence["id"],
        access_token=access_token,
        limit=fetch_limit,
        desc=(detections_order_by == "desc"),
    )

    unique_detections: list[dict] = []
    seen_bucket_keys: set[str] = set()
    for detection in detections:
        if unique_cap is not None and len(unique_detections) >= unique_cap:
            break
        bucket_key = detection.get("bucket_key")
        if bucket_key is None or bucket_key in seen_bucket_keys:
            continue
        seen_bucket_keys.add(bucket_key)
        unique_detections.append(detection)

    return [
        alert_api_utils.to_record(
            detection=detection,
            camera=camera,
            organization=organization,
            sequence=sequence,
        )
        for detection in unique_detections
    ]


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
    risk_score: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch all sequences and detections between date_from and date_end.

    This is the main function for fetching alert API data. It:
    1. Loads metadata (cameras and organizations) with progress display
    2. Fetches sequences for each date in the range using parallel processing
    3. Processes detections for each sequence using parallel processing
    4. Returns flattened records ready for annotation API posting

    Args:
        date_from: Start date for sequence fetching
        date_end: End date for sequence fetching
        detections_limit: Maximum detections per sequence
        detections_order_by: Order direction for detections ("asc" or "desc")
        api_endpoint: Alert API endpoint URL
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

    indexed_cameras, indexed_organizations = load_alert_api_metadata(
        api_endpoint=api_endpoint,
        access_token=access_token,
        access_token_admin=access_token_admin,
        console=console,
        error_collector=error_collector,
    )
    sequences = list_sequences_within(
        date_from=date_from,
        date_end=date_end,
        api_endpoint=api_endpoint,
        access_token=access_token,
        selected_sequence_list=selected_sequence_list,
        max_sequences=max_sequences,
        suppress_logs=suppress_logs,
        console=console,
        risk_score=risk_score,
    )
    return fetch_detections_for_sequences(
        sequences=sequences,
        indexed_cameras=indexed_cameras,
        indexed_organizations=indexed_organizations,
        api_endpoint=api_endpoint,
        access_token=access_token,
        detections_limit=detections_limit,
        detections_order_by=detections_order_by,
        worker_config=worker_config,
        suppress_logs=suppress_logs,
        console=console,
        error_collector=error_collector,
        organization=organization,
    )


def load_alert_api_metadata(
    api_endpoint: str,
    access_token: str,
    access_token_admin: str,
    console: Optional[Console] = None,
    error_collector: Optional[ErrorCollector] = None,
) -> Tuple[Dict[int, Dict[str, Any]], Dict[int, Dict[str, Any]]]:
    """Load the camera and organization indexes used to enrich records.

    Split out of `fetch_all_sequences_within` so a caller that needs the camera
    index *before* deciding which sequences deserve a detection fetch (see
    `filter_sequences`) can reuse it instead of listing cameras twice.
    """
    if console is None:
        console = Console()
    if error_collector is None:
        error_collector = ErrorCollector()

    # Load metadata with progress display
    metadata_start_time = time.time()
    with console.status(
        "[bold blue]📡 Loading alert API metadata...", spinner="dots"
    ) as status:
        try:
            status.update("[bold blue]📡 Loading cameras...")
            cameras = alert_api_client.list_cameras(
                api_endpoint=api_endpoint, access_token=access_token
            )
            indexed_cameras = alert_api_utils.index_by(cameras, key="id")

            status.update("[bold blue]📡 Loading organizations...")
            organizations = alert_api_client.list_organizations(
                api_endpoint=api_endpoint,
                access_token=access_token_admin,
            )
            indexed_organizations = alert_api_utils.index_by(organizations, key="id")

            metadata_duration = time.time() - metadata_start_time
            console.print(
                f"[green]✅ Metadata loaded[/] [dim]({metadata_duration:.1f}s)[/]"
            )
            console.print(
                f"   • [bold]{len(cameras)}[/] cameras, [bold]{len(organizations)}[/] organizations"
            )

        except Exception as e:
            error_msg = f"Failed to load alert API metadata: {e}"
            error_collector.add_error(error_msg)
            raise Exception(error_msg)

    return indexed_cameras, indexed_organizations


def list_sequences_within(
    date_from: date,
    date_end: date,
    api_endpoint: str,
    access_token: str,
    selected_sequence_list: Optional[List[int]] = None,
    max_sequences: Optional[int] = None,
    suppress_logs: bool = True,
    console: Optional[Console] = None,
    risk_score: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List the alert sequences in the date range, without their detections.

    Split out of `fetch_all_sequences_within` so the organization / already-seen
    filters can run between the listing and the per-sequence detection fetch.
    """
    if console is None:
        console = Console()

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
                fetch_sequences_for_date,
                api_endpoint,
                mdate,
                access_token,
                risk_score,
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

    # Optionally filter sequences by alert_api_id.
    # The raw alert sequences expose this value as the `id` field; the
    # `alert_api_id` rename happens later in shared.py when records are
    # formatted for the annotation API, so we cannot read it back here.
    if selected_sequence_list:
        pre_filter_count = len(sequences)
        sequences = [
            sequence
            for sequence in sequences
            if sequence.get("id") in selected_sequence_list
        ]
        filtered_out = pre_filter_count - len(sequences)
        console.print(
            f"[blue]🔍 Filtered sequences by alert_api_id[/] "
            f"[dim]({filtered_out} skipped, {len(sequences)} remaining)[/]"
        )

    # Optionally cap total sequences
    if (
        max_sequences is not None
        and max_sequences > 0
        and len(sequences) > max_sequences
    ):
        sequences = sequences[:max_sequences]
        console.print(
            f"[blue]🔍 Applying max_sequences cap[/] "
            f"[dim](processing first {max_sequences} sequences)[/]"
        )

    console.print(f"[green]✅ Found {len(sequences)} sequences[/]")

    return sequences


def fetch_detections_for_sequences(
    sequences: List[Dict[str, Any]],
    indexed_cameras: Dict[int, Dict[str, Any]],
    indexed_organizations: Dict[int, Dict[str, Any]],
    api_endpoint: str,
    access_token: str,
    detections_limit: int,
    detections_order_by: str,
    worker_config: WorkerConfig,
    suppress_logs: bool = True,
    console: Optional[Console] = None,
    error_collector: Optional[ErrorCollector] = None,
    organization: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Fetch each listed sequence's detections and flatten them into records.

    Split out of `fetch_all_sequences_within`; this is the expensive stage the
    `filter_sequences` short-circuit exists to keep work out of.
    """
    if console is None:
        console = Console()
    if error_collector is None:
        error_collector = ErrorCollector()

    # Without this the two cases are indistinguishable: an alert API that
    # predates temporal validation imports exactly like a day where nothing was
    # scored — every sequence NULL, run reports success. Warn rather than fail:
    # not every alert API deployment (e.g. CENIA) necessarily runs the feature,
    # and a missing provenance field must not block ingestion.
    if temporal_scores_unsupported(sequences):
        message = (
            "Alert API responses carry no `temporal_model_score` field at all "
            f"({len(sequences)} sequences checked) — this deployment predates "
            "temporal validation. Every sequence will import with a NULL score, "
            "which is indistinguishable from 'never scored' downstream."
        )
        console.print(f"[yellow]⚠️  {message}[/]")
        error_collector.add_error(message)

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
