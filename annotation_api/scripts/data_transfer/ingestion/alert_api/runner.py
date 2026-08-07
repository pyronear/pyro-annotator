"""The importer as a library.

`import.py` remains the CLI entry point (and keeps its name — the Makefile target
depends on it); it parses argv and environment into an ImportConfig and calls
run_import. The worker builds the same config from a connector row. One
implementation, two callers.
"""

import concurrent.futures
import logging
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional, Set

from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    Progress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    TaskProgressColumn,
)

from . import client as alert_api_client
from . import object_split
from . import shared
from .annotation_management import annotate_split_sequence
from .progress_management import ErrorCollector, StepManager, LogSuppressor
from .sequence_fetching import (
    fetch_detections_for_sequences,
    filter_sequences,
    list_sequences_within,
    load_alert_api_metadata,
)
from .worker_config import WorkerConfig

logger = logging.getLogger(__name__)

DEFAULT_RISK_SCORE = "extreme"


@dataclass(frozen=True)
class ImportConfig:
    alert_api_url: str
    login: str
    password: str
    # The importer authenticates twice: a listing token, and an admin token for
    # camera/organization metadata. A connector supplies one credential pair for
    # both — the premise the verify endpoint tests.
    admin_login: str
    admin_password: str
    annotation_api_url: str
    annotation_api_token: str
    date_from: date
    date_end: date
    source_api: str
    image_transfer: Optional[str] = None
    max_workers: int = 4
    frames_limit: int = 30
    max_sequences: int = 0  # 0 = unlimited
    dry_run: bool = False
    quiet: bool = True
    organization_ids: Optional[Set[int]] = None
    skip_platform_alert_ids: frozenset = field(default_factory=frozenset)
    # Neutralizes the alert API's per-camera FWI filter so low-risk sequences are
    # not silently dropped. Carried over from the CLI's behaviour.
    risk_score: str = DEFAULT_RISK_SCORE
    # CLI-only: `--sequence-list` restricts the run to these alert_api_id.
    selected_sequence_ids: Optional[List[int]] = None


@dataclass
class OrganizationStats:
    alerts_fetched: int = 0
    alerts_imported: int = 0
    # Both causes of "we did not import this, and that is fine": dropped by the
    # pre-fetch filter as already present, AND reported by the annotation API as
    # already existing at POST time. The two populations are disjoint.
    alerts_skipped: int = 0
    alerts_failed: int = 0
    lanes_created: int = 0


@dataclass
class ImportResult:
    per_organization: dict[int, OrganizationStats] = field(default_factory=dict)
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None


def _debug_logging_enabled() -> bool:
    """True when the caller configured DEBUG logging.

    The CLI used to read `args.loglevel == "debug"` directly; it calls
    `logging.basicConfig(level=...)` from the same flag, so reading the root
    logger back keeps the behaviour without adding a config field.
    """
    return logging.getLogger().isEnabledFor(logging.DEBUG)


def auto_skip_boxless(
    annotation_api_url: str,
    auth_token: str,
    source_api: str,
    boxless_alert_ids: List[int],
    console: Console,
    error_collector: ErrorCollector,
) -> dict:
    """
    Best-effort auto-skip of boxless alerts (#333): park their zero-object
    lanes via the skip overlay. Never raises — a skip failure must not fail
    an otherwise successful import.

    Takes the already-resolved annotation-API token (`ImportConfig.annotation_api_token`)
    rather than minting one from login/password: the worker self-mints a JWT and
    has no ANNOTATOR_LOGIN/ANNOTATOR_PASSWORD in its environment, so a
    get_auth_token call here would fail in that caller.
    """
    counts = {"skipped": 0, "already_skipped": 0, "failed": 0}
    try:
        counts = shared.skip_boxless_alerts(
            annotation_api_url, auth_token, source_api, boxless_alert_ids
        )
    except Exception as exc:
        counts["failed"] = len(boxless_alert_ids)
        logging.warning("boxless auto-skip aborted: %s", exc)
    console.print(
        f"[blue]⏭️  Auto-skipped {counts['skipped']} boxless alert(s) "
        f"({counts['already_skipped']} already skipped, "
        f"{counts['failed']} failed): {boxless_alert_ids}[/]"
    )
    if counts["failed"] > 0:
        error_collector.add_warning(
            f"{counts['failed']} boxless alert(s) could not be auto-skipped; "
            "their zero-object lanes remain in the queue."
        )
    return counts


