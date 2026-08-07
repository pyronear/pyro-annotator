import asyncio
import io
import threading

import boto3
import httpx
import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.core.config import settings
from app.services import storage
from app.services.storage import S3Bucket, S3Service


@pytest.mark.parametrize(
    (
        "region",
        "endpoint_url",
        "access_key",
        "secret_key",
        "proxy_url",
        "expected_error",
    ),
    [
        (None, None, None, None, None, ValueError),
        (
            "us-east-1",
            "http://localhost:9000",
            settings.S3_ACCESS_KEY,
            settings.S3_SECRET_KEY,
            settings.S3_PROXY_URL,
            ValueError,
        ),
        (
            settings.S3_REGION,
            settings.S3_ENDPOINT_URL,
            None,
            None,
            settings.S3_PROXY_URL,
            ValueError,
        ),
        (
            settings.S3_REGION,
            settings.S3_ENDPOINT_URL,
            settings.S3_ACCESS_KEY,
            settings.S3_SECRET_KEY,
            settings.S3_PROXY_URL,
            None,
        ),
    ],
)
@pytest.mark.asyncio
async def test_s3_service(
    region, endpoint_url, access_key, secret_key, proxy_url, expected_error
):
    if expected_error is None:
        service = S3Service(region, endpoint_url, access_key, secret_key, proxy_url)
        assert isinstance(service.resolve_bucket_name(), str)
        # Create random bucket
        bucket_name = "dummy-bucket"
        service.create_bucket(bucket_name)
        # Delete the bucket
        await service.delete_bucket(bucket_name)
    else:
        with pytest.raises(expected_error):
            S3Service(region, endpoint_url, access_key, secret_key, proxy_url)


@pytest.mark.parametrize(
    ("bucket_name", "proxy_url", "expected_error"),
    [
        (None, None, TypeError),
        ("dummy-bucket1", None, ValueError),
        ("dummy-bucket2", settings.S3_PROXY_URL, None),
    ],
)
@pytest.mark.asyncio
async def test_s3_bucket(bucket_name, proxy_url, expected_error, mock_img):
    _session = boto3.Session(
        settings.S3_ACCESS_KEY, settings.S3_SECRET_KEY, region_name=settings.S3_REGION
    )
    _s3 = _session.client("s3", endpoint_url=settings.S3_ENDPOINT_URL)
    if expected_error is None:
        _s3.create_bucket(
            Bucket=bucket_name,
            CreateBucketConfiguration={"LocationConstraint": settings.S3_REGION},
        )
        bucket = S3Bucket(_s3, bucket_name, proxy_url)
        bucket_key = "logo.png"
        # Create file
        assert not bucket.check_file_existence(bucket_key)
        bucket.upload_file(bucket_key, io.BytesIO(mock_img))
        assert bucket.check_file_existence(bucket_key)
        assert isinstance(bucket.get_file_metadata(bucket_key), dict)
        assert bucket.get_public_url(bucket_key).startswith("http://")
        # Delete file
        bucket.delete_file(bucket_key)
        assert not bucket.check_file_existence(bucket_key)
        # Delete all items
        bucket.upload_file(bucket_key, io.BytesIO(mock_img))
        assert bucket.check_file_existence(bucket_key)
        await bucket.delete_items()
        assert not bucket.check_file_existence(bucket_key)
        # Delete the bucket
        _s3.delete_bucket(Bucket=bucket_name)
    else:
        with pytest.raises(expected_error):
            S3Bucket(_s3, bucket_name, proxy_url)


def _configured_service() -> S3Service:
    return S3Service(
        settings.S3_REGION,
        settings.S3_ENDPOINT_URL,
        settings.S3_ACCESS_KEY,
        settings.S3_SECRET_KEY,
        settings.S3_PROXY_URL,
    )


