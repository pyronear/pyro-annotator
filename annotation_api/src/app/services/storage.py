# Copyright (C) 2022-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.

import asyncio
import hashlib
import logging
import os
import threading
from datetime import datetime, UTC
from mimetypes import guess_extension
from typing import Any, Dict, Optional, Union

import boto3
import httpx
import magic
from botocore.exceptions import (
    ClientError,
    EndpointConnectionError,
    NoCredentialsError,
    PartialCredentialsError,
)
from fastapi import HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.core.config import settings

__all__ = [
    "close_download_client",
    "copy_file_from_bucket",
    "s3_service",
    "upload_file",
    "upload_file_from_url",
]


logger = logging.getLogger("uvicorn.warning")


class S3Bucket:
    """S3 bucket manager

    Args:
        s3_client: the client of the S3 service
        bucket_name: the name of the bucket
        proxy_url: the proxy url
    """

    def __init__(
        self,
        s3_client: boto3.client,
        bucket_name: str,
        proxy_url: Union[str, None] = None,
    ) -> None:
        self._s3 = s3_client
        try:
            self._s3.head_bucket(Bucket=bucket_name)
        except EndpointConnectionError:
            raise ValueError(f"unable to access endpoint {self._s3.meta.endpoint_url}")
        except ClientError:
            raise ValueError(f"unable to access bucket {bucket_name}")
        self.name = bucket_name
        self.proxy_url = proxy_url

    def get_file_metadata(self, bucket_key: str) -> Dict[str, Any]:
        # https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3.html#S3.Client.head_object
        return self._s3.head_object(Bucket=self.name, Key=bucket_key)

    def check_file_existence(self, bucket_key: str) -> bool:
        """Check whether a file exists on the bucket"""
        try:
            # Use boto3 head_object method using the Qarnot private connection attribute
            head_object = self.get_file_metadata(bucket_key)
            return head_object["ResponseMetadata"]["HTTPStatusCode"] == 200
        except ClientError as e:
            logger.warning(e)
            return False

    def upload_file(self, bucket_key: str, file_binary: bytes) -> bool:
        """Upload a file to bucket and return whether the upload succeeded"""
        # https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3.html#S3.Bucket.upload_fileobj
        self._s3.upload_fileobj(file_binary, self.name, bucket_key)
        return True

    def upload_file_bytes(
        self,
        file_bytes: bytes,
        bucket_key: str,
        content_type: str = "application/octet-stream",
    ) -> bool:
        """Upload bytes to bucket with specified content type"""
        from io import BytesIO

        file_obj = BytesIO(file_bytes)
        self._s3.upload_fileobj(
            file_obj, self.name, bucket_key, ExtraArgs={"ContentType": content_type}
        )
        return True

    def download_file(self, bucket_key: str) -> bytes:
        """Download a file from bucket and return its content as bytes"""
        from io import BytesIO

        file_obj = BytesIO()
        self._s3.download_fileobj(self.name, bucket_key, file_obj)
        file_obj.seek(0)
        return file_obj.getvalue()

    def delete_file(self, bucket_key: str) -> None:
        """Remove bucket file and return whether the deletion succeeded"""
        # https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3.html#S3.Client.delete_object
        self._s3.delete_object(Bucket=self.name, Key=bucket_key)

    def copy_from(
        self, source_bucket: str, source_key: str, dest_key: str
    ) -> Dict[str, Any]:
        """Server-side copy of an object from another bucket on the same S3 service.

        Returns the destination head_object response so callers can verify size.
        """
        self._s3.copy_object(
            Bucket=self.name,
            Key=dest_key,
            CopySource={"Bucket": source_bucket, "Key": source_key},
        )
        return self.get_file_metadata(dest_key)

    def get_public_url(
        self, bucket_key: str, url_expiration: int = settings.S3_URL_EXPIRATION
    ) -> str:
        """Generate a temporary public URL for a bucket file"""
        if not self.check_file_existence(bucket_key):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File cannot be found on the bucket storage",
            )

        return self.generate_presigned_url(bucket_key, url_expiration)

    def generate_presigned_url(
        self, bucket_key: str, url_expiration: int = settings.S3_URL_EXPIRATION
    ) -> str:
        """Generate a presigned URL without checking file existence.

        Use this for bulk operations where the file is known to exist
        (e.g. exporting rows from the database).
        """
        presigned_url = self._s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.name, "Key": bucket_key},
            ExpiresIn=url_expiration,
        )
        if self.proxy_url:
            return presigned_url.replace(self._s3.meta.endpoint_url, self.proxy_url)
        return presigned_url

    async def delete_items(self) -> None:
        """Delete all items in the bucket"""
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.name):
            if "Contents" in page:
                delete_items = [{"Key": obj["Key"]} for obj in page["Contents"]]
                self._s3.delete_objects(
                    Bucket=self.name, Delete={"Objects": delete_items}
                )


