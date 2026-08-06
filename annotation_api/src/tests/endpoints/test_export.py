import hashlib
import io
import json
from datetime import UTC, datetime, timedelta
from typing import Dict, List, Optional
from typing import Sequence as Seq

import pytest
from httpx import AsyncClient
from PIL import Image

from app.services import storage as storage_module

now = datetime.now(UTC)


class DummyBucket:
    """In-memory stand-in for S3Bucket: upload + presign, no network."""

    def __init__(self) -> None:
        self._files: Dict[str, bytes] = {}

    def upload_file(self, key: str, file_obj) -> bool:
        pos = file_obj.tell()
        data = file_obj.read()
        file_obj.seek(pos)
        self._files[key] = data
        return True

    def get_file_metadata(self, key: str) -> dict:
        md5_hash = hashlib.md5(self._files[key]).hexdigest()  # noqa: S324
        return {"ETag": f'"{md5_hash}"'}

    def get_public_url(self, key: str) -> str:
        return f"https://dummy-bucket.local/{key}"

    def generate_presigned_url(self, key: str, url_expiration: int = 3600) -> str:
        return f"https://dummy-bucket.local/{key}"


@pytest.fixture
def dummy_bucket(monkeypatch) -> DummyBucket:
    bucket = DummyBucket()
    monkeypatch.setattr(storage_module.s3_service, "get_bucket", lambda _name: bucket)
    return bucket


