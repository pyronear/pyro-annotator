from datetime import datetime, timedelta, UTC
import io
import json

import pytest
from httpx import AsyncClient
from PIL import Image

from app import models
from app.services import storage as storage_module

now = datetime.now(UTC)


class DummyBucket:
    def __init__(self) -> None:
        self.public_urls = {}

    def get_public_url(self, key: str) -> str:
        url = f"https://example.com/{key}"
        self.public_urls[key] = url
        return url


@pytest.mark.asyncio
async def test_export_detections_empty_without_annotated_sequence(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    monkeypatch,
):
    """
    Default filter is sequence_processing_stage=annotated,
    so sequences without an annotated sequence annotation should not be exported.
    """
    # Monkeypatch S3 bucket lookup to avoid real S3 usage
    dummy_bucket = DummyBucket()

    def fake_get_bucket(_bucket_name: str) -> DummyBucket:
        return dummy_bucket

    monkeypatch.setattr(storage_module.s3_service, "get_bucket", fake_get_bucket)

    # Create a sequence without annotation
    seq_payload = {
        "source_api": "pyronear_french",
        "alert_api_id": "8000",
        "camera_name": "Export Test Camera",
        "camera_id": "800",
        "organisation_name": "Test Org No Annotation",
        "organisation_id": "80",
        "lat": "43.0",
        "lon": "1.0",
        "recorded_at": now.isoformat(),
        "last_seen_at": now.isoformat(),
    }
    seq_resp = await authenticated_client.post("/sequences", data=seq_payload)
    assert seq_resp.status_code == 201
    seq_id = seq_resp.json()["id"]

    # Create a detection for that sequence
    det_payload = {
        "sequence_id": str(seq_id),
        "alert_api_id": "8001",
        "recorded_at": now.isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "class_name": "smoke",
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "confidence": 0.9,
                    }
                ]
            }
        ),
    }

    img = Image.new("RGB", (64, 64), color="red")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_bytes.seek(0)
    files = {"file": ("test.jpg", img_bytes, "image/jpeg")}

    det_resp = await authenticated_client.post(
        "/detections", data=det_payload, files=files
    )
    assert det_resp.status_code == 201

    # No sequence annotation created, default sequence_processing_stage=annotated must exclude this sequence
    resp = await authenticated_client.get("/export/detections")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert data == []


@pytest.mark.asyncio
async def test_export_detections_basic_row_and_image_url(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    monkeypatch,
):
    """
    When a sequence has an annotated sequence annotation,
    export_detections should return detection rows with image_url
    resolved through s3_service.get_bucket().get_public_url().
    """
    dummy_bucket = DummyBucket()

    def fake_get_bucket(_bucket_name: str) -> DummyBucket:
        return dummy_bucket

    monkeypatch.setattr(storage_module.s3_service, "get_bucket", fake_get_bucket)

    # Use existing sequence 1 from fixtures, create a detection on it
    det_payload = {
        "sequence_id": "1",
        "alert_api_id": "8101",
        "recorded_at": now.isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "class_name": "smoke",
                        "xyxyn": [0.1, 0.1, 0.3, 0.3],
                        "confidence": 0.95,
                    }
                ]
            }
        ),
    }

    img = Image.new("RGB", (64, 64), color="blue")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_bytes.seek(0)
    files = {"file": ("test.jpg", img_bytes, "image/jpeg")}

    det_resp = await authenticated_client.post(
        "/detections", data=det_payload, files=files
    )
    assert det_resp.status_code == 201
    detection = det_resp.json()
    detection_id = detection["id"]

    # Create a sequence annotation in annotated stage so export route sees it
    seq_ann_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "smoke_type": "wildfire",
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": detection_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": now.isoformat(),
    }
    seq_ann_resp = await authenticated_client.post(
        "/annotations/sequences/", json=seq_ann_payload
    )
    assert seq_ann_resp.status_code == 201

    # Call export endpoint
    resp = await authenticated_client.get("/export/detections")
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    assert len(rows) >= 1

    # Look for our detection id
    row = next(r for r in rows if r["detection_id"] == detection_id)

    # Basic structure
    for key in [
        "detection_id",
        "sequence_id",
        "alert_api_id",
        "source_api",
        "recorded_at",
        "created_at",
        "camera_name",
        "organisation_name",
        "lat",
        "lon",
        "bucket_key",
    ]:
        assert key in row

    # image_url must be non null and built through dummy bucket
    assert row["image_url"] is not None
    assert row["bucket_key"] in dummy_bucket.public_urls
    assert row["image_url"] == dummy_bucket.public_urls[row["bucket_key"]]

    # Sequence annotation metadata must be present
    assert row["sequence_has_smoke"] is True
    assert row["sequence_processing_stage"] == "annotated"
    assert row["sequence_annotation"] is not None
    assert row["sequence_annotation_created_at"] is not None