class S3Service:
    """S3 storage service manager

    Args:
        region: S3 region
        endpoint_url: the S3 storage endpoint
        access_key: the S3 access key
        secret_key: the S3 secret key
        proxy_url: the proxy url
    """

    def __init__(
        self,
        region: str,
        endpoint_url: str,
        access_key: str,
        secret_key: str,
        proxy_url: Union[str, None] = None,
    ) -> None:
        self._region = region
        self._endpoint_url = endpoint_url
        self._access_key = access_key
        self._secret_key = secret_key
        # Storage work runs in a threadpool (see the storage functions below),
        # so a process-wide client would be used concurrently. boto3 Sessions
        # are not documented as thread-safe, and upload_fileobj drives the
        # transfer manager, which spawns threads of its own. Each thread builds
        # and keeps its own client instead.
        self._local = threading.local()
        # Probe with head_bucket on the configured destination bucket so least-
        # privilege credentials (without s3:ListAllMyBuckets) still validate.
        try:
            self._s3.head_bucket(Bucket=settings.S3_BUCKET_NAME)
        except (NoCredentialsError, PartialCredentialsError):
            raise ValueError("invalid S3 credentials")
        except EndpointConnectionError:
            raise ValueError(f"unable to access endpoint {endpoint_url}")
        except ClientError:
            raise ValueError(f"unable to access bucket {settings.S3_BUCKET_NAME} on S3")
        logger.info(f"S3 connected on {endpoint_url}")
        self.proxy_url = proxy_url

    @property
    def _s3(self) -> Any:
        """The calling thread's boto3 client, built on first use."""
        client = getattr(self._local, "client", None)
        if client is None:
            session = boto3.Session(
                self._access_key, self._secret_key, region_name=self._region
            )
            client = session.client("s3", endpoint_url=self._endpoint_url)
            self._local.client = client
        return client

    def create_bucket(self, bucket_name: str) -> bool:
        """Create a new bucket in S3 storage"""
        try:
            self._s3.create_bucket(
                Bucket=bucket_name,
                CreateBucketConfiguration={
                    "LocationConstraint": self._s3.meta.region_name
                },
            )
            return True
        except ClientError as e:
            logger.warning(e)
            return False

    def get_bucket(self, bucket_name: str) -> S3Bucket:
        """Get an existing bucket in S3 storage.

        Cached per thread. S3Bucket.__init__ issues a head_bucket -- a network
        round trip -- purely to validate the handle it returns, and get_bucket
        runs on every request that touches storage, so this was an extra S3
        call per detection creation and per image URL.

        The cache lives in the same thread-local as the client so a thread can
        never receive a handle wrapping another thread's client.
        """
        cache = getattr(self._local, "buckets", None)
        if cache is None:
            cache = {}
            self._local.buckets = cache
        bucket = cache.get(bucket_name)
        if bucket is None:
            bucket = S3Bucket(self._s3, bucket_name, self.proxy_url)
            cache[bucket_name] = bucket
        return bucket

    async def delete_bucket(self, bucket_name: str) -> bool:
        """Delete an existing bucket in S3 storage"""
        bucket = S3Bucket(self._s3, bucket_name, self.proxy_url)
        try:
            await bucket.delete_items()
            self._s3.delete_bucket(Bucket=bucket_name)
            return True
        except ClientError as e:
            logger.warning(e)
            return False

    @staticmethod
    def resolve_bucket_name() -> str:
        return settings.S3_BUCKET_NAME


