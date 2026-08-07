import asyncio
import json
from datetime import datetime, timedelta, UTC

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.orm import sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import engine, get_session
from app.main import app
from app.services.storage import s3_service

now = datetime.now(UTC)


@pytest.mark.asyncio
async def test_create_detection(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    payload = {
        "sequence_id": "1",  # en multipart/form-data, tout est str
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    response = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert response.status_code == 201
    json_response = response.json()
    assert "id" in json_response
    assert json_response["sequence_id"] == int(payload["sequence_id"])
    assert json_response["algo_predictions"] == json.loads(payload["algo_predictions"])


@pytest.mark.asyncio
async def test_create_detection_with_others_bboxes(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """`others_bboxes` is optional sibling-box context for the UI: it must
    persist alongside `algo_predictions` and round-trip on GET, but it never
    flows into auto-annotation."""
    others = {
        "predictions": [
            {
                "xyxyn": [0.5, 0.5, 0.6, 0.6],
                "confidence": 0.42,
                "class_name": "smoke",
            }
        ]
    }
    payload = {
        "sequence_id": "1",
        "alert_api_id": "9001",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
        "others_bboxes": json.dumps(others),
    }

    response = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert response.status_code == 201
    created = response.json()
    assert created["others_bboxes"] == others

    # Round-trip via GET to confirm DB persistence + serialization.
    fetched = await authenticated_client.get(f"/detections/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["others_bboxes"] == others


@pytest.mark.asyncio
async def test_create_detection_with_auto_predictions(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """`auto_predictions` is the immutable local auto-annotation model output:
    it must persist on the detection and round-trip on GET."""
    auto = {
        "predictions": [
            {
                "xyxyn": [0.3, 0.3, 0.4, 0.4],
                "confidence": 0.77,
                "class_name": "smoke",
            }
        ]
    }
    payload = {
        "sequence_id": "1",
        "alert_api_id": "9002",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
        "auto_predictions": json.dumps(auto),
    }

    response = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert response.status_code == 201
    created = response.json()
    assert created["auto_predictions"] == auto

    fetched = await authenticated_client.get(f"/detections/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["auto_predictions"] == auto


@pytest.mark.asyncio
async def test_get_detection(authenticated_client: AsyncClient):
    detection_id = 1
    response = await authenticated_client.get(f"/detections/{detection_id}")
    if response.status_code == 200:
        detection = response.json()
        assert detection["id"] == detection_id
        assert "algo_predictions" in detection
    else:
        assert response.status_code in (404, 422)


@pytest.mark.asyncio
async def test_get_detection_url(
    authenticated_client: AsyncClient, detection_id: int = 1
):
    response = await authenticated_client.get(f"/detections/{detection_id}/url")
    if response.status_code == 200:
        url_data = response.json()
        assert "url" in url_data
        assert url_data["url"].startswith("http")
    else:
        assert response.status_code in (404, 422)


@pytest.mark.asyncio
async def test_list_detections(authenticated_client: AsyncClient):
    response = await authenticated_client.get("/detections/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data
    assert "page" in data
    assert "pages" in data
    assert "size" in data
    assert isinstance(data["items"], list)


@pytest.mark.asyncio
async def test_delete_detection(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    payload = {
        "sequence_id": "1",  # en multipart/form-data, tout est str
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    response = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert response.status_code == 201
    detection_id = response.json()["id"]

    delete_resp = await authenticated_client.delete(f"/detections/{detection_id}")
    assert delete_resp.status_code == 204

    get_resp = await authenticated_client.get(f"/detections/{detection_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_create_detection_invalid_xyxyn_values(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    payload = {
        "sequence_id": "1",
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.3, 0.3, 0.2, 0.2],  # x1 > x2, y1 > y2
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    response = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_detection_invalid_xyxyn_range(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    payload = {
        "sequence_id": "1",
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 1.5, 0.9],  # x2 > 1.0
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    response = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_detection_invalid_confidence(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    payload = {
        "sequence_id": "1",
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 1.5,  # confidence > 1.0
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    response = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


@pytest.mark.asyncio
async def test_create_detection_invalid_json_structure(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    payload = {
        "sequence_id": "1",
        "alert_api_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "wrong_field": [  # Should be "predictions"
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    response = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert response.status_code == 422
    error_data = response.json()
    assert "detail" in error_data


# Additional error scenario tests
@pytest.mark.asyncio
async def test_get_detection_not_found(authenticated_client: AsyncClient):
    response = await authenticated_client.get("/detections/99999")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_detection_invalid_id(authenticated_client: AsyncClient):
    response = await authenticated_client.get("/detections/invalid")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_get_detection_url_not_found(authenticated_client: AsyncClient):
    response = await authenticated_client.get("/detections/99999/url")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_detection_url_invalid_id(authenticated_client: AsyncClient):
    response = await authenticated_client.get("/detections/invalid/url")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_detection_without_file(
    authenticated_client: AsyncClient, sequence_session: AsyncSession
):
    payload = {
        "sequence_id": "1",
        "alert_api_id": "1",
        "recorded_at": now.isoformat(),
    }

    response = await authenticated_client.post("/detections/", data=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_delete_detection_not_found(authenticated_client: AsyncClient):
    response = await authenticated_client.delete("/detections/99999")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_detection_invalid_id(authenticated_client: AsyncClient):
    response = await authenticated_client.delete("/detections/invalid")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_detection_same_alert_api_id_other_sequence(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """Uniqueness is scoped per sequence: object-split sibling sequences share
    the same alert detection ids, so the same alert_api_id must be accepted in
    a different sequence."""
    payload = {
        "sequence_id": "1",
        "alert_api_id": "999",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    response1 = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image1.jpg", mock_img, "image/jpeg")},
    )
    assert response1.status_code == 201
    detection1 = response1.json()

    payload2 = payload.copy()
    payload2["sequence_id"] = "2"

    response2 = await authenticated_client.post(
        "/detections/",
        data=payload2,
        files={"file": ("image2.jpg", mock_img, "image/jpeg")},
    )
    assert response2.status_code == 201
    detection2 = response2.json()

    assert detection1["alert_api_id"] == detection2["alert_api_id"]
    assert detection1["id"] != detection2["id"]


@pytest.mark.asyncio
async def test_create_detection_different_alert_api_id_allows_duplicate_processing(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """Test that detections with different alert_api_id can be created without constraint issues."""
    base_payload = {
        "sequence_id": "1",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    # Create detection with alert_api_id 777
    payload1 = base_payload.copy()
    payload1["alert_api_id"] = "777"

    response1 = await authenticated_client.post(
        "/detections/",
        data=payload1,
        files={"file": ("image1.jpg", mock_img, "image/jpeg")},
    )
    assert response1.status_code == 201
    detection1 = response1.json()
    assert detection1["alert_api_id"] == 777

    # Create detection with alert_api_id 888
    payload2 = base_payload.copy()
    payload2["alert_api_id"] = "888"

    response2 = await authenticated_client.post(
        "/detections/",
        data=payload2,
        files={"file": ("image2.jpg", mock_img, "image/jpeg")},
    )
    assert response2.status_code == 201
    detection2 = response2.json()
    assert detection2["alert_api_id"] == 888

    # Both should succeed with different alert_api_id values
    assert detection1["alert_api_id"] != detection2["alert_api_id"]
    # Even if they might have same id, the unique constraint (alert_api_id, id) allows this
    # since alert_api_id is different


@pytest.mark.asyncio
async def test_create_detection_with_alert_api_id_above_int32(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """detections.alert_api_id must be BigInteger, consistent with sequences
    (platform ids can exceed int32)."""
    payload = {
        "sequence_id": "1",
        "alert_api_id": str(2**31),
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps({"predictions": []}),
    }

    response = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert response.status_code == 201
    assert response.json()["alert_api_id"] == 2**31


@pytest.mark.asyncio
async def test_create_duplicate_detection_returns_409(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """Same (sequence_id, alert_api_id) twice: second POST must 409 and not
    create a second row (idempotent re-import guarantee)."""
    payload = {
        "sequence_id": "1",
        "alert_api_id": "4242",
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.95,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }

    first = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert first.status_code == 201

    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
    objects_after_first = bucket._s3.list_objects_v2(
        Bucket=bucket.name, Prefix="detections/sequence_1/"
    ).get("KeyCount", 0)

    second = await authenticated_client.post(
        "/detections/",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert second.status_code == 409

    listing = await authenticated_client.get("/detections/", params={"sequence_id": 1})
    assert listing.status_code == 200
    matches = [d for d in listing.json()["items"] if d["alert_api_id"] == 4242]
    assert len(matches) == 1

    # The duplicate is rejected at flush time, before any upload happens.
    objects_after_second = bucket._s3.list_objects_v2(
        Bucket=bucket.name, Prefix="detections/sequence_1/"
    ).get("KeyCount", 0)
    assert objects_after_second == objects_after_first


@pytest_asyncio.fixture
async def concurrent_client(authenticated_client: AsyncClient):
    """An authenticated client whose requests each get their own DB session.

    conftest overrides get_session to hand every request the SAME session so
    tests can inspect state. That is fine when requests are serialized, but an
    AsyncSession is not safe for concurrent use, so concurrency tests driven
    through it fail inside SQLAlchemy and tell you nothing about the code under
    test. Production hands each request a fresh session from the pool; this
    restores that, so the concurrency being tested is the real thing.
    """
    maker = sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )

    async def _fresh_session():
        async with maker() as session:
            yield session

    previous = app.dependency_overrides.get(get_session)
    app.dependency_overrides[get_session] = _fresh_session
    try:
        yield authenticated_client
    finally:
        if previous is not None:
            app.dependency_overrides[get_session] = previous
        else:
            app.dependency_overrides.pop(get_session, None)


def _reachable_source_url(mock_img: bytes, key: str) -> str:
    """Put an image in the bucket and return a URL the API can actually fetch.

    Presigned against S3_ENDPOINT_URL rather than S3_PROXY_URL: the proxy URL
    is for browsers on the host, while the API resolves the in-network name.
    """
    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
    bucket.upload_file_bytes(mock_img, key, "image/jpeg")
    return bucket._s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket.name, "Key": key},
        ExpiresIn=3600,
    )


@pytest.mark.asyncio
async def test_concurrent_detection_creation_in_one_sequence(
    concurrent_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """Concurrent creation in one sequence must not duplicate or collide.

    Storage work now runs in a threadpool, so these genuinely overlap. The
    event loop used to serialize them, which meant the unique constraint and
    the S3 rollback path were never exercised under real concurrency.
    """
    source_url = _reachable_source_url(mock_img, "concurrent-source.jpg")
    payloads = [
        {
            "sequence_id": 1,
            "alert_api_id": 9000 + i,
            "recorded_at": (now - timedelta(days=2)).isoformat(),
            "algo_predictions": {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.9,
                        "class_name": "smoke",
                    }
                ]
            },
            "source_url": source_url,
        }
        for i in range(8)
    ]

    responses = await asyncio.gather(
        *[concurrent_client.post("/detections/from-url", json=p) for p in payloads]
    )

    failures = [(r.status_code, r.text) for r in responses if r.status_code != 201]
    assert not failures, failures
    assert len({r.json()["id"] for r in responses}) == 8, "duplicate rows created"
    assert (
        len({r.json()["bucket_key"] for r in responses}) == 8
    ), "detections collided on one bucket key"


@pytest.mark.asyncio
async def test_concurrent_duplicate_alert_api_id_admits_one(
    concurrent_client: AsyncClient, sequence_session: AsyncSession, mock_img: bytes
):
    """The unique constraint must hold when duplicates race, not only serialized.

    test_create_detection_duplicate_alert_api_id covers the sequential case;
    this is the same invariant once the requests actually overlap.
    """
    source_url = _reachable_source_url(mock_img, "concurrent-dup-source.jpg")
    payload = {
        "sequence_id": 1,
        "alert_api_id": 9500,
        "recorded_at": (now - timedelta(days=2)).isoformat(),
        "algo_predictions": {"predictions": []},
        "source_url": source_url,
    }

    responses = await asyncio.gather(
        *[
            concurrent_client.post("/detections/from-url", json=payload)
            for _ in range(4)
        ]
    )

    created = [r for r in responses if r.status_code == 201]
    assert len(created) == 1, (
        f"expected exactly one winner, got {len(created)}: "
        f"{[(r.status_code, r.text) for r in responses]}"
    )
