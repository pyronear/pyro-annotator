"""
CLI script to fetch one sequence from the Pyronear platform API and post it to the annotation API.

This script fetches a sequence and its detections from the platform API, transforms the data
to annotation API format, downloads detection images, and creates corresponding sequences
and detections in the annotation API.

Usage:
  uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id --sequence-id <int> [--detections-limit <int>] [--detections-order-by <asc|desc>] [--skip-posting] [-log <loglevel>]

Arguments:
  --url-api-platform (url): url of the Platform API (default: https://alertapi.pyronear.org)
  --url-api-annotation (url): url of the Annotation API (default: http://localhost:5050)
  --sequence-id (int): Sequence ID to fetch from platform API.
  --detections-limit (int): Maximum number of detections to fetch (default: 10).
  --detections-order-by (str): Order the detections by created_at in descending or ascending order (default: asc).
  --skip-posting: Skip posting to annotation API (fetch and transform only, for testing).
  -log, --loglevel (str): Provide logging level for the script (default: info).

Environment variables required:
  PLATFORM_LOGIN (str): Login for platform API.
  PLATFORM_PASSWORD (str): Password for platform API.
  PLATFORM_ADMIN_LOGIN (str): Admin login - useful to access /api/v1/organizations endpoints.
  PLATFORM_ADMIN_PASSWORD (str): Admin password - useful to access /api/v1/organizations endpoints.

Examples:
  # Fetch and post to annotation API
  uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id --sequence-id 123 --loglevel info

  # Fetch only (skip posting, for testing)
  uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id --sequence-id 123 --skip-posting --loglevel debug
"""

import argparse
import logging
import os

import requests

from app.clients.annotation_api import (
    AnnotationAPIError,
    ValidationError,
    create_detection,
    create_sequence,
)

from . import client as platform_client
from . import utils as platform_utils


def transform_sequence_data(record: dict) -> dict:
    """
    Transform platform sequence data to annotation API format.

    Args:
        record: Platform record containing sequence metadata

    Returns:
        Dictionary formatted for annotation API sequence creation
    """
    return {
        "source_api": "pyronear_french",
        "alert_api_id": record["sequence_id"],  # Platform sequence ID
        "camera_name": record["camera_name"],
        "camera_id": record["camera_id"],
        "organisation_name": record["organization_name"],
        "organisation_id": record["organization_id"],
        # FIXME:: grab it from sequence data (add it there)
        "is_wildfire_alertapi": None,  # Could map from sequence data if available
        "lat": record["camera_lat"],
        "lon": record["camera_lon"],
        "azimuth": record["sequence_azimuth"],
        "last_seen_at": record["sequence_last_seen_at"],
    }


def parse_platform_bboxes(bboxes_str: str) -> dict:
    """
    Parse platform bboxes string into AlgoPredictions format.

    Args:
        bboxes_str: String representation of bounding boxes from platform API

    Returns:
        Dictionary in AlgoPredictions format with predictions list

    Note:
        This function needs to be refined based on actual platform bbox format.
        Currently assumes a simple format that can be eval'd.
    """
    try:
        # Parse the bboxes string - format needs to be determined from actual data
        bboxes_data = eval(bboxes_str) if bboxes_str else []

        predictions = []
        for bbox in bboxes_data:
            # Assuming bbox format: [x1, y1, x2, y2, confidence, ...]
            # This will need to be adjusted based on actual platform format
            if len(bbox) >= 5:
                prediction = {
                    "xyxyn": bbox[:4],  # First 4 values as coordinates
                    "confidence": float(bbox[4]),  # 5th value as confidence
                    "class_name": "smoke",  # Default class name
                }
                predictions.append(prediction)

        return {"predictions": predictions}
    except Exception as e:
        logging.warning(f"Failed to parse bboxes '{bboxes_str}': {e}")
        # Return empty predictions on error
        return {"predictions": []}


def transform_detection_data(record: dict, annotation_sequence_id: int) -> dict:
    """
    Transform platform detection data to annotation API format.

    Args:
        record: Platform record containing detection metadata
        annotation_sequence_id: The sequence ID from annotation API (not platform ID)

    Returns:
        Dictionary formatted for annotation API detection creation
    """
    # Transform detection_bboxes to algo_predictions format
    algo_predictions = parse_platform_bboxes(record["detection_bboxes"])

    return {
        "sequence_id": annotation_sequence_id,  # NEW sequence ID from annotation API
        "alert_api_id": record["detection_id"],  # Platform detection ID
        "recorded_at": record["detection_created_at"],
        "algo_predictions": algo_predictions,
    }


def download_image(url: str, timeout: int = 30) -> bytes:
    """
    Download image from platform detection URL.

    Args:
        url: Image URL from platform API
        timeout: Request timeout in seconds

    Returns:
        Image content as bytes

    Raises:
        requests.RequestException: If download fails
    """
    logging.debug(f"Downloading image from: {url}")
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    return response.content


