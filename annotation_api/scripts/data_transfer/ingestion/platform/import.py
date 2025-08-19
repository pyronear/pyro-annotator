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
from datetime import date, datetime, timedelta
from typing import List, Dict, Any, Optional

from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn, TimeElapsedColumn
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.live import Live
from rich.layout import Layout
from rich.status import Status
from rich.table import Table
import time

# Import platform fetching functionality
from . import client as platform_client
from . import shared
from . import utils as platform_utils

# Import API client and models
from app.clients.annotation_api import (
    list_sequences,
    list_detections,
    list_sequence_annotations,
    get_sequence,
    create_sequence_annotation,
    update_sequence_annotation,
)
from app.models import SequenceAnnotationProcessingStage
from app.schemas.annotation_validation import (
    BoundingBox,
    SequenceBBox,
    SequenceAnnotationData,
)


# ==============================================================================
# WORKER SCALING AND PROGRESS MANAGEMENT
# ==============================================================================

class WorkerConfig:
    """Intelligent worker scaling configuration based on single max_workers parameter."""
    
    def __init__(self, max_workers: int):
        self.base_workers = max_workers
        
    @property
    def detection_fetching(self) -> int:
        """Workers for platform API detection fetching."""
        return self.base_workers
        
    @property
    def api_posting(self) -> int:
        """Workers for sequence creation API calls (slightly conservative)."""
        return max(1, int(self.base_workers * 0.75))
        
    @property
    def annotation_processing(self) -> int:
        """Workers for CPU-bound annotation processing (can use more)."""
        return int(self.base_workers * 1.5)
        
    @property
    def detection_per_sequence(self) -> int:
        """Workers for detection creation within each sequence."""
        return self.base_workers
        
    @property
    def page_fetching(self) -> int:
        """Workers for paginated API calls."""
        return max(1, int(self.base_workers * 0.75))


class ErrorCollector:
    """Collects errors and warnings during processing for clean summary reporting."""
    
    def __init__(self):
        self.errors = []
        self.warnings = []
    
    def add_error(self, message: str, context: dict = None):
        """Add an error to the collection."""
        self.errors.append({
            "message": message, 
            "context": context or {}, 
            "timestamp": datetime.now()
        })
    
    def add_warning(self, message: str, context: dict = None):
        """Add a warning to the collection."""
        self.warnings.append({
            "message": message, 
            "context": context or {}, 
            "timestamp": datetime.now()
        })
    
    def has_issues(self) -> bool:
        """Check if there are any errors or warnings."""
        return len(self.errors) > 0 or len(self.warnings) > 0
    
    def print_summary(self, console: Console, title: str = "Issues Encountered"):
        """Print a formatted summary of errors and warnings."""
        if not self.has_issues():
            return
            
        console.print()
        summary_text = ""
        
        if self.errors:
            summary_text += f"[red]❌ {len(self.errors)} error(s):[/]\n"
            for error in self.errors[-5:]:  # Show last 5 errors
                summary_text += f"  • {error['message']}\n"
            if len(self.errors) > 5:
                summary_text += f"  ... and {len(self.errors) - 5} more error(s)\n"
        
        if self.warnings:
            if summary_text:
                summary_text += "\n"
            summary_text += f"[yellow]⚠️  {len(self.warnings)} warning(s):[/]\n"
            for warning in self.warnings[-3:]:  # Show last 3 warnings
                summary_text += f"  • {warning['message']}\n"
            if len(self.warnings) > 3:
                summary_text += f"  ... and {len(self.warnings) - 3} more warning(s)\n"
        
        panel = Panel(
            summary_text.strip(), 
            title=title, 
            border_style="red" if self.errors else "yellow",
            padding=(1, 2)
        )
        console.print(panel)
    
    def clear(self):
        """Clear all collected errors and warnings."""
        self.errors.clear()
        self.warnings.clear()