async def upload_file(
    file: UploadFile,
    sequence_id: Optional[int] = None,
    detection_id: Optional[int] = None,
    recorded_at: Optional[datetime] = None,
) -> str:
    """Upload a file to S3 storage and return the bucket key"""
    # Concatenate the first 8 chars of SHA256 hash to avoid system interaction issues
    sha_hash = hashlib.sha256(file.file.read()).hexdigest()
    await file.seek(0)
    # Use MD5 to verify upload
    md5_hash = hashlib.md5(file.file.read()).hexdigest()  # noqa: S324
    await file.seek(0)
    # guess_extension will return None if this fails
    extension = guess_extension(magic.from_buffer(file.file.read(), mime=True)) or ""

    # Generate organized bucket key
    bucket_key = _generate_detection_bucket_key(
        sequence_id=sequence_id,
        detection_id=detection_id,
        recorded_at=recorded_at,
        sha_hash=sha_hash[:8],
        extension=extension,
    )

    # Reset byte position of the file
    await file.seek(0)
    bucket_name = s3_service.resolve_bucket_name()
    bucket = s3_service.get_bucket(bucket_name)

    # Upload the file
    if not bucket.upload_file(bucket_key, file.file):  # type: ignore[arg-type]
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed upload",
        )
    logging.info(
        "File uploaded to bucket %s with key %s.",
        bucket_name,
        bucket_key,
    )

    # Data integrity check when metadata is available
    if hasattr(bucket, "get_file_metadata"):
        try:
            file_meta = bucket.get_file_metadata(bucket_key)  # type: ignore[attr-defined]
        except Exception as exc:  # pragma: no cover
            logging.warning(
                "Could not retrieve file metadata for %s: %s",
                bucket_key,
                exc,
            )
        else:
            # Original behavior with ETag and MD5
            etag = file_meta.get("ETag") or file_meta.get("etag")
            if etag is not None and md5_hash != etag.replace('"', ""):
                # Delete the corrupted upload if supported
                if hasattr(bucket, "delete_file"):
                    try:
                        bucket.delete_file(bucket_key)  # type: ignore[attr-defined]
                    except Exception as exc:  # pragma: no cover
                        logging.warning(
                            "Failed to delete corrupted file %s: %s",
                            bucket_key,
                            exc,
                        )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Data was corrupted during upload",
                )

    return bucket_key


def _generate_detection_bucket_key(
    sequence_id: Optional[int] = None,
    detection_id: Optional[int] = None,
    recorded_at: Optional[datetime] = None,
    sha_hash: str = "",
    extension: str = "",
) -> str:
    """
    Generate hierarchical bucket key for detection images.

    Pattern: detections/sequence_{sequence_id}/{YYYYMMDD_HHMMSS}_det{detection_id}_{hash}.{ext}
    Fallback: detections/legacy/{YYYYMMDD_HHMMSS}_{hash}.{ext} if metadata unavailable
    """
    # Use recorded_at timestamp or fallback to upload time
    timestamp = recorded_at or datetime.now(UTC)
    timestamp_str = timestamp.strftime("%Y%m%d_%H%M%S")

    # Organized structure if metadata available
    if sequence_id is not None and detection_id is not None:
        return f"detections/sequence_{sequence_id}/{timestamp_str}_det{detection_id}_{sha_hash}{extension}"

    # Fallback structure for incomplete metadata
    return f"detections/legacy/{timestamp_str}_{sha_hash}{extension}"


def _store_downloaded_image(
    image_bytes: bytes,
    sequence_id: Optional[int],
    detection_id: Optional[int],
    recorded_at: Optional[datetime],
) -> str:
    """Hash, type-sniff, upload and verify image bytes. Returns the bucket key.

    Blocking throughout: every step is either CPU over the full image or an S3
    round trip. Run it in a thread — on the event loop it serialized every
    other request behind it.
    """
    sha_hash = hashlib.sha256(image_bytes).hexdigest()
    md5_hash = hashlib.md5(image_bytes).hexdigest()  # noqa: S324
    content_type = magic.from_buffer(image_bytes, mime=True)
    extension = guess_extension(content_type) or ""

    bucket_key = _generate_detection_bucket_key(
        sequence_id=sequence_id,
        detection_id=detection_id,
        recorded_at=recorded_at,
        sha_hash=sha_hash[:8],
        extension=extension,
    )

    bucket_name = s3_service.resolve_bucket_name()
    bucket = s3_service.get_bucket(bucket_name)

    if not bucket.upload_file_bytes(
        image_bytes, bucket_key, content_type or "application/octet-stream"
    ):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed upload",
        )
    logging.info("File uploaded to bucket %s with key %s.", bucket_name, bucket_key)

    # Data integrity check
    try:
        file_meta = bucket.get_file_metadata(bucket_key)
    except Exception as exc:
        logging.warning("Could not retrieve file metadata for %s: %s", bucket_key, exc)
    else:
        etag = file_meta.get("ETag") or file_meta.get("etag")
        if etag is not None and md5_hash != etag.replace('"', ""):
            try:
                bucket.delete_file(bucket_key)
            except Exception as exc:
                logging.warning(
                    "Failed to delete corrupted file %s: %s", bucket_key, exc
                )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Data was corrupted during upload",
            )

    return bucket_key


_download_client: Optional[httpx.AsyncClient] = None
_download_client_loop: Optional[asyncio.AbstractEventLoop] = None