@pytest.mark.asyncio
async def test_export_detections_filters_by_organisation_and_source(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    monkeypatch,
):
    """
    Filters organisation_name and source_api should restrict results to matching sequences.
    """
    dummy_bucket = DummyBucket()

    def fake_get_bucket(_bucket_name: str) -> DummyBucket:
        return dummy_bucket

    monkeypatch.setattr(storage_module.s3_service, "get_bucket", fake_get_bucket)

    # Create two sequences with different organisation and source api
    seq_specs = [
        {
            "source_api": "pyronear_french",
            "alert_api_id": "8201",
            "camera_name": "Export Cam A",
            "camera_id": "821",
            "organisation_name": "Org A",
            "organisation_id": "821",
        },
        {
            "source_api": "alert_wildfire",
            "alert_api_id": "8202",
            "camera_name": "Export Cam B",
            "camera_id": "822",
            "organisation_name": "Org B",
            "organisation_id": "822",
        },
    ]

    seq_ids = []
    for spec in seq_specs:
        payload = {
            **spec,
            "lat": "43.0",
            "lon": "1.0",
            "recorded_at": (now - timedelta(minutes=5)).isoformat(),
            "last_seen_at": now.isoformat(),
        }
        resp = await authenticated_client.post("/sequences", data=payload)
        assert resp.status_code == 201
        seq_ids.append(resp.json()["id"])

    # Create one detection and annotation per sequence in annotated stage
    created = []
    for seq_id, spec in zip(seq_ids, seq_specs):
        det_payload = {
            "sequence_id": str(seq_id),
            "alert_api_id": f"83{seq_id}",
            "recorded_at": now.isoformat(),
            "algo_predictions": json.dumps(
                {
                    "predictions": [
                        {
                            "class_name": "smoke",
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                            "confidence": 0.9,
                        }
                    ]
                }
            ),
        }
        img = Image.new("RGB", (64, 64), color="green")
        img_bytes = io.BytesIO()
        img.save(img_bytes, format="JPEG")
        img_bytes.seek(0)
        files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
        det_resp = await authenticated_client.post(
            "/detections", data=det_payload, files=files
        )
        assert det_resp.status_code == 201
        det_id = det_resp.json()["id"]

        seq_ann_payload = {
            "sequence_id": seq_id,
            "has_missed_smoke": False,
            "annotation": {
                "sequences_bbox": [
                    {
                        "is_smoke": True,
                        "smoke_type": "wildfire",
                        "false_positive_types": [],
                        "bboxes": [
                            {"detection_id": det_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                        ],
                    }
                ]
            },
            "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
            "created_at": now.isoformat(),
        }
        ann_resp = await authenticated_client.post(
            "/annotations/sequences/", json=seq_ann_payload
        )
        assert ann_resp.status_code == 201
        created.append((seq_id, det_id, spec))

    # Filter for Org A and pyronear_french only
    resp = await authenticated_client.get(
        "/export/detections",
        params={
            "organisation_name": "Org A",
            "source_api": "pyronear_french",
        },
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) >= 1
    # All rows must match the filter
    for row in rows:
        assert row["organisation_name"] == "Org A"
        assert row["source_api"] == "pyronear_french"

    # Filtering on Org B and alert_wildfire returns only that one
    resp_b = await authenticated_client.get(
        "/export/detections",
        params={
            "organisation_name": "Org B",
            "source_api": "alert_wildfire",
        },
    )
    assert resp_b.status_code == 200
    rows_b = resp_b.json()
    assert len(rows_b) >= 1
    for row in rows_b:
        assert row["organisation_name"] == "Org B"
        assert row["source_api"] == "alert_wildfire"


@pytest.mark.asyncio
async def test_export_detections_filters_by_sequence_annotation_created_window(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    monkeypatch,
):
    """
    sequence_annotation_created_gte and sequence_annotation_created_lte
    should filter detections based on the underlying sequence annotation dates.
    """
    dummy_bucket = DummyBucket()

    def fake_get_bucket(_bucket_name: str) -> DummyBucket:
        return dummy_bucket

    monkeypatch.setattr(storage_module.s3_service, "get_bucket", fake_get_bucket)

    # Use sequence 1 from fixtures, create two detections to share same sequence
    base_time = now - timedelta(days=10)

    detection_ids = []
    created_times = [base_time, base_time + timedelta(days=5)]

    for idx, created_at in enumerate(created_times, start=1):
        det_payload = {
            "sequence_id": "1",
            "alert_api_id": f"840{idx}",
            "recorded_at": created_at.isoformat(),
            "algo_predictions": json.dumps(
                {
                    "predictions": [
                        {
                            "class_name": "smoke",
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                            "confidence": 0.9,
                        }
                    ]
                }
            ),
        }
        img = Image.new("RGB", (64, 64), color="yellow")
        img_bytes = io.BytesIO()
        img.save(img_bytes, format="JPEG")
        img_bytes.seek(0)
        files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
        det_resp = await authenticated_client.post(
            "/detections", data=det_payload, files=files
        )
        assert det_resp.status_code == 201
        detection_ids.append(det_resp.json()["id"])

    # One sequence annotation older, one newer, we overwrite since there is unique constraint
    # So instead we use created_at field itself as filter on a single annotation
    # Create annotation at a known created_at timestamp
    annotation_created_at = base_time + timedelta(days=3)

    seq_ann_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "smoke_type": "wildfire",
                    "false_positive_types": [],
                    "bboxes": [
                        {
                            "detection_id": detection_ids[0],
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        },
                        {
                            "detection_id": detection_ids[1],
                            "xyxyn": [0.3, 0.3, 0.4, 0.4],
                        },
                    ],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": annotation_created_at.isoformat(),
    }

    seq_ann_resp = await authenticated_client.post(
        "/annotations/sequences/", json=seq_ann_payload
    )
    assert seq_ann_resp.status_code == 201

    # Window that includes annotation_created_at should return both detections
    resp = await authenticated_client.get(
        "/export/detections",
        params={
            "sequence_annotation_created_gte": (
                annotation_created_at - timedelta(hours=1)
            ).isoformat(),
            "sequence_annotation_created_lte": (
                annotation_created_at + timedelta(hours=1)
            ).isoformat(),
        },
    )
    assert resp.status_code == 200
    rows = resp.json()
    ids = {row["detection_id"] for row in rows}
    assert detection_ids[0] in ids
    assert detection_ids[1] in ids

    # Window that is strictly before annotation_created_at should return no rows
    resp_before = await authenticated_client.get(
        "/export/detections",
        params={
            "sequence_annotation_created_gte": (
                annotation_created_at - timedelta(days=5)
            ).isoformat(),
            "sequence_annotation_created_lte": (
                annotation_created_at - timedelta(days=1)
            ).isoformat(),
        },
    )
    assert resp_before.status_code == 200
    assert resp_before.json() == []