async def create_lane(
    client: AsyncClient,
    *,
    platform_alert_id: int,
    alert_api_id: int,
    source_api: str = "pyronear_french",
    camera_name: str = "Export Cam",
    camera_id: int = 700,
    organisation_name: str = "Export Org",
    organisation_id: int = 70,
    recorded_at: Optional[datetime] = None,
) -> int:
    """Create one sequence (lane) of an alert, returns sequence id."""
    payload = {
        "source_api": source_api,
        "alert_api_id": str(alert_api_id),
        "platform_alert_id": str(platform_alert_id),
        "camera_name": camera_name,
        "camera_id": str(camera_id),
        "organisation_name": organisation_name,
        "organisation_id": str(organisation_id),
        "lat": "43.0",
        "lon": "1.0",
        "recorded_at": (recorded_at or now).isoformat(),
        "last_seen_at": (recorded_at or now).isoformat(),
    }
    resp = await client.post("/sequences", data=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def create_frame(
    client: AsyncClient,
    *,
    sequence_id: int,
    alert_api_id: int,
    recorded_at: Optional[datetime] = None,
) -> int:
    """Create one detection (frame) in a lane, returns detection id."""
    det_payload = {
        "sequence_id": str(sequence_id),
        "alert_api_id": str(alert_api_id),
        "recorded_at": (recorded_at or now).isoformat(),
        "algo_predictions": json.dumps({"predictions": []}),
    }
    img = Image.new("RGB", (64, 64), color="red")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    resp = await client.post(
        "/detections", data=det_payload, files={"file": ("t.jpg", buf, "image/jpeg")}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def annotate_lane(
    client: AsyncClient,
    *,
    sequence_id: int,
    detection_ids: Seq[int],
    is_smoke: bool,
    smoke_type: Optional[str] = None,
    false_positive_types: Seq[str] = (),
    is_unsure: bool = False,
    stage: str = "annotated",
) -> None:
    """Create the lane's sequence annotation with one tracked object."""
    track: dict = {
        "is_smoke": is_smoke,
        "false_positive_types": list(false_positive_types),
        "bboxes": [
            {"detection_id": det_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
            for det_id in detection_ids
        ],
    }
    if smoke_type is not None:
        track["smoke_type"] = smoke_type
    payload = {
        "sequence_id": sequence_id,
        "has_missed_smoke": False,
        "is_unsure": is_unsure,
        "annotation": {"sequences_bbox": [track]},
        "processing_stage": stage,
    }
    resp = await client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201, resp.text


async def annotate_frame(
    client: AsyncClient,
    *,
    detection_id: int,
    items: List[dict],
    stage: str = "annotated",
) -> int:
    """Fill the frame's detection annotation, returns annotation id.

    Creating the lane's sequence annotation fans out an empty detection
    annotation per frame, so this PATCHes the existing row — same shape the
    localize flow produces.
    """
    list_resp = await client.get(
        "/annotations/detections/", params={"detection_id": detection_id}
    )
    assert list_resp.status_code == 200, list_resp.text
    existing = list_resp.json()["items"]
    assert existing, f"no auto-created detection annotation for {detection_id}"
    ann_id = existing[0]["id"]
    resp = await client.patch(
        f"/annotations/detections/{ann_id}",
        json={"annotation": {"annotation": items}, "processing_stage": stage},
    )
    assert resp.status_code == 200, resp.text
    return ann_id


@pytest.mark.asyncio
async def test_export_alerts_empty(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
):
    resp = await authenticated_client.get("/export/alerts")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["next_cursor"] is None


@pytest.mark.asyncio
async def test_export_alerts_smoke_lane_shape(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
):
    """One finished smoke alert exports with full nested shape: metadata,
    frames in recorded_at order, boxes from the detection annotation
    (including an FP-flagged distractor), and a gap frame with no boxes."""
    seq_id = await create_lane(
        authenticated_client, platform_alert_id=7001, alert_api_id=7001
    )
    det_1 = await create_frame(
        authenticated_client,
        sequence_id=seq_id,
        alert_api_id=1,
        recorded_at=now - timedelta(minutes=2),
    )
    det_2 = await create_frame(
        authenticated_client, sequence_id=seq_id, alert_api_id=2, recorded_at=now
    )
    await annotate_lane(
        authenticated_client,
        sequence_id=seq_id,
        detection_ids=[det_1, det_2],
        is_smoke=True,
        smoke_type="wildfire",
    )
    # Frame 1: one human smoke box + one auto FP distractor. Frame 2: gap.
    await annotate_frame(
        authenticated_client,
        detection_id=det_1,
        items=[
            {
                "xyxyn": [0.4, 0.3, 0.5, 0.4],
                "class_name": "smoke",
                "smoke_type": "wildfire",
                "origin": "human",
            },
            {
                "xyxyn": [0.6, 0.5, 0.65, 0.58],
                "class_name": "antenna",
                "false_positive_type": "antenna",
                "origin": "auto",
            },
        ],
    )

    resp = await authenticated_client.get("/export/alerts")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["next_cursor"] is None

    alert = body["items"][0]
    assert alert["source_api"] == "pyronear_french"
    assert alert["platform_alert_id"] == 7001
    assert alert["camera_id"] == 700
    assert alert["camera_name"] == "Export Cam"
    assert alert["organisation_id"] == 70
    assert alert["organisation_name"] == "Export Org"
    assert alert["lat"] == 43.0
    assert alert["lon"] == 1.0
    assert alert["last_annotated_at"] is not None
    assert alert["recorded_at"] is not None

    assert len(alert["objects"]) == 1
    obj = alert["objects"][0]
    assert obj["sequence_id"] == seq_id
    assert obj["record_kind"] == "smoke"
    assert obj["smoke_types"] == ["wildfire"]
    assert obj["false_positive_types"] == []

    frames = obj["frames"]
    assert [f["detection_id"] for f in frames] == [det_1, det_2]
    for frame in frames:
        assert frame["bucket_key"]
        assert frame["image_url"] == f"https://dummy-bucket.local/{frame['bucket_key']}"

    boxes = frames[0]["boxes"]
    assert len(boxes) == 2
    smoke_box = next(b for b in boxes if b["smoke_type"] == "wildfire")
    assert smoke_box["xyxyn"] == [0.4, 0.3, 0.5, 0.4]
    assert smoke_box["false_positive_types"] is None
    assert smoke_box["origin"] == "human"
    fp_box = next(b for b in boxes if b["smoke_type"] is None)
    assert fp_box["false_positive_types"] == ["antenna"]
    assert fp_box["origin"] == "auto"

    # Gap frame: exported, no boxes
    assert frames[1]["boxes"] == []