def _get_download_client() -> httpx.AsyncClient:
    """The image-download client, built on first use.

    One client for the whole process: with IMAGE_TRANSFER=url an import runs
    the download below once per detection, and a client per call made every
    one of those thousands of images pay a fresh TCP+TLS handshake to the
    source S3 host. This is the download-leg counterpart of the per-thread
    boto3 client above.

    Rebuilt when the running loop changes, because a client's pooled
    connections belong to the loop that opened them. Production has one loop
    per worker process and never rebuilds; the tests run one loop per test and
    must not be handed a dead loop's connections.
    """
    global _download_client, _download_client_loop

    loop = asyncio.get_running_loop()
    if _download_client is None or _download_client_loop is not loop:
        _download_client = httpx.AsyncClient()
        _download_client_loop = loop
    return _download_client


async def close_download_client() -> None:
    """Release the image-download client. Called from the app lifespan."""
    global _download_client, _download_client_loop

    client = _download_client
    _download_client = None
    _download_client_loop = None
    if client is not None:
        await client.aclose()


async def upload_file_from_url(
    source_url: str,
    sequence_id: Optional[int] = None,
    detection_id: Optional[int] = None,
    recorded_at: Optional[datetime] = None,
    download_timeout: int = 30,
) -> str:
    """Download image from a URL and upload to S3. Returns the bucket key.

    This avoids the client downloading the image and re-uploading it via
    multipart form, cutting out one full network round-trip per detection.
    """
    try:
        resp = await _get_download_client().get(source_url, timeout=download_timeout)
        resp.raise_for_status()
        image_bytes = resp.content
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Timeout downloading image from source URL: {source_url}",
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not connect to source URL: {source_url}",
        )
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if 400 <= code < 500:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Source URL returned HTTP {code}",
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Source URL server error: HTTP {code}",
        )

    if not image_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Source URL returned empty response",
        )

    return await run_in_threadpool(
        _store_downloaded_image,
        image_bytes,
        sequence_id,
        detection_id,
        recorded_at,
    )


def _copy_file_from_bucket_sync(
    source_bucket: str,
    source_key: str,
    sequence_id: Optional[int],
    detection_id: Optional[int],
    recorded_at: Optional[datetime],
) -> str:
    """Server-side copy from another bucket on the same S3 service.

    Returns the destination bucket key. Verifies the destination is non-empty
    via head_object and cleans up if the copy produced a zero-byte object.

    Blocking: copy_object plus head_object, both S3 round trips. Callers reach
    it through `copy_file_from_bucket`, which runs it in a thread.
    """
    extension = os.path.splitext(source_key)[1]
    sha_hash = hashlib.sha256(f"{source_bucket}/{source_key}".encode()).hexdigest()[:8]
    dest_key = _generate_detection_bucket_key(
        sequence_id=sequence_id,
        detection_id=detection_id,
        recorded_at=recorded_at,
        sha_hash=sha_hash,
        extension=extension,
    )

    bucket_name = s3_service.resolve_bucket_name()
    bucket = s3_service.get_bucket(bucket_name)

    try:
        head = bucket.copy_from(source_bucket, source_key, dest_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        logging.warning(
            "S3 copy failed (code=%s) %s/%s -> %s/%s: %s",
            code,
            source_bucket,
            source_key,
            bucket_name,
            dest_key,
            exc,
        )
        if code in ("NoSuchKey", "NoSuchBucket", "404"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Source object not found",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="S3 copy failed",
        ) from exc

    # The platform uploader does not set ContentType when storing detection
    # images, so source metadata is unreliable for content validation. Trust
    # the size signal only — non-zero copied bytes from a known platform
    # bucket suffice for an image we already accepted upstream.
    content_length = head.get("ContentLength", 0) or 0
    if content_length <= 0:
        try:
            bucket.delete_file(dest_key)
        except Exception:
            logging.warning("Failed to delete empty copied object %s", dest_key)
        logging.warning(
            "Rejected empty copied object %s/%s",
            source_bucket,
            source_key,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Copied object is empty",
        )

    logging.info(
        "Copied %s/%s -> %s/%s (%d bytes)",
        source_bucket,
        source_key,
        bucket_name,
        dest_key,
        content_length,
    )
    return dest_key


async def copy_file_from_bucket(
    source_bucket: str,
    source_key: str,
    sequence_id: Optional[int] = None,
    detection_id: Optional[int] = None,
    recorded_at: Optional[datetime] = None,
) -> str:
    """Server-side copy from another bucket on the same S3 service.

    Returns the destination bucket key. The boto3 work is blocking, so it runs
    in a thread rather than stalling the event loop for every other request.
    """
    return await run_in_threadpool(
        _copy_file_from_bucket_sync,
        source_bucket,
        source_key,
        sequence_id,
        detection_id,
        recorded_at,
    )


s3_service = S3Service(
    settings.S3_REGION,
    settings.S3_ENDPOINT_URL,
    settings.S3_ACCESS_KEY,
    settings.S3_SECRET_KEY,
    settings.S3_PROXY_URL,
)