def run_import(config: ImportConfig) -> ImportResult:
    """Run the full alert-API import pipeline.

    This is `import.py:main()`'s pipeline, minus argv/environment handling:
    authenticate, list the sequences for the date range, drop the ones we must
    not or need not fetch, fetch their detections, object-split them, post them,
    then write one annotation per posted object sequence.

    Returns an `ImportResult` instead of calling `sys.exit`; `error` is set for
    every condition the CLI used to exit non-zero on.
    """
    console = Console(quiet=config.quiet)
    worker_config = WorkerConfig(config.max_workers)
    suppress_logs = not _debug_logging_enabled()
    step_manager = StepManager(console, show_timing=True)
    error_collector = ErrorCollector()

    # Initialize comprehensive statistics
    stats = {
        # Import statistics (Step 1)
        "records_fetched": 0,
        "sequences_attempted_import": 0,
        "sequences_import_successful": 0,
        "sequences_import_failed": 0,
        "sequences_skipped": 0,
        "detections_skipped": 0,
        "detections_attempted_import": 0,
        "detections_import_successful": 0,
        "detections_import_failed": 0,
        # Annotation statistics (Step 4)
        "total_sequences_for_annotation": 0,
        "annotations_successful": 0,
        "annotations_failed": 0,
        "annotations_created": 0,
        "sequences_rolled_back": 0,
    }
    org_stats: Dict[int, OrganizationStats] = {}

    def stats_for(organization_id: int) -> OrganizationStats:
        return org_stats.setdefault(organization_id, OrganizationStats())

    # Label used in the console output; the CLI used to read it from
    # ALERT_API_LOGIN, which is exactly what lands in `config.login`.
    organization = config.login or "unknown"

    # Print header
    console.print()
    console.print(
        Panel(
            "[bold blue]Alert API Data Import & Processing[/]",
            title="🔥 Pyronear Data Import",
            border_style="blue",
            padding=(0, 2),
        )
    )

    if _debug_logging_enabled():
        console.print(
            f"[blue]ℹ️  Date range: {config.date_from} to {config.date_end}[/]"
        )
        console.print(
            f"[blue]ℹ️  Alert API: {config.alert_api_url} "
            f"(source_api: {config.source_api})[/]"
        )
        console.print(f"[blue]ℹ️  Worker config: {worker_config}[/]")

    try:
        # Step 1: Fetch alert API data
        successfully_imported_sequence_ids = []
        step_manager.start_step(
            1,
            "Alert API Data Import",
            f"Fetching {organization} data from {config.date_from} to {config.date_end} using {worker_config.base_workers} workers",
        )

        if not all(
            [
                config.login,
                config.password,
                config.admin_login,
                config.admin_password,
            ]
        ):
            error_collector.add_error("Missing alert API credentials")
            step_manager.complete_step(False, "Missing alert API credentials")
            return ImportResult(
                per_organization=org_stats, error="Missing alert API credentials"
            )

        # Get access tokens with progress display
        auth_start_time = time.time()
        with console.status(
            f"[bold blue]🔐 Authenticating with alert API ({organization})...",
            spinner="dots",
        ) as status:
            try:
                status.update(f"[bold blue]🔐 Getting {organization} access token...")
                access_token = alert_api_client.get_api_access_token(
                    api_endpoint=config.alert_api_url,
                    username=config.login,
                    password=config.password,
                )

                status.update("[bold blue]🔐 Getting admin access token...")
                access_token_admin = alert_api_client.get_api_access_token(
                    api_endpoint=config.alert_api_url,
                    username=config.admin_login,
                    password=config.admin_password,
                )

                auth_duration = time.time() - auth_start_time
                console.print(
                    f"[green]✅ Authentication successful[/] [dim]({auth_duration:.1f}s)[/]"
                )

            except Exception as e:
                error_collector.add_error(f"Authentication failed: {e}")
                step_manager.complete_step(False, f"Authentication failed: {e}")
                return ImportResult(
                    per_organization=org_stats, error=f"Authentication failed: {e}"
                )

        # Fetch alert API records
        try:
            indexed_cameras, indexed_organizations = load_alert_api_metadata(
                api_endpoint=config.alert_api_url,
                access_token=access_token,
                access_token_admin=access_token_admin,
                console=console,
                error_collector=error_collector,
            )
            camera_org: Dict[int, Optional[int]] = {
                camera_id: camera.get("organization_id")
                for camera_id, camera in indexed_cameras.items()
            }

            listed = list_sequences_within(
                date_from=config.date_from,
                date_end=config.date_end,
                api_endpoint=config.alert_api_url,
                access_token=access_token,
                selected_sequence_list=config.selected_sequence_ids or None,
                max_sequences=config.max_sequences,
                suppress_logs=suppress_logs,
                console=console,
                risk_score=config.risk_score,
            )

            skip_ids = set(config.skip_platform_alert_ids)
            for sequence in listed:
                org_id = camera_org.get(sequence.get("camera_id"))
                if org_id is not None:
                    stats_for(org_id).alerts_fetched += 1
                    if sequence["id"] in skip_ids:
                        stats_for(org_id).alerts_skipped += 1

            # Applied BEFORE the per-sequence detection fetch below: a re-run of
            # an already-imported day then costs one listing call and zero
            # detection calls.
            sequences = filter_sequences(
                listed,
                camera_org=camera_org,
                organization_ids=config.organization_ids,
                skip_ids=skip_ids,
            )
            if config.organization_ids is not None or skip_ids:
                console.print(
                    f"[blue]🔍 Filtered sequences before detection fetch[/] "
                    f"[dim]({len(listed) - len(sequences)} skipped, "
                    f"{len(sequences)} remaining)[/]"
                )

            records = fetch_detections_for_sequences(
                sequences=sequences,
                indexed_cameras=indexed_cameras,
                indexed_organizations=indexed_organizations,
                api_endpoint=config.alert_api_url,
                access_token=access_token,
                detections_limit=config.frames_limit,
                detections_order_by="asc",
                worker_config=worker_config,
                suppress_logs=suppress_logs,
                console=console,
                error_collector=error_collector,
                organization=organization,
            )
        except Exception as e:
            error_collector.add_error(f"Alert API data fetching failed: {e}")
            step_manager.complete_step(False, f"Alert API data fetching failed: {e}")
            error_collector.print_summary(console, "Alert API Data Fetching Errors")
            return ImportResult(
                per_organization=org_stats,
                error=f"Alert API data fetching failed: {e}",
            )

        records, split_stats = object_split.split_all_records(records)
        console.print(
            f"[blue]🔀 Object split: {split_stats['alert_api_sequences']} alert sequence(s) → "
            f"{split_stats['objects']} object sequence(s) "
            f"({split_stats['sibling_objects']} sibling(s), "
            f"{split_stats['fallback_sequences']} fallback, "
            f"{split_stats['cross_deduped_siblings']} cross-deduped, "
            f"{split_stats['same_frame_merges']} same-frame merge(s))[/]"
        )

        # Boxless alerts import as zero-object lanes the classify page cannot
        # act on (#333); they are auto-skipped after annotation creation below.
        boxless_alert_ids = sorted(shared.boxless_platform_alert_ids(records))

        if not records and not config.dry_run:
            step_manager.complete_step(False, "No records fetched from alert API")
            return ImportResult(per_organization=org_stats)

        # Post to annotation API (if not dry run)
        if not config.dry_run:
            console.print(
                f"[blue]🚀 Posting {len(records)} records to annotation API...[/]"
            )

            try:
                result = shared.post_records_to_annotation_api(
                    config.annotation_api_url,
                    records,
                    max_workers=worker_config.api_posting,
                    max_detection_workers=worker_config.detection_per_sequence,
                    suppress_logs=suppress_logs,
                    source_api=config.source_api,
                    force_url=(config.image_transfer == "url"),
                    auth_token=config.annotation_api_token,
                )

                # Capture import statistics in main stats and get successfully imported sequence IDs
                stats["records_fetched"] = len(records)
                stats["sequences_attempted_import"] = result["total_sequences"]
                stats["sequences_import_successful"] = result["successful_sequences"]
                stats["sequences_import_failed"] = result["failed_sequences"]
                stats["detections_attempted_import"] = result["total_detections"]
                stats["detections_import_successful"] = result["successful_detections"]
                stats["detections_import_failed"] = result["failed_detections"]
                stats["sequences_skipped"] = result.get("skipped_sequences", 0)
                stats["detections_skipped"] = result.get("skipped_detections", 0)
                successfully_imported_sequence_ids = result["successful_sequence_ids"]

                # Prepare step completion stats for display
                step_stats = {
                    "Records fetched": len(records),
                    "Sequences posted": f"{result['successful_sequences']}/{result['total_sequences']}",
                    "Sequences skipped": result.get("skipped_sequences", 0),
                    "Detections skipped": result.get("skipped_detections", 0),
                    "Detections posted": f"{result['successful_detections']}/{result['total_detections']}",
                }

                step_success = (
                    result["failed_sequences"] == 0 and result["failed_detections"] == 0
                )
                step_message = (
                    "Alert API data successfully imported"
                    if step_success
                    else "Alert API data imported with some failures"
                )

                step_manager.complete_step(step_success, step_message, step_stats)

                if result["failed_sequences"] > 0 or result["failed_detections"] > 0:
                    error_collector.add_warning(
                        f"{result['failed_sequences']} sequences and {result['failed_detections']} detections failed to import. "
                        "Enable --loglevel debug to see per-sequence errors."
                    )

            except Exception as e:
                error_collector.add_error(f"Failed to post data to annotation API: {e}")
                step_manager.complete_step(
                    False, f"Failed to post data to annotation API: {e}"
                )
                error_collector.print_summary(console, "Alert API Data Import Errors")
                return ImportResult(
                    per_organization=org_stats,
                    error=f"Failed to post data to annotation API: {e}",
                )

            # Bookkeeping only, and deliberately outside the try above: a bug in
            # here must never be reported as "failed to post" on a run whose
            # transfer actually succeeded.
            _accumulate_post_stats(records, result, org_stats)
        else:
            # For dry run, capture what would have been imported but don't set sequence IDs
            stats["records_fetched"] = len(records)
            step_stats = {"Records that would be posted": len(records)}
            step_manager.complete_step(
                True, "DRY RUN: Alert API data fetch completed", step_stats
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

            # Boxless alerts from a previous run over this range may still
            # need parking (an earlier skip failed, or the range predates the
            # auto-skip feature); their lanes already exist, so skip works.
            if boxless_alert_ids and not config.dry_run:
                auto_skip_boxless(
                    config.annotation_api_url,
                    config.annotation_api_token,
                    config.source_api,
                    boxless_alert_ids,
                    console,
                    error_collector,
                )

            # Show final summary with zero processing and exit gracefully
            console.print()
            panel = Panel(
                f"[yellow]No sequences were successfully imported from {organization} alert API data.\n"
                f"Check import statistics above for details (all sequences may already be imported — see Skipped).[/]",
                title=f"⚠️ Processing Complete - {organization} - No Annotations Generated",
                border_style="yellow",
                padding=(1, 2),
            )
            console.print(panel)
            return ImportResult(per_organization=org_stats)

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
            f"Creating sequence annotations for {len(sequence_ids)} sequences (auto-generation enabled)",
        )

        alert_api_seq_results = []
        if not config.dry_run:
            alert_api_seq_results = [
                r for r in result.get("sequence_results", []) if not r.get("skipped")
            ]

        with concurrent.futures.ThreadPoolExecutor(
            max_workers=worker_config.annotation_processing
        ) as executor:
            # Submit all sequence annotation tasks
            future_to_sequence_id = {
                executor.submit(
                    annotate_split_sequence,
                    seq_result=seq_result,
                    annotation_api_url=config.annotation_api_url,
                    dry_run=config.dry_run,
                    auth_token=config.annotation_api_token,
                ): seq_result["sequence_id"]
                for seq_result in alert_api_seq_results
            }

            # Collect results with progress tracking
            with LogSuppressor(suppress=suppress_logs):
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[bold blue]Creating sequence annotations"),
                    BarColumn(bar_width=40),
                    TaskProgressColumn(),
                    console=Console(quiet=config.quiet),
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
                                    if "rolled back" in error:
                                        stats["sequences_rolled_back"] += 1
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
        if config.dry_run:
            step_3_message = "DRY RUN: " + step_3_message

        step_manager.complete_step(step_3_success, step_3_message, final_stats)

        # Auto-skip boxless alerts (#333): their lanes exist now (sequence +
        # annotation) but have zero objects, so park them via the skip overlay
        # instead of leaving dead lanes in the classify queue.
        skip_counts = {"skipped": 0, "already_skipped": 0, "failed": 0}
        if boxless_alert_ids and not config.dry_run:
            skip_counts = auto_skip_boxless(
                config.annotation_api_url,
                config.annotation_api_token,
                config.source_api,
                boxless_alert_ids,
                console,
                error_collector,
            )

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

        # Alert API Import Section
        if not config.dry_run:
            import_section = f"""[bold cyan]ALERT API IMPORT:[/]
• Records fetched: {stats['records_fetched']}
• Sequences attempted: {stats['sequences_attempted_import']}
• Successfully imported: {stats['sequences_import_successful']}
• Skipped (already imported): {stats['sequences_skipped']} sequences / {stats['detections_skipped']} detections
• Failed: {stats['sequences_import_failed']}"""
            if stats["sequences_rolled_back"] > 0:
                import_section += f"\n• Rolled back: {stats['sequences_rolled_back']}"
            summary_parts.append(import_section)

        # Annotation Generation Section
        annotation_section = f"""[bold blue]ANNOTATION GENERATION:[/]
• Sequences processed: {stats['total_sequences_for_annotation']}
• Annotations successful: {stats['annotations_successful']}
• Annotations failed: {stats['annotations_failed']}
• Annotations created: {stats['annotations_created']}"""
        if boxless_alert_ids:
            annotation_section += (
                f"\n• Boxless alerts auto-skipped: {skip_counts['skipped']} "
                f"(+{skip_counts['already_skipped']} already skipped, "
                f"{skip_counts['failed']} failed): {boxless_alert_ids}"
            )
        summary_parts.append(annotation_section)

        # Join sections
        summary_text = "\n\n".join(summary_parts)

        # Add dry run notice
        if config.dry_run:
            summary_text += "\n\n[yellow]DRY RUN: No actual changes were made[/]"

        panel = Panel(
            summary_text,
            title=f"{icon} Processing Complete - {organization}",
            border_style=style,
            padding=(1, 2),
        )
        console.print(panel)

        if has_critical_failures:
            return ImportResult(
                per_organization=org_stats,
                error=(
                    f"{stats['annotations_failed']} annotation(s) failed, "
                    f"{error_collector.get_error_count()} error(s) collected"
                ),
            )
        return ImportResult(per_organization=org_stats)

    except KeyboardInterrupt:
        console.print("\n[yellow]⚠️  Processing interrupted by user[/]")
        error_collector.print_summary(console, "Errors Before Interruption")
        return ImportResult(
            per_organization=org_stats, error="Processing interrupted by user"
        )
    except Exception as e:
        error_collector.add_error(f"Unexpected error during processing: {e}")
        console.print(f"\n[red]❌ Unexpected error during processing: {e}[/]")
        error_collector.print_summary(console, "Critical Processing Errors")
        return ImportResult(
            per_organization=org_stats, error=f"Unexpected error during processing: {e}"
        )