class StepManager:
    """Manages step-by-step progress with Rich formatting and timing."""
    
    def __init__(self, console: Console, show_timing: bool = True):
        self.console = console
        self.show_timing = show_timing
        self.current_step = 0
        self.step_start_time = None
        
    def start_step(self, step_number: int, title: str, description: str = None):
        """Start a new step with Rich panel formatting."""
        self.current_step = step_number
        self.step_start_time = time.time()
        
        panel_title = f"📋 Step {step_number}: {title}"
        panel_content = description or f"Starting {title.lower()}..."
        
        self.console.print()
        self.console.print(Panel(
            f"[bold blue]{panel_content}[/]",
            title=panel_title,
            border_style="blue",
            padding=(0, 2)
        ))
    
    def complete_step(self, success: bool = True, message: str = None, stats: dict = None):
        """Mark the current step as completed with timing and status."""
        if self.step_start_time is None:
            return
            
        duration = time.time() - self.step_start_time
        status_icon = "✅" if success else "❌"
        status_color = "green" if success else "red"
        
        completion_text = f"[{status_color}]{status_icon} Step {self.current_step} {'completed' if success else 'failed'}[/]"
        
        if self.show_timing:
            completion_text += f" [dim]({duration:.1f}s)[/]"
        
        if message:
            completion_text += f"\n{message}"
            
        if stats:
            completion_text += "\n"
            for key, value in stats.items():
                completion_text += f"• {key}: [bold]{value}[/]\n"
        
        self.console.print(Panel(
            completion_text.strip(),
            border_style=status_color,
            padding=(0, 2)
        ))
        
        self.step_start_time = None


class LogSuppressor:
    """Context manager to suppress logging during progress displays."""
    
    def __init__(self, suppress: bool = True):
        self.suppress = suppress
        self.original_levels = {}
        
    def __enter__(self):
        if self.suppress:
            # Store original levels and suppress ALL loggers except ERROR level
            loggers_to_suppress = [
                '',  # root logger - most important
                '__main__',
                'root',
                'scripts.data_transfer.ingestion.platform.import',
                'scripts.data_transfer.ingestion.platform.shared',
                'scripts.data_transfer.ingestion.platform.client',
                'scripts.data_transfer.ingestion.platform.utils',
                'app.clients.annotation_api',
                'requests',
                'urllib3',
                'urllib3.connectionpool',
                'asyncio',
                'concurrent.futures',
                'multiprocessing'
            ]
            
            for logger_name in loggers_to_suppress:
                logger = logging.getLogger(logger_name)
                self.original_levels[logger_name] = logger.level
                logger.setLevel(logging.CRITICAL)  # Only show critical errors
                
            # Also suppress all existing loggers to catch any dynamically created ones
            for logger_name in logging.getLogger().manager.loggerDict:
                if logger_name not in self.original_levels:
                    logger = logging.getLogger(logger_name)
                    self.original_levels[logger_name] = logger.level
                    logger.setLevel(logging.CRITICAL)
                    
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.suppress:
            # Restore original log levels
            for logger_name, original_level in self.original_levels.items():
                logging.getLogger(logger_name).setLevel(original_level)


# ==============================================================================
# UTILITY FUNCTIONS
# ==============================================================================

def valid_date(s: str):
    """
    Datetime parser for the CLI.
    """
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        msg = "not a valid date: {0!r}".format(s)
        raise argparse.ArgumentTypeError(msg)


def get_dates_within(date_from: date, date_end: date) -> List[date]:
    """
    Get all dates between date_from and date_end (inclusive).
    
    Args:
        date_from: Start date
        date_end: End date
        
    Returns:
        List of dates
    """
    dates = []
    current_date = date_from
    while current_date <= date_end:
        dates.append(current_date)
        current_date += timedelta(days=1)
    return dates


