"""
CLI script to fetch sequences from the Pyronear platform API.

Usage:
  uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences --date-from <date> --date-end <date> --detections-limit <int> --detections-order-by <str> --loglevel <str>

Arguments:
  --url-api-platform (url): url of the Platform API
  --url-api-annotation (url): url of the Annotation API
  --date-from (date): date in YYYY-MM-DD format to start the sequence fetching
  --date-end (date): date in YYYY-MM-DD format to end the sequence fetching, defaults to now()
  --detections-limit (int): maximum number of detections to fetch, defaults to 30
  --detections-order-by (str): whether to order the detections by created_at in descending or ascending order, defaults to ascending
  --loglevel (str): provide logging level for the script

Environment variables required:
  PLATFORM_LOGIN (str): login
  PLATFORM_PASSWORD (str): password
  PLATFORM_ADMIN_LOGIN (str): admin login - useful to access /api/v1/organizations endpoints
  PLATFORM_ADMIN_PASSWORD (str): admin password - useful to access /api/v1/organizations endpoints

Example:
  uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info
"""

import argparse
import concurrent.futures
import logging
import os
from datetime import date, datetime, timedelta

from tqdm import tqdm

from . import client as platform_client
from . import shared
from . import utils as platform_utils


def valid_date(s: str):
    """
    Datetime parser for the CLI.
    """
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        msg = "not a valid date: {0!r}".format(s)
        raise argparse.ArgumentTypeError(msg)


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
        "--date-from",
        help="Date in YYYY-MM-DD format",
        type=valid_date,
        required=True,
    )
    parser.add_argument(
        "--detections-limit",
        help="Maximum number of detections to fetch",
        type=int,
        default=30,
    )
    parser.add_argument(
        "--detections-order-by",
        help="Whether to order the detections by created_at in descending or ascending order",
        choices=["desc", "asc"],
        type=str,
        default="asc",
    )
    parser.add_argument(
        "--date-end",
        help="Date in YYYY-MM-DD format, defaults to now.",
        type=valid_date,
        default=datetime.now().date(),
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
    if args["date_from"] > args["date_end"]:
        logging.error("Invalid combination of --date-from and --date-end parameters")
        return False
    return True


def get_dates_within(date_from: date, date_end: date) -> list[date]:
    """
    Collect all the days between `date_from` and `date_end` as
    datetime objects. This function generates a list of dates
    starting from `date_from` up to, but not including, `date_end`.

    Parameters:
        date_from (date): The starting date for the range.
        date_end (date): The ending date for the range.

    Returns:
        list[date]: A list of date objects representing each day in the range.

    Raises:
        AssertionError: If `date_from` is greater than `date_end`.
    """
    assert date_from <= date_end, "date_from should be < date_end"
    result = []
    date = date_from
    while date < date_end:
        result.append(date)
        date = date + timedelta(days=1)
    return result


def _process_sequence(
    api_endpoint: str,
    sequence: dict,
    detections_limit: int,
    detections_order_by: str,
    indexed_cameras: dict,
    indexed_organizations: dict,
    access_token: str,
):
    """
    Process a single sequence to extract detections and convert them into records.

    Parameters:
        api_endpoint (str): The API endpoint to fetch data from.
        sequence (dict): The sequence data containing information about the sequence.
        indexed_cameras (dict): A dictionary of indexed cameras for easy access.
        indexed_organizations (dict): A dictionary of indexed organizations for easy access.
        access_token (str): The access token for authenticating API requests.

    Returns:
        list: A list of records extracted from the sequence detections.
    """
    detections = platform_client.list_sequence_detections(
        api_endpoint=api_endpoint,
        sequence_id=sequence["id"],
        access_token=access_token,
        limit=detections_limit,
        desc=True if detections_order_by == "desc" else False,
    )
    records = []
    for detection in detections:
        camera = indexed_cameras[sequence["camera_id"]]
        organization = indexed_organizations[camera["organization_id"]]
        record = platform_utils.to_record(
            detection=detection,
            camera=camera,
            organization=organization,
            sequence=sequence,
        )
        records.append(record)
    return records


def _fetch_sequences_for_date(api_endpoint: str, date: date, access_token: str) -> list:
    """
    Fetch sequences for a specific date.

    Parameters:
        api_endpoint (str): The API endpoint to fetch data from.
        date (date): The specific date to fetch sequences for.
        access_token (str): The access token for authenticating API requests.

    Returns:
        list: A list of sequences fetched for the specified date.
    """
    return platform_client.list_sequences_for_date(
        api_endpoint=api_endpoint,
        date=date,
        limit=1000,
        offset=0,
        access_token=access_token,
    )


def fetch_all_sequences_within(
    date_from: date,
    date_end: date,
    detections_limit: int,
    detections_order_by: str,
    api_endpoint: str,
    access_token: str,
    access_token_admin: str,
) -> list:
    """
    Fetch all sequences and detections between `date_from` and
    `date_end`

    Returns
        records
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
            f"Found {len(dates)} days between {date_from:%Y-%m-%d} and {date_end:%Y-%m-%d}: [{dates[0]:%Y-%m-%d}, {dates[1]:%Y-%m-%d},..., {dates[-2]:%Y-%m-%d}, {dates[-1]:%Y-%m-%d}]"
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

    logging.info(
        f"Collected {len(sequences)} sequences between {date_from:%Y-%m-%d} and {date_end:%Y-%m-%d}"
    )

    logging.info(
        f"Fetching all detections for the {len(sequences)} sequences between {date_from:%Y-%m-%d} and {date_end:%Y-%m-%d}"
    )
    records = []

    with concurrent.futures.ProcessPoolExecutor() as executor:
        future_to_sequence = {
            executor.submit(
                _process_sequence,
                api_endpoint,
                sequence,
                detections_limit,
                detections_order_by,
                indexed_cameras,
                indexed_organizations,
                access_token,
            ): sequence
            for sequence in sequences
        }
        for future in tqdm(
            concurrent.futures.as_completed(future_to_sequence),
            total=len(future_to_sequence),
        ):
            records.extend(future.result())

    logging.info(f"Processed {len(records)} detections")

    return records


if __name__ == "__main__":
    cli_parser = make_cli_parser()
    args = vars(cli_parser.parse_args())
    logger = logging.getLogger(__name__)
    logging.basicConfig(level=args["loglevel"].upper())
    if not validate_parsed_args(args):
        exit(1)
    elif not shared.validate_available_env_variables():
        exit(1)
    else:
        logger.info(args)
        platform_api_endpoint = os.getenv("PLATFORM_API_ENDPOINT")
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

        date_from = args["date_from"]
        date_end = args["date_end"]
        detections_limit = args["detections_limit"]
        detections_order_by = args["detections_order_by"]
        logger.info(
            f"Fetching sequences from {date_from:%Y-%m-%d} until {date_end:%Y-%m-%d} from the platform API {api_url}"
        )
        logger.info("Fetching an access token to authenticate API requests...")
        access_token = platform_client.get_api_access_token(
            api_endpoint=platform_api_endpoint,
            username=platform_login,
            password=platform_password,
        )
        logger.info(
            "Succesfully fetched an access token to authenticate API requests ✔️"
        )
        access_token_admin = platform_client.get_api_access_token(
            api_endpoint=platform_api_endpoint,
            username=platform_admin_login,
            password=platform_admin_password,
        )
        logger.info(
            "Succesfully fetched an admin access token to authenticate API requests ✔️"
        )
        headers = platform_client.make_request_headers(access_token=access_token)
        records = fetch_all_sequences_within(
            date_from=date_from,
            date_end=date_end,
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

        try:
            result = shared.post_records_to_annotation_api(annotation_api_url, records)

            logger.info("Processing complete:")
            logger.info(
                f"  Sequences: {result['successful_sequences']}/{result['total_sequences']} successful"
            )
            logger.info(
                f"  Detections: {result['successful_detections']}/{result['total_detections']} successful"
            )
            logger.info("Done ✅")

            if result["failed_sequences"] > 0 or result["failed_detections"] > 0:
                exit(1)
            else:
                exit(0)

        except Exception as e:
            logger.error(f"Unexpected error during annotation API processing: {e}")
            exit(1)
