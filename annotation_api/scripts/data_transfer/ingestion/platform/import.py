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
"""

import argparse
import concurrent.futures
import logging
import os
import sys
from datetime import date, datetime, timedelta
from typing import List, Dict, Any, Optional

from tqdm import tqdm

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
# MISSING FUNCTIONS EXTRACTED FROM DELETED SCRIPTS
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


def fetch_all_sequences_within(
    date_from: date,
    date_end: date,
    detections_limit: int,
    detections_order_by: str,
    api_endpoint: str,
    access_token: str,
    access_token_admin: str,
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

    Returns:
        List of platform records
    """
    cameras = platform_client.list_cameras(
        api_endpoint=api_endpoint, access_token=access_token
    )
    indexed_cameras = platform_utils.index_by(cameras, key="id")
    organizations = platform_client.list_organizations(
        api_endpoint=api_endpoint,
        access_token=access_token_admin,
    )
    indexed_organizations = platform_utils.index_by(organizations, key="id")

    logging.info(
        f"Fetching sequences between {date_from:%Y-%m-%d} and {date_end:%Y-%m-%d}"
    )
    sequences = []
    dates = get_dates_within(date_from=date_from, date_end=date_end)
    if len(dates) < 2:
        logging.info(f"Found {len(dates)} days: {dates}")
    else:
        logging.info(
            f"Found {len(dates)} days between {date_from:%Y-%m-%d} and {date_end:%Y-%m-%d}: "
            f"[{dates[0]:%Y-%m-%d}, {dates[1]:%Y-%m-%d},..., {dates[-2]:%Y-%m-%d}, {dates[-1]:%Y-%m-%d}]"
        )

    with concurrent.futures.ProcessPoolExecutor() as executor:
        future_to_date = {
            executor.submit(
                _fetch_sequences_for_date, api_endpoint, mdate, access_token
            ): mdate
            for mdate in dates
        }
        for future in tqdm(
            concurrent.futures.as_completed(future_to_date), total=len(future_to_date)
        ):
            sequences.extend(future.result())

    logging.info(f"Found {len(sequences)} sequences")

    # Now fetch detections and build flattened records
    records = []
    for sequence in tqdm(sequences, desc="Processing sequences"):
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

            # Debug: Log sequence structure for first sequence
            if len(records) == 0 and detections:
                logging.debug(f"Sample sequence structure: {sequence}")
                logging.debug(f"Sample camera structure: {camera}")
                logging.debug(f"Sample organization structure: {organization}")
                logging.debug(f"Sample detection structure: {detections[0] if detections else 'No detections'}")

            # Build flattened records (one per detection) using the proven platform_utils.to_record function
            for detection in detections:
                record = platform_utils.to_record(
                    detection=detection,
                    camera=camera,
                    organization=organization,
                    sequence=sequence,
                )
                
                # Debug: Log the first record to see what we're building
                if len(records) == 0:
                    logging.debug(f"Sample record structure: {record}")
                
                records.append(record)

        except Exception as e:
            logging.error(f"Error processing sequence {sequence.get('id', 'unknown')}: {e}")
            continue

    logging.info(f"Built {len(records)} flattened detection records")
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

            if not all(
                [
                    platform_login,
                    platform_password,
                    platform_admin_login,
                    platform_admin_password,
                ]
            ):
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
            logger.info(
                f"Fetching platform data from {args.date_from} to {args.date_end}"
            )
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
                result = shared.post_records_to_annotation_api(
                    args.url_api_annotation, records
                )

                logger.info("Platform data import results:")
                logger.info(
                    f"  Sequences: {result['successful_sequences']}/{result['total_sequences']} successful"
                )
                logger.info(
                    f"  Detections: {result['successful_detections']}/{result['total_detections']} successful"
                )

                if result["failed_sequences"] > 0 or result["failed_detections"] > 0:
                    logger.warning(
                        "Some platform data failed to import, but continuing with processing"
                    )
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

            # Log progress
            logger.debug(
                f"Sequence {sequence_id}: "
                f"annotation={'✓' if result['annotation_created'] else '✗'}, "
                f"stage={result['final_stage'] or 'failed'}"
            )

        # Final statistics
        logger.info("Processing completed!")
        logger.info("Final Statistics:")
        logger.info(f"  Total sequences: {stats['total_sequences']}")
        logger.info(f"  Successful sequences: {stats['successful_sequences']}")
        logger.info(f"  Failed sequences: {stats['failed_sequences']}")
        logger.info(f"  Annotations created: {stats['annotations_created']}")

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