def test_s3_client_is_per_thread():
    """Each thread gets its own boto3 client.

    Storage work runs in a threadpool, so the process-wide client would
    otherwise be used concurrently. boto3 Sessions are not documented as
    thread-safe, and upload_fileobj drives the transfer manager, which spawns
    threads of its own.
    """
    service = _configured_service()
    # Keep the client OBJECTS alive, not their id()s: a thread's client is
    # released when the thread dies, and CPython will happily hand the next
    # allocation the same address. Comparing ids made this test pass alone and
    # fail in a full run.
    seen = {}

    def record(name):
        seen[name] = service._s3

    threads = [
        threading.Thread(target=record, args=("a",)),
        threading.Thread(target=record, args=("b",)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert seen["a"] is not seen["b"], "two threads shared one boto3 client"
    assert service._s3 is service._s3, "same thread rebuilt its client"


def test_get_bucket_probes_once_per_thread(monkeypatch):
    """head_bucket is a network round trip, and it ran on every request.

    S3Bucket.__init__ probes the bucket purely to validate the handle it hands
    back, and get_bucket runs on every request that touches storage -- so every
    detection creation and every image URL paid for an extra S3 round trip.
    """
    service = _configured_service()
    name = service.resolve_bucket_name()
    probes = []
    real_head = service._s3.head_bucket

    def counting_head(**kwargs):
        probes.append(kwargs)
        return real_head(**kwargs)

    monkeypatch.setattr(service._s3, "head_bucket", counting_head)

    first = service.get_bucket(name)
    for _ in range(5):
        service.get_bucket(name)

    assert len(probes) == 1, f"head_bucket ran {len(probes)} times, expected 1"
    assert service.get_bucket(name) is first


def test_bucket_cache_is_per_thread():
    """The cache must not hand one thread a handle wrapping another's client.

    It shares the thread-local with the client for exactly this reason; a
    process-wide cache would silently undo the per-thread client.

    Populate from THIS thread first, then read from another. Racing two fresh
    threads instead would let both observe an empty cache and each build their
    own handle, so a process-wide cache would pass by luck -- verified: it did.
    """
    service = _configured_service()
    name = service.resolve_bucket_name()

    mine = service.get_bucket(name)
    other = {}

    def record():
        bucket = service.get_bucket(name)
        other["bucket"] = bucket
        other["client"] = bucket._s3

    thread = threading.Thread(target=record)
    thread.start()
    thread.join()

    assert other["bucket"] is not mine, "bucket handle leaked across threads"
    assert (
        other["client"] is not mine._s3
    ), "bucket handed a thread another thread's boto3 client"


def _forget_download_client():
    """Drop the cached client without closing it.

    A client must be closed on the loop that built it: aclose() on a pool
    still holding live keep-alive connections from a finished loop raises
    "Event loop is closed". Whatever is cached on entry to a test belongs to
    an earlier test's loop, so it gets dropped rather than closed. It survives
    here only because nothing else in the process reaches it.

    The local test S3 happens to answer `Connection: close`, which empties the
    pool and hides this -- don't let that become the reason it works.
    """
    storage._download_client = None
    storage._download_client_loop = None


@pytest_asyncio.fixture
async def fresh_download_client():
    """Start and end with no cached download client.

    The cache is process-wide, so a client built here -- especially one wired
    to a mock transport -- would otherwise be handed to later tests.
    """
    _forget_download_client()
    yield
    # Always this test's own client, so closing it is safe.
    await storage.close_download_client()


def _mock_download_client(handler):
    """An httpx.AsyncClient factory that answers every request from `handler`."""
    real_client = httpx.AsyncClient

    def build(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    return build


@pytest.mark.asyncio
async def test_upload_file_from_url_reuses_one_http_client(
    monkeypatch, fresh_download_client
):
    """One client for all downloads, not one per detection.

    With IMAGE_TRANSFER=url this path runs once per detection, so a per-call
    client makes every one of an import's thousands of images pay a fresh
    TCP+TLS handshake to the alert API's S3.
    """
    constructed = []
    build = _mock_download_client(lambda request: httpx.Response(200, content=b"img"))

    def counting_client(*args, **kwargs):
        client = build(*args, **kwargs)
        constructed.append(client)
        return client

    monkeypatch.setattr(storage.httpx, "AsyncClient", counting_client)
    monkeypatch.setattr(storage, "_store_downloaded_image", lambda *args: "bucket-key")

    for _ in range(3):
        key = await storage.upload_file_from_url("https://example.invalid/a.jpg")
        assert key == "bucket-key"

    assert (
        len(constructed) == 1
    ), f"built {len(constructed)} clients for 3 downloads, expected 1"


def test_download_client_is_rebuilt_for_a_new_event_loop():
    """A client's pooled connections belong to the loop that opened them.

    Handing a second loop the first loop's client would have it reuse
    connections whose loop is gone. The test suite runs one loop per test,
    which is exactly that situation.
    """
    _forget_download_client()

    first = asyncio.run(_current_download_client())
    second = asyncio.run(_current_download_client())

    assert second is not first, "a new event loop was handed the old loop's client"

    _forget_download_client()


async def _current_download_client():
    return storage._get_download_client()


@pytest.mark.asyncio
async def test_close_download_client_closes_and_clears_it(fresh_download_client):
    """Shutdown must actually release the client, not just drop the reference."""
    client = storage._get_download_client()

    await storage.close_download_client()

    assert client.is_closed
    assert storage._get_download_client() is not client


def _raising_handler(exc):
    def handler(request):
        raise exc

    return handler


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handler", "expected_status", "expected_detail"),
    [
        (
            _raising_handler(httpx.TimeoutException("slow")),
            504,
            "Timeout downloading image",
        ),
        (
            _raising_handler(httpx.ConnectError("refused")),
            502,
            "Could not connect to source URL",
        ),
        (
            _raising_handler(httpx.RemoteProtocolError("server disconnected")),
            502,
            "Source URL closed the connection",
        ),
        (lambda request: httpx.Response(404), 422, "Source URL returned HTTP 404"),
        (lambda request: httpx.Response(503), 502, "Source URL server error: HTTP 503"),
        (
            lambda request: httpx.Response(200, content=b""),
            422,
            "Source URL returned empty response",
        ),
    ],
)
async def test_upload_file_from_url_maps_download_failures(
    monkeypatch, fresh_download_client, handler, expected_status, expected_detail
):
    """Sharing the client must not change what a failed download reports."""
    monkeypatch.setattr(storage.httpx, "AsyncClient", _mock_download_client(handler))

    with pytest.raises(HTTPException) as excinfo:
        await storage.upload_file_from_url("https://example.invalid/a.jpg")

    assert excinfo.value.status_code == expected_status
    assert expected_detail in excinfo.value.detail
