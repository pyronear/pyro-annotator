"""
Idempotent script to create the annotation API S3 bucket on OVH.

Reads S3 settings from annotation_api/.env (S3_ENDPOINT_URL, S3_REGION,
S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET_NAME) and creates the destination
bucket if it does not already exist. Safe to re-run.

Usage:
    cd annotation_api
    uv run python scripts/create_ovh_bucket.py
"""

from __future__ import annotations

import logging
import os
import sys

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv


def main() -> int:
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    required = ["S3_ENDPOINT_URL", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"]
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        logging.error("Missing required env vars: %s", ", ".join(missing))
        return 1

    bucket_name = os.environ.get("S3_BUCKET_NAME", "annotation-api")
    region = os.environ["S3_REGION"]
    endpoint_url = os.environ["S3_ENDPOINT_URL"]

    session = boto3.Session(
        os.environ["S3_ACCESS_KEY"],
        os.environ["S3_SECRET_KEY"],
        region_name=region,
    )
    s3 = session.client("s3", endpoint_url=endpoint_url)

    try:
        s3.head_bucket(Bucket=bucket_name)
        logging.info("Bucket %s already exists on %s", bucket_name, endpoint_url)
        return 0
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code not in ("404", "NoSuchBucket", "NotFound"):
            logging.error("head_bucket failed: %s", exc)
            return 1

    try:
        s3.create_bucket(
            Bucket=bucket_name,
            CreateBucketConfiguration={"LocationConstraint": region},
        )
    except ClientError as exc:
        logging.error("create_bucket failed: %s", exc)
        return 1

    logging.info("Created bucket %s in region %s", bucket_name, region)
    return 0


if __name__ == "__main__":
    sys.exit(main())