@pytest.mark.asyncio
async def test_export_detections_ordering_and_limit(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    monkeypatch,
):
    """
    order_by and order_desc, combined with limit,
    should control which detections are returned and in which order.
    """
    dummy_bucket = DummyBucket()

    def fake_get_bucket(_bucket_name: str) -> DummyBucket:
        return dummy_bucket

    monkeypatch.setattr(storage_module.s3_service, "get_bucket", fake_get_bucket)

    # Create a sequence annotation for sequence 1 so exports are allowed
    seq_ann_payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "smoke_type": "wildfire",
                    "false_positive_types": [],
                    "bboxes": [],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
        "created_at": now.isoformat(),
    }
    seq_ann_resp = await authenticated_client.post(
        "/annotations/sequences/", json=seq_ann_payload
    )
    assert seq_ann_resp.status_code == 201

    # Create three detections with distinct recorded_at timestamps
    detection_ids = []
    recorded_times = [
        now - timedelta(minutes=30),
        now - timedelta(minutes=20),
        now - timedelta(minutes=10),
    ]

    for idx, rec in enumerate(recorded_times, start=1):
        det_payload = {
            "sequence_id": "1",
            "alert_api_id": f"850{idx}",
            "recorded_at": rec.isoformat(),
            "algo_predictions": json.dumps(
                {
                    "predictions": [
                        {
                            "class_name": "smoke",
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                            "confidence": 0.8,
                        }
                    ]
                }
            ),
        }
        img = Image.new("RGB", (64, 64), color="pink")
        img_bytes = io.BytesIO()
        img.save(img_bytes, format="JPEG")
        img_bytes.seek(0)
        files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
        det_resp = await authenticated_client.post(
            "/detections", data=det_payload, files=files
        )
        assert det_resp.status_code == 201
        detection_ids.append(det_resp.json()["id"])

    # Export with order_by=recorded_at, desc, limit=2
    resp = await authenticated_client.get(
        "/export/detections",
        params={
            "order_by": "recorded_at",
            "order_desc": "true",
            "limit": 2,
        },
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2

    # Recorded_at must be descending
    rec0 = datetime.fromisoformat(rows[0]["recorded_at"])
    rec1 = datetime.fromisoformat(rows[1]["recorded_at"])
    assert rec0 >= rec1

    # When ordering ascending, first row should be oldest
    resp_asc = await authenticated_client.get(
        "/export/detections",
        params={
            "order_by": "recorded_at",
            "order_desc": "false",
            "limit": 1,
        },
    )
    assert resp_asc.status_code == 200
    rows_asc = resp_asc.json()
    assert len(rows_asc) == 1
    oldest_rec = min(recorded_times)
    assert datetime.fromisoformat(rows_asc[0]["recorded_at"]) == oldest_rec


@pytest.mark.asyncio
async def test_export_detections_filters_by_false_positive_and_smoke_types(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    monkeypatch,
):
    """
    false_positive_types and smoke_types filters should use OR logic on sequence level
    and restrict exported detections accordingly.
    """
    dummy_bucket = DummyBucket()

    def fake_get_bucket(_bucket_name: str) -> DummyBucket:
        return dummy_bucket

    monkeypatch.setattr(storage_module.s3_service, "get_bucket", fake_get_bucket)

    # Create three sequences for different type configurations
    seq_payloads = [
        {
            "source_api": "pyronear_french",
            "alert_api_id": "8601",
            "camera_name": "FP Smoke Cam 1",
            "camera_id": "861",
            "organisation_name": "Org Types",
            "organisation_id": "861",
        },
        {
            "source_api": "pyronear_french",
            "alert_api_id": "8602",
            "camera_name": "FP Smoke Cam 2",
            "camera_id": "862",
            "organisation_name": "Org Types",
            "organisation_id": "861",
        },
        {
            "source_api": "pyronear_french",
            "alert_api_id": "8603",
            "camera_name": "FP Smoke Cam 3",
            "camera_id": "863",
            "organisation_name": "Org Types",
            "organisation_id": "861",
        },
    ]

    seq_ids = []
    for payload in seq_payloads:
        data = {
            **payload,
            "lat": "43.0",
            "lon": "1.0",
            "recorded_at": now.isoformat(),
            "last_seen_at": now.isoformat(),
        }
        resp = await authenticated_client.post("/sequences", data=data)
        assert resp.status_code == 201
        seq_ids.append(resp.json()["id"])

    # Create detections for each sequence
    det_ids = []
    for idx, seq_id in enumerate(seq_ids, start=1):
        det_payload = {
            "sequence_id": str(seq_id),
            "alert_api_id": f"869{idx}",
            "recorded_at": now.isoformat(),
            "algo_predictions": json.dumps(
                {
                    "predictions": [
                        {
                            "class_name": "smoke",
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                            "confidence": 0.9,
                        }
                    ]
                }
            ),
        }
        img = Image.new("RGB", (64, 64), color="cyan")
        img_bytes = io.BytesIO()
        img.save(img_bytes, format="JPEG")
        img_bytes.seek(0)
        files = {"file": ("test.jpg", img_bytes, "image/jpeg")}
        det_resp = await authenticated_client.post(
            "/detections", data=det_payload, files=files
        )
        assert det_resp.status_code == 201
        det_ids.append(det_resp.json()["id"])

    # Create sequence annotations with different smoke and false positive types
    annotations = [
        {
            "sequence_id": seq_ids[0],
            "annotation": {
                "sequences_bbox": [
                    {
                        "is_smoke": False,
                        "false_positive_types": ["antenna", "building"],
                        "bboxes": [
                            {"detection_id": det_ids[0], "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                        ],
                    }
                ]
            },
        },
        {
            "sequence_id": seq_ids[1],
            "annotation": {
                "sequences_bbox": [
                    {
                        "is_smoke": True,
                        "smoke_type": "wildfire",
                        "false_positive_types": [],
                        "bboxes": [
                            {"detection_id": det_ids[1], "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                        ],
                    }
                ]
            },
        },
        {
            "sequence_id": seq_ids[2],
            "annotation": {
                "sequences_bbox": [
                    {
                        "is_smoke": True,
                        "smoke_type": "industrial",
                        "false_positive_types": ["high_cloud"],
                        "bboxes": [
                            {"detection_id": det_ids[2], "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                        ],
                    }
                ]
            },
        },
    ]

    for ann in annotations:
        payload = {
            "sequence_id": ann["sequence_id"],
            "has_missed_smoke": False,
            "annotation": ann["annotation"],
            "processing_stage": models.SequenceAnnotationProcessingStage.ANNOTATED.value,
            "created_at": now.isoformat(),
        }
        resp = await authenticated_client.post(
            "/annotations/sequences/", json=payload
        )
        assert resp.status_code == 201

    # Filter by false_positive_types=antenna, should match only first sequence
    resp_fp = await authenticated_client.get(
        "/export/detections",
        params={"false_positive_types": models.FalsePositiveType.ANTENNA.value},
    )
    assert resp_fp.status_code == 200
    rows_fp = resp_fp.json()
    assert len(rows_fp) >= 1
    seq_ids_fp = {row["sequence_id"] for row in rows_fp}
    assert seq_ids[0] in seq_ids_fp
    assert seq_ids[1] not in seq_ids_fp
    assert seq_ids[2] not in seq_ids_fp

    # Filter by smoke_types=wildfire, should match second sequence
    resp_smoke = await authenticated_client.get(
        "/export/detections",
        params={"smoke_types": models.SmokeType.WILDFIRE.value},
    )
    assert resp_smoke.status_code == 200
    rows_smoke = resp_smoke.json()
    seq_ids_smoke = {row["sequence_id"] for row in rows_smoke}
    assert seq_ids[1] in seq_ids_smoke
    assert seq_ids[0] not in seq_ids_smoke

    # Filter by smoke_types=industrial and false_positive_types=high_cloud,
    # should match third sequence
    resp_mixed = await authenticated_client.get(
        "/export/detections",
        params={
            "smoke_types": models.SmokeType.INDUSTRIAL.value,
            "false_positive_types": models.FalsePositiveType.HIGH_CLOUD.value,
        },
    )
    assert resp_mixed.status_code == 200
    rows_mixed = resp_mixed.json()
    seq_ids_mixed = {row["sequence_id"] for row in rows_mixed}
    assert seq_ids[2] in seq_ids_mixed