def make_cli_parser() -> argparse.ArgumentParser:
    """
    Make the CLI parser.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url-api-annotation",
        help="Annotation API url",
        type=str,
        default="http://localhost:5050",
    )
    parser.add_argument(
        "--url-api-platform",
        help="Platform API url",
        type=str,
        default="https://alertapi.pyronear.org",
    )
    parser.add_argument(
        "--sequence-id",
        help="sequence id to be fetched",
        type=int,
        required=True,
    )
    parser.add_argument(
        "--detections-limit",
        help="Maximum number of detections to fetch",
        type=int,
        default=10,
    )
    parser.add_argument(
        "--detections-order-by",
        help="Whether to order the detections by created_at in descending or ascending order",
        choices=["desc", "asc"],
        type=str,
        default="asc",
    )
    parser.add_argument(
        "-log",
        "--loglevel",
        default="info",
        help="Provide logging level. Example --loglevel debug, default=warning",
    )
    parser.add_argument(
        "--skip-posting",
        action="store_true",
        help="Skip posting to annotation API (fetch and transform only, for testing)",
    )
    return parser


def validate_parsed_args(args: dict) -> bool:
    """
    Return whether the parsed args are valid.
    """
    return True


def validate_available_env_variables() -> bool:
    """
    Check whether the environment variables required for
    hitting the API are properly set.

    PLATFORM_LOGIN (str): login
    PLATFORM_PASSWORD (str): password
    PLATFORM_ADMIN_LOGIN (str): admin login
    PLATFORM_ADMIN_PASSWORD (str): admin password
    """
    platform_login = os.getenv("PLATFORM_LOGIN")
    platform_password = os.getenv("PLATFORM_LOGIN")
    platform_admin_login = os.getenv("PLATFORM_ADMIN_LOGIN")
    platform_admin_password = os.getenv("PLATFORM_ADMIN_PASSWORD")
    if not platform_login:
        logging.error("PLATFORM_LOGIN is not set")
        return False
    elif not platform_password:
        logging.error("PLATFORM_PASSWORD is not set")
        return False
    elif not platform_admin_login:
        logging.error("PLATFORM_ADMIN_LOGIN is not set")
        return False
    elif not platform_admin_password:
        logging.error("PLATFORM_ADMIN_PASSWORD is not set")
        return False
    else:
        return True


def fetch_sequence(
    sequence_id: int,
    detections_limit: int,
    detections_order_by: str,
    api_endpoint: str,
    access_token: str,
    access_token_admin: str,
) -> list[dict]:
    """
    Fetch a sequence of detections from the Pyronear platform API.

    Parameters:
        sequence_id (int): The ID of the sequence to be fetched.
        api_endpoint (str): The API endpoint URL for the Pyronear platform.
        access_token (str): The access token for authenticating API requests.
        access_token_admin (str): The admin access token for accessing organization information.

    Returns:
        list[dict]: A list of dictionaries containing detection records, each including metadata about the organization, camera, and detection details.
    """
    sequence = platform_client.get_sequence(
        api_endpoint=api_endpoint,
        sequence_id=sequence_id,
        access_token=access_token,
    )
    detections = platform_client.list_sequence_detections(
        api_endpoint=api_endpoint,
        sequence_id=sequence_id,
        access_token=access_token,
        limit=detections_limit,
        desc=True if detections_order_by == "desc" else False,
    )
    camera = platform_client.get_camera(
        api_endpoint=api_endpoint,
        camera_id=sequence["camera_id"],
        access_token=access_token,
    )
    organization = platform_client.get_organization(
        api_endpoint=api_endpoint,
        organization_id=camera["organization_id"],
        access_token=access_token_admin,
    )
    return [
        platform_utils.to_record(
            detection=detection,
            camera=camera,
            organization=organization,
            sequence=sequence,
        )
        for detection in detections
    ]


if __name__ == "__main__":
    cli_parser = make_cli_parser()
    args = vars(cli_parser.parse_args())
    logger = logging.getLogger(__name__)
    logging.basicConfig(level=args["loglevel"].upper())
    if not validate_parsed_args(args):
        exit(1)
    elif not validate_available_env_variables():
        exit(1)
    else:
        logger.info(args)
        platform_api_endpoint = args["url_api_platform"]
        api_url = f"{platform_api_endpoint}/api/v1"
        platform_login = os.getenv("PLATFORM_LOGIN")
        platform_password = os.getenv("PLATFORM_PASSWORD")
        platform_admin_login = os.getenv("PLATFORM_ADMIN_LOGIN")
        platform_admin_password = os.getenv("PLATFORM_ADMIN_PASSWORD")
        if (
            not platform_login
            or not platform_password
            or not platform_api_endpoint
            or not platform_admin_login
            or not platform_admin_password
        ):
            logger.error("Missing platform credentials...")
            exit(1)

        sequence_id = args["sequence_id"]
        detections_limit = args["detections_limit"]
        detections_order_by = args["detections_order_by"]
        logger.info(
            f"Fetching sequence id {sequence_id} from the platform API {api_url}"
        )
        logger.info("Fetching an access token to authenticate API requests...")
        access_token = platform_client.get_api_access_token(
            api_endpoint=platform_api_endpoint,
            username=platform_login,
            password=platform_password,
        )
        logger.info("Succesfully fetched an acess token to authenticate API requests ✔️")
        access_token_admin = platform_client.get_api_access_token(
            api_endpoint=platform_api_endpoint,
            username=platform_admin_login,
            password=platform_admin_password,
        )
        logger.info(
            "Succesfully fetched an admin acess token to authenticate API requests ✔️"
        )
        headers = platform_client.make_request_headers(access_token=access_token)

        # Fetch platform data
        records = fetch_sequence(
            sequence_id=sequence_id,
            detections_limit=detections_limit,
            detections_order_by=detections_order_by,
            api_endpoint=platform_api_endpoint,
            access_token=access_token,
            access_token_admin=access_token_admin,
        )

        logger.info(f"Fetched {len(records)} detection records from platform API")

        if args["skip_posting"]:
            logger.info("Skipping annotation API posting (--skip-posting flag set)")
            logger.info(f"Records: {records}")
            logger.info("Done ✅")
            exit(0)

        # Post to annotation API
        annotation_api_url = args["url_api_annotation"]
        logger.info(f"Posting data to annotation API at {annotation_api_url}")

        if not records:
            logger.warning("No records to post")
            exit(0)

        # Process sequence creation (all records have same sequence info)
        first_record = records[0]
        try:
            logger.info("Creating sequence in annotation API...")
            sequence_data = transform_sequence_data(first_record)
            annotation_sequence = create_sequence(annotation_api_url, sequence_data)
            annotation_sequence_id = annotation_sequence["id"]
            logger.info(f"Created sequence with ID: {annotation_sequence_id}")
        except ValidationError as e:
            logger.error(f"Sequence validation failed: {e.message}")
            if e.field_errors:
                logger.error("Field errors:")
                for field_error in e.field_errors:
                    logger.error(
                        f"  - {field_error['field']}: {field_error['message']}"
                    )
            logger.error(f"Sequence data sent: {sequence_data}")
            exit(1)
        except AnnotationAPIError as e:
            logger.error(f"Failed to create sequence: {e.message}")
            if e.status_code:
                logger.error(f"HTTP Status: {e.status_code}")
            exit(1)
        except Exception as e:
            logger.error(f"Unexpected error creating sequence: {e}")
            exit(1)

        # Process detections
        successful_detections = 0
        failed_detections = 0

        for i, record in enumerate(records, 1):
            logger.info(
                f"Processing detection {i}/{len(records)} (ID: {record['detection_id']})"
            )

            try:
                # Download image
                logger.debug(f"Downloading image from: {record['detection_url']}")
                image_data = download_image(record["detection_url"])

                # Transform detection data
                detection_data = transform_detection_data(
                    record, annotation_sequence_id
                )

                # Create detection in annotation API
                filename = f"detection_{record['detection_id']}.jpg"
                annotation_detection = create_detection(
                    annotation_api_url, detection_data, image_data, filename
                )

                logger.info(f"Created detection with ID: {annotation_detection['id']}")
                successful_detections += 1

            except ValidationError as e:
                logger.error(
                    f"Detection {record['detection_id']} validation failed: {e.message}"
                )
                if e.field_errors:
                    logger.error("Field errors:")
                    for field_error in e.field_errors:
                        logger.error(
                            f"  - {field_error['field']}: {field_error['message']}"
                        )
                logger.error(
                    f"Detection data sent: {transform_detection_data(record, annotation_sequence_id)}"
                )
                failed_detections += 1
            except requests.RequestException as e:
                logger.error(
                    f"Network error downloading image for detection {record['detection_id']}: {e}"
                )
                failed_detections += 1
            except AnnotationAPIError as e:
                logger.error(
                    f"API error processing detection {record['detection_id']}: {e.message}"
                )
                if e.status_code:
                    logger.error(f"HTTP Status: {e.status_code}")
                failed_detections += 1
            except Exception as e:
                logger.error(
                    f"Unexpected error processing detection {record['detection_id']}: {e}"
                )
                failed_detections += 1

        # Summary
        logger.info(
            f"Processing complete: {successful_detections} successful, {failed_detections} failed"
        )
        logger.info("Done ✅")

        if failed_detections > 0:
            exit(1)  # Exit with error code if there were failures
        else:
            exit(0)
