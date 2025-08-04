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


from . import client as platform_client
from . import utils as platform_utils
from . import shared


# Use shared function
transform_sequence_data = shared.transform_sequence_data


# Use shared function
parse_platform_bboxes = shared.parse_platform_bboxes


# Use shared function
transform_detection_data = shared.transform_detection_data


# Use shared function
download_image = shared.download_image


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


# Use shared function
validate_available_env_variables = shared.validate_available_env_variables


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
        # Use shared function to post to annotation API
        try:
            result = shared.post_records_to_annotation_api(annotation_api_url, records)
            
            logger.info("Processing complete:")
            logger.info(f"  Sequences: {result['successful_sequences']}/{result['total_sequences']} successful")
            logger.info(f"  Detections: {result['successful_detections']}/{result['total_detections']} successful")
            logger.info("Done ✅")
            
            if result['failed_sequences'] > 0 or result['failed_detections'] > 0:
                exit(1)
            else:
                exit(0)
                
        except Exception as e:
            logger.error(f"Unexpected error during annotation API processing: {e}")
            exit(1)