def _accumulate_post_stats(
    records: List[Dict[str, Any]],
    post_result: Dict[str, Any],
    org_stats: Dict[int, OrganizationStats],
) -> None:
    """Attribute one posting run's outcome to the organizations it touched.

    Object-splitting turns one alert into several "lanes" (one annotation
    sequence per detected object), so lanes are counted directly while the
    alert-level counters roll their lanes up: an alert counts as failed if any
    of its lanes failed, imported if any lane was created, and skipped when the
    annotation API reported every one of its lanes as already existing.

    `post_records_to_annotation_api` only records a `sequence_results` entry for
    lanes that were created or skipped, so the failed lanes are the posted ones
    it did not report back.
    """
    lane_alert: Dict[int, int] = {}
    lane_org: Dict[int, Optional[int]] = {}
    for record in records:
        lane_id = record["sequence_id"]
        lane_alert[lane_id] = record.get("platform_alert_id", lane_id)
        lane_org[lane_id] = record.get("organization_id")

    sequence_results = post_result.get("sequence_results", [])
    created = {
        r["alert_api_sequence_id"] for r in sequence_results if not r.get("skipped")
    }
    already_present = {
        r["alert_api_sequence_id"] for r in sequence_results if r.get("skipped")
    }
    failed = set(lane_alert) - created - already_present

    lanes_by_alert: Dict[int, List[int]] = {}
    for lane_id, alert_id in lane_alert.items():
        lanes_by_alert.setdefault(alert_id, []).append(lane_id)

    for alert_id, lane_ids in lanes_by_alert.items():
        org_id = next(
            (
                lane_org[lane_id]
                for lane_id in lane_ids
                if lane_org[lane_id] is not None
            ),
            None,
        )
        if org_id is None:
            continue
        entry = org_stats.setdefault(org_id, OrganizationStats())
        entry.lanes_created += sum(1 for lane_id in lane_ids if lane_id in created)
        if any(lane_id in failed for lane_id in lane_ids):
            entry.alerts_failed += 1
        elif any(lane_id in created for lane_id in lane_ids):
            entry.alerts_imported += 1
        else:
            entry.alerts_skipped += 1