def _fetch_sequences_for_date(api_endpoint: str, target_date: date, access_token: str) -> List[Dict]:
    """
    Fetch sequences for a specific date from the platform API.
    
    Args:
        api_endpoint: Platform API endpoint
        target_date: Date to fetch sequences for
        access_token: API access token
        
    Returns:
        List of sequences for the date
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


def _process_single_sequence_detections(
    sequence: Dict,
    indexed_cameras: Dict,
    indexed_organizations: Dict,
    api_endpoint: str,
    access_token: str,
    detections_limit: int,
    detections_order_by: str,
) -> List[Dict]:
    """
    Process detections for a single sequence.
    
    Args:
        sequence: Sequence data
        indexed_cameras: Camera lookup dict
        indexed_organizations: Organization lookup dict
        api_endpoint: Platform API endpoint
        access_token: API access token
        detections_limit: Max detections per sequence
        detections_order_by: Order direction for detections
        
    Returns:
        List of detection records for this sequence
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
    suppress_logs: bool = True,
    console: Console = None,
    error_collector: 'ErrorCollector' = None,
) -> List[Dict]:
    """
    Fetch all sequences and detections between date_from and date_end.

    Args:
        date_from: Start date
        date_end: End date
        detections_limit: Max detections per sequence
        detections_order_by: Order direction for detections
        api_endpoint: Platform API endpoint
        access_token: Regular access token
        access_token_admin: Admin access token
        worker_config: WorkerConfig instance for intelligent scaling
        suppress_logs: Whether to suppress log output during progress display
        console: Rich console for enhanced output
        error_collector: Error collector for clean error reporting

    Returns:
        List of platform records
    """
    # Initialize defaults if not provided
    if console is None:
        console = Console()
    if error_collector is None:
        error_collector = ErrorCollector()
    
    # Load metadata with progress display
    metadata_start_time = time.time()
    with console.status("[bold blue]📡 Loading platform metadata...", spinner="dots") as status:
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
            console.print(f"[green]✅ Metadata loaded[/] [dim]({metadata_duration:.1f}s)[/]")
            console.print(f"   • [bold]{len(cameras)}[/] cameras, [bold]{len(organizations)}[/] organizations")
            
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
        console.print(f"[blue]📅 Processing [bold]{len(dates)} days[/]: {dates[0]:%Y-%m-%d} to {dates[-1]:%Y-%m-%d}[/]")

    sequences = []

    with concurrent.futures.ProcessPoolExecutor() as executor:
        future_to_date = {
            executor.submit(
                _fetch_sequences_for_date, api_endpoint, mdate, access_token
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
                transient=True
            ) as progress_bar:
                task = progress_bar.add_task("Processing dates", total=len(future_to_date))
                for future in concurrent.futures.as_completed(future_to_date):
                    sequences.extend(future.result())
                    progress_bar.advance(task)

    logging.info(f"Found {len(sequences)} sequences")

    # Now fetch detections and build flattened records using parallel processing
    records = []
    first_sequence_logged = False
    
    logging.info(f"Processing sequences with {worker_config.detection_fetching} workers")
    with concurrent.futures.ThreadPoolExecutor(max_workers=worker_config.detection_fetching) as executor:
        # Submit all tasks
        future_to_sequence = {
            executor.submit(
                _process_single_sequence_detections,
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
            with Progress(
                SpinnerColumn(),
                TextColumn("[bold blue]Processing sequence detections"),
                BarColumn(bar_width=40),
                TaskProgressColumn(),
                console=Console(),
                transient=True
            ) as progress_bar:
                task = progress_bar.add_task("Fetching detections", total=len(future_to_sequence))
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
                            logging.debug(f"Sample organization structure: {organization}")
                            logging.debug(f"Sample record structure: {sequence_records[0] if sequence_records else 'No records'}")
                        
                        records.extend(sequence_records)
                        progress_bar.advance(task)
                        
                    except Exception as e:
                        # Collect errors instead of logging immediately
                        error_msg = f"Error processing sequence {sequence.get('id', 'unknown')}: {e}"
                        error_collector.add_error(error_msg)
                        progress_bar.advance(task)
                        continue

    # Show final results
    console.print(f"[green]✅ Processing complete[/]")
    console.print(f"   • [bold]{len(records)}[/] detection records from [bold]{len(sequences)}[/] sequences")
    
    # Show errors if any occurred
    if error_collector.has_issues():
        error_collector.print_summary(console, "Sequence Processing Issues")
    
    return records


# Bounding box utilities
def box_iou(box1: List[float], box2: List[float]) -> float:
    """
    Calculate Intersection over Union (IoU) between two bounding boxes.
    """
    # Get intersection coordinates
    x1_inter = max(box1[0], box2[0])
    y1_inter = max(box1[1], box2[1])
    x2_inter = min(box1[2], box2[2])
    y2_inter = min(box1[3], box2[3])

    # Calculate intersection area
    if x2_inter < x1_inter or y2_inter < y1_inter:
        intersection = 0.0
    else:
        intersection = (x2_inter - x1_inter) * (y2_inter - y1_inter)

    # Calculate areas of both boxes
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])

    # Calculate union area
    union = area1 + area2 - intersection

    # Avoid division by zero
    if union == 0:
        return 0.0

    return intersection / union


def filter_predictions_by_confidence(predictions: List[dict], confidence_threshold: float) -> List[dict]:
    """Filter AI predictions by confidence threshold."""
    if confidence_threshold == 0.0:
        return predictions
    return [
        pred for pred in predictions
        if pred.get("confidence", 0) >= confidence_threshold
    ]


def cluster_boxes_by_iou(boxes_with_ids: List[tuple], iou_threshold: float) -> List[List[tuple]]:
    """Cluster bounding boxes by IoU similarity."""
    if not boxes_with_ids:
        return []

    clusters = []
    remaining_boxes = boxes_with_ids.copy()

    while remaining_boxes:
        current_cluster = [remaining_boxes.pop(0)]

        i = 0
        while i < len(remaining_boxes):
            box_to_test, detection_id = remaining_boxes[i]

            overlaps = False
            for cluster_box, _ in current_cluster:
                if box_iou(box_to_test, cluster_box) >= iou_threshold:
                    overlaps = True
                    break

            if overlaps:
                current_cluster.append(remaining_boxes.pop(i))
            else:
                i += 1

        clusters.append(current_cluster)

    return clusters


# Annotation generation functions
def check_existing_annotation(base_url: str, sequence_id: int) -> Optional[int]:
    """Check if a sequence already has an annotation."""
    try:
        response = list_sequence_annotations(base_url, sequence_id=sequence_id)

        if isinstance(response, dict) and "items" in response:
            annotations = response["items"]
        else:
            annotations = response

        if len(annotations) > 0:
            return annotations[0]["id"]
        return None

    except Exception as e:
        logging.debug(f"Error checking existing annotation for sequence {sequence_id}: {e}")
        return None


def create_annotation_from_data(
    base_url: str,
    sequence_id: int,
    annotation_data: SequenceAnnotationData,
    dry_run: bool = False,
    existing_annotation_id: Optional[int] = None,
    processing_stage: SequenceAnnotationProcessingStage = SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
) -> bool:
    """Create or update a sequence annotation from analyzed data."""
    try:
        if existing_annotation_id:
            # Update existing annotation (PATCH)
            update_dict = {
                "annotation": annotation_data.model_dump(),
                "processing_stage": processing_stage.value,
                "has_missed_smoke": False,
            }

            if dry_run:
                logging.info(f"DRY RUN: Would update annotation {existing_annotation_id} for sequence {sequence_id}")
                logging.debug(f"Update data: {update_dict}")
                return True

            result = update_sequence_annotation(base_url, existing_annotation_id, update_dict)
            if result:
                logging.debug(f"Successfully updated annotation {existing_annotation_id} for sequence {sequence_id}")
                return True
            else:
                logging.error(f"Failed to update annotation {existing_annotation_id} for sequence {sequence_id}")
                return False

        else:
            # Create new annotation (POST)
            create_dict = {
                "sequence_id": sequence_id,
                "annotation": annotation_data.model_dump(),
                "processing_stage": processing_stage.value,
                "has_missed_smoke": False,
            }

            if dry_run:
                logging.info(f"DRY RUN: Would create new annotation for sequence {sequence_id}")
                logging.debug(f"Create data: {create_dict}")
                return True

            result = create_sequence_annotation(base_url, create_dict)
            if result:
                logging.debug(f"Successfully created annotation for sequence {sequence_id}")
                return True
            else:
                logging.error(f"Failed to create annotation for sequence {sequence_id}")
                return False

    except Exception as e:
        logging.error(f"Error creating/updating annotation for sequence {sequence_id}: {e}")
        return False


# SequenceAnalyzer class
class SequenceAnalyzer:
    """Analyzes sequences to generate automatic annotations based on AI predictions."""

    def __init__(self, base_url: str, confidence_threshold: float = 0.5,
                 iou_threshold: float = 0.3, min_cluster_size: int = 1):
        self.base_url = base_url
        self.confidence_threshold = confidence_threshold
        self.iou_threshold = iou_threshold
        self.min_cluster_size = min_cluster_size
        self.logger = logging.getLogger(__name__)

    def analyze_sequence(self, sequence_id: int) -> Optional[SequenceAnnotationData]:
        """Analyze a sequence and generate annotation data."""
        try:
            sequence = get_sequence(self.base_url, sequence_id)
            self.logger.info(f"Analyzing sequence {sequence_id}: {sequence.get('camera_name', 'Unknown')}")

            detections = self._fetch_sequence_detections(sequence_id)
            if not detections:
                self.logger.warning(f"No detections found for sequence {sequence_id}")
                return None

            self.logger.info(f"Found {len(detections)} detections in sequence {sequence_id}")

            predictions_with_ids = self._extract_predictions_from_detections(detections)
            if not predictions_with_ids:
                self.logger.warning(f"No valid AI predictions found for sequence {sequence_id}")
                return None

            self.logger.info(f"Extracted {len(predictions_with_ids)} valid predictions above confidence threshold {self.confidence_threshold}")

            bbox_clusters = self._cluster_temporal_bboxes(predictions_with_ids)
            if not bbox_clusters:
                self.logger.warning(f"No temporal clusters found for sequence {sequence_id}")
                return None

            self.logger.info(f"Created {len(bbox_clusters)} temporal bbox clusters")

            sequences_bbox = self._create_sequence_bboxes(bbox_clusters)
            annotation_data = SequenceAnnotationData(sequences_bbox=sequences_bbox)

            self.logger.info(f"Generated annotation with {len(sequences_bbox)} sequence bboxes for sequence {sequence_id}")
            return annotation_data

        except Exception as e:
            self.logger.error(f"Error analyzing sequence {sequence_id}: {e}")
            return None

    def _fetch_sequence_detections(self, sequence_id: int) -> List[Dict]:
        """Fetch all detections for a sequence."""
        try:
            all_detections = []
            page = 1
            page_size = 100

            while True:
                response = list_detections(
                    self.base_url,
                    sequence_id=sequence_id,
                    order_by="recorded_at",
                    order_direction="asc",
                    page=page,
                    size=page_size,
                )

                if isinstance(response, dict) and "items" in response:
                    detections = response["items"]
                    total_pages = response.get("pages", 1)
                else:
                    detections = response
                    total_pages = 1

                if not detections:
                    break

                all_detections.extend(detections)

                if page >= total_pages:
                    break

                page += 1

            return all_detections

        except Exception as e:
            self.logger.error(f"Error fetching detections for sequence {sequence_id}: {e}")
            return []

    def _extract_predictions_from_detections(self, detections: List[Dict]) -> List[tuple]:
        """Extract and validate AI predictions from detection records."""
        predictions_with_ids = []

        for detection in detections:
            detection_id = detection["id"]
            algo_predictions = detection.get("algo_predictions")

            if not algo_predictions or not isinstance(algo_predictions, dict):
                continue

            predictions_list = algo_predictions.get("predictions", [])
            if not predictions_list:
                continue

            valid_predictions = filter_predictions_by_confidence(
                predictions_list, self.confidence_threshold
            )

            for prediction in valid_predictions:
                try:
                    xyxyn = prediction.get("xyxyn", [])
                    if len(xyxyn) == 4:
                        predictions_with_ids.append((xyxyn, detection_id, prediction))
                except Exception as e:
                    self.logger.debug(f"Invalid prediction format in detection {detection_id}: {e}")
                    continue

        return predictions_with_ids

    def _cluster_temporal_bboxes(self, predictions_with_ids: List[tuple]) -> List[List[tuple]]:
        """Cluster overlapping bounding boxes across temporal frames."""
        if not predictions_with_ids:
            return []

        # Convert to format expected by clustering function
        boxes_with_ids = [(pred[0], pred[1]) for pred in predictions_with_ids]
        
        clusters = cluster_boxes_by_iou(boxes_with_ids, self.iou_threshold)

        # Filter by minimum cluster size
        filtered_clusters = [
            cluster for cluster in clusters
            if len(cluster) >= self.min_cluster_size
        ]

        return filtered_clusters

    def _create_sequence_bboxes(self, bbox_clusters: List[List[tuple]]) -> List[SequenceBBox]:
        """Convert bbox clusters to SequenceBBox objects."""
        sequences_bbox = []

        for cluster in bbox_clusters:
            bboxes = []
            for bbox_coords, detection_id in cluster:
                bbox = BoundingBox(detection_id=detection_id, xyxyn=bbox_coords)
                bboxes.append(bbox)

            # Conservative classification - mark as smoke for human review
            sequence_bbox = SequenceBBox(
                is_smoke=True,  # Conservative default
                false_positive_types=[],  # Empty initially
                bboxes=bboxes
            )
            sequences_bbox.append(sequence_bbox)

        return sequences_bbox


# ==============================================================================
# END OF MISSING FUNCTIONS
# ==============================================================================


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

        logging.info(
            f"Fetching sequences from annotation API from {date_from_str} to {date_end_str}"
        )

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

        logging.info(
            f"Found {len(all_sequence_ids)} sequences in annotation API for date range"
        )
        return all_sequence_ids

    except Exception as e:
        logging.error(f"Error fetching sequences from annotation API: {e}")
        return []


def process_single_sequence(
    sequence_id: int,
    analyzer: SequenceAnalyzer,
    annotation_api_url: str,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Process a single sequence: generate annotation and set ready for annotation stage.

    Args:
        sequence_id: Sequence ID to process
        analyzer: SequenceAnalyzer instance
        annotation_api_url: Annotation API base URL
        dry_run: If True, don't actually create annotations

    Returns:
        Dictionary with processing results
    """
    result = {
        "sequence_id": sequence_id,
        "annotation_created": False,
        "annotation_id": None,
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
        existing_annotation_id = check_existing_annotation(
            annotation_api_url, sequence_id
        )

        # Create or update annotation
        if create_annotation_from_data(
            annotation_api_url,
            sequence_id,
            annotation_data,
            dry_run,
            existing_annotation_id,
            SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
        ):
            result["annotation_created"] = True
            result["annotation_id"] = (
                existing_annotation_id if existing_annotation_id else "new"
            )
            result["final_stage"] = SequenceAnnotationProcessingStage.READY_TO_ANNOTATE.value
            logging.info(
                f"Successfully created/updated annotation for sequence {sequence_id} - ready for annotation"
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

    # Initialize worker configuration
    worker_config = WorkerConfig(args.max_workers)
    
    # Initialize console and progress context
    console = Console()
    suppress_logs = args.loglevel != "debug"  # Suppress logs unless in debug mode
    
    # Initialize step manager and error collector
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
    console = Console()
    console.print()
    console.print(Panel(
        "[bold blue]Platform Data Import & Processing[/]",
        title="🔥 Pyronear Data Import",
        border_style="blue",
        padding=(0, 2)
    ))

    if args.loglevel == "debug":
        console.print(f"[blue]ℹ️  Date range: {args.date_from} to {args.date_end}[/]")
        console.print(f"[blue]ℹ️  Worker config: base={args.max_workers}, detection={worker_config.detection_fetching}, api={worker_config.api_posting}, annotation={worker_config.annotation_processing}[/]")
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
                                    logger.error(f"Sequence {sequence_id}: {error}")
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
