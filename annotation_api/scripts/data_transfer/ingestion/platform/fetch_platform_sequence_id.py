"""
CLI script to fetch one sequence from the Pyronear platform API.

Usage:
  uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id --sequence-id <int> [--detections-limit <int>] [--detections-order-by <asc|desc>] [-log <loglevel>]

Arguments:
  --url-api-platform (url): url of the Platform API
  --url-api-annotation (url): url of the Annotation API
  --sequence-id (int): Sequence ID to fetch.
  --detections-limit (int): Maximum number of detections to fetch (default: 10).
  --detections-order-by (str): Order the detections by created_at in descending or ascending order (default: asc).
  -log, --loglevel (str): Provide logging level for the script (default: info).

Environment variables required:
  PLATFORM_LOGIN (str): Login.
  PLATFORM_PASSWORD (str): Password.
  PLATFORM_ADMIN_LOGIN (str): Admin login - useful to access /api/v1/organizations endpoints.
  PLATFORM_ADMIN_PASSWORD (str): Admin password - useful to access /api/v1/organizations endpoints.

Example:
  uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id --sequence-id 123 --loglevel info
"""

import argparse
import logging
import os

from . import client as platform_client
from . import utils as platform_utils


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
        sequence = fetch_sequence(
            sequence_id=sequence_id,
            detections_limit=detections_limit,
            detections_order_by=detections_order_by,
            api_endpoint=platform_api_endpoint,
            access_token=access_token,
            access_token_admin=access_token_admin,
        )

        logger.info(f"sequence: {sequence}")
        logger.info("Done ✅")
        exit(0)
