import hashlib
import io
import json
from datetime import UTC, datetime, timedelta
from typing import Dict, List, Optional
from typing import Sequence as Seq

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import update

from app import models
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


@pytest.mark.asyncio
async def test_export_alerts_fp_lane_boxes_from_track(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
):
    """FP lane: boxes come from the sequence-annotation track, carry the
    lane's whole FP-type list, origin engine."""
    seq_id = await create_lane(
        authenticated_client, platform_alert_id=7101, alert_api_id=7101
    )
    det_1 = await create_frame(authenticated_client, sequence_id=seq_id, alert_api_id=1)
    det_2 = await create_frame(authenticated_client, sequence_id=seq_id, alert_api_id=2)
    # Track covers only det_1; det_2 is a gap frame.
    await annotate_lane(
        authenticated_client,
        sequence_id=seq_id,
        detection_ids=[det_1],
        is_smoke=False,
        false_positive_types=["high_cloud", "lens_flare"],
    )

    resp = await authenticated_client.get("/export/alerts")
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert len(items) == 1
    obj = items[0]["objects"][0]
    assert obj["record_kind"] == "false_positive"
    assert obj["smoke_types"] == []
    assert sorted(obj["false_positive_types"]) == ["high_cloud", "lens_flare"]

    frames = {f["detection_id"]: f for f in obj["frames"]}
    assert set(frames) == {det_1, det_2}
    boxes = frames[det_1]["boxes"]
    assert len(boxes) == 1
    assert boxes[0]["xyxyn"] == [0.1, 0.1, 0.2, 0.2]
    assert boxes[0]["smoke_type"] is None
    assert sorted(boxes[0]["false_positive_types"]) == ["high_cloud", "lens_flare"]
    assert boxes[0]["origin"] == "engine"
    assert frames[det_2]["boxes"] == []


@pytest.mark.asyncio
async def test_export_alerts_sibling_lanes_share_bucket_key(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
    async_session,
):
    """One alert, two lanes (smoke + FP). Sibling frames point at the same
    image: same bucket_key, distinct detection_ids."""
    smoke_seq = await create_lane(
        authenticated_client, platform_alert_id=7201, alert_api_id=7201
    )
    fp_seq = await create_lane(
        authenticated_client, platform_alert_id=7201, alert_api_id=1000007201001
    )
    smoke_det = await create_frame(
        authenticated_client, sequence_id=smoke_seq, alert_api_id=1
    )
    fp_det = await create_frame(
        authenticated_client, sequence_id=fp_seq, alert_api_id=1
    )

    # The importer points sibling detections at the same S3 object; tests
    # can't reach the platform-bucket copy path, so align bucket_key directly.
    smoke_resp = await authenticated_client.get(f"/detections/{smoke_det}")
    shared_key = smoke_resp.json()["bucket_key"]
    await async_session.execute(
        update(models.Detection)
        .where(models.Detection.id == fp_det)
        .values(bucket_key=shared_key)
    )
    await async_session.commit()

    await annotate_lane(
        authenticated_client,
        sequence_id=smoke_seq,
        detection_ids=[smoke_det],
        is_smoke=True,
        smoke_type="wildfire",
    )
    await annotate_frame(
        authenticated_client,
        detection_id=smoke_det,
        items=[
            {
                "xyxyn": [0.4, 0.3, 0.5, 0.4],
                "class_name": "smoke",
                "smoke_type": "wildfire",
                "origin": "human",
            }
        ],
    )
    await annotate_lane(
        authenticated_client,
        sequence_id=fp_seq,
        detection_ids=[fp_det],
        is_smoke=False,
        false_positive_types=["antenna"],
    )

    resp = await authenticated_client.get("/export/alerts")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    alert = items[0]
    assert len(alert["objects"]) == 2
    kinds = {o["record_kind"] for o in alert["objects"]}
    assert kinds == {"smoke", "false_positive"}

    frame_keys = {
        o["record_kind"]: o["frames"][0]["bucket_key"] for o in alert["objects"]
    }
    assert frame_keys["smoke"] == frame_keys["false_positive"] == shared_key
    frame_ids = {
        o["record_kind"]: o["frames"][0]["detection_id"] for o in alert["objects"]
    }
    assert frame_ids["smoke"] != frame_ids["false_positive"]


@pytest.mark.asyncio
async def test_export_alerts_excludes_unfinished_alerts(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
):
    """An alert exports only once EVERY lane reaches stage annotated."""
    done_seq = await create_lane(
        authenticated_client, platform_alert_id=7301, alert_api_id=7301
    )
    pending_seq = await create_lane(
        authenticated_client, platform_alert_id=7301, alert_api_id=1000007301001
    )
    done_det = await create_frame(
        authenticated_client, sequence_id=done_seq, alert_api_id=1
    )
    pending_det = await create_frame(
        authenticated_client, sequence_id=pending_seq, alert_api_id=1
    )
    await annotate_lane(
        authenticated_client,
        sequence_id=done_seq,
        detection_ids=[done_det],
        is_smoke=False,
        false_positive_types=["antenna"],
    )
    await annotate_lane(
        authenticated_client,
        sequence_id=pending_seq,
        detection_ids=[pending_det],
        is_smoke=True,
        smoke_type="wildfire",
        stage="seq_annotation_done",
    )

    resp = await authenticated_client.get("/export/alerts")
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_export_alerts_excludes_annotationless_lanes(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
):
    """A lane with no sequence annotation at all blocks its alert."""
    annotated_seq = await create_lane(
        authenticated_client, platform_alert_id=7302, alert_api_id=7302
    )
    await create_lane(
        authenticated_client, platform_alert_id=7302, alert_api_id=1000007302001
    )
    det = await create_frame(
        authenticated_client, sequence_id=annotated_seq, alert_api_id=1
    )
    await annotate_lane(
        authenticated_client,
        sequence_id=annotated_seq,
        detection_ids=[det],
        is_smoke=False,
        false_positive_types=["antenna"],
    )

    resp = await authenticated_client.get("/export/alerts")
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_export_alerts_omits_unsure_lanes(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
):
    """Unsure lanes are silently omitted; an all-unsure alert disappears."""
    # Alert A: one sure FP lane + one unsure lane -> exports with 1 object
    sure_seq = await create_lane(
        authenticated_client, platform_alert_id=7303, alert_api_id=7303
    )
    unsure_seq = await create_lane(
        authenticated_client, platform_alert_id=7303, alert_api_id=1000007303001
    )
    sure_det = await create_frame(
        authenticated_client, sequence_id=sure_seq, alert_api_id=1
    )
    unsure_det = await create_frame(
        authenticated_client, sequence_id=unsure_seq, alert_api_id=1
    )
    await annotate_lane(
        authenticated_client,
        sequence_id=sure_seq,
        detection_ids=[sure_det],
        is_smoke=False,
        false_positive_types=["antenna"],
    )
    await annotate_lane(
        authenticated_client,
        sequence_id=unsure_seq,
        detection_ids=[unsure_det],
        is_smoke=True,
        smoke_type="wildfire",
        is_unsure=True,
    )

    # Alert B: only an unsure lane -> absent entirely
    only_unsure_seq = await create_lane(
        authenticated_client, platform_alert_id=7304, alert_api_id=7304
    )
    only_unsure_det = await create_frame(
        authenticated_client, sequence_id=only_unsure_seq, alert_api_id=1
    )
    await annotate_lane(
        authenticated_client,
        sequence_id=only_unsure_seq,
        detection_ids=[only_unsure_det],
        is_smoke=True,
        smoke_type="wildfire",
        is_unsure=True,
    )

    resp = await authenticated_client.get("/export/alerts")
    items = resp.json()["items"]
    assert [i["platform_alert_id"] for i in items] == [7303]
    assert [o["sequence_id"] for o in items[0]["objects"]] == [sure_seq]


async def seed_minimal_fp_alert(client: AsyncClient, *, platform_alert_id: int) -> int:
    """Smallest finished alert: one FP lane, one frame. Returns sequence id."""
    seq_id = await create_lane(
        client, platform_alert_id=platform_alert_id, alert_api_id=platform_alert_id
    )
    det_id = await create_frame(client, sequence_id=seq_id, alert_api_id=1)
    await annotate_lane(
        client,
        sequence_id=seq_id,
        detection_ids=[det_id],
        is_smoke=False,
        false_positive_types=["antenna"],
    )
    return seq_id


@pytest.mark.asyncio
async def test_export_alerts_cursor_pagination(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
):
    for pid in (7401, 7402, 7403):
        await seed_minimal_fp_alert(authenticated_client, platform_alert_id=pid)

    # Page 1
    r1 = await authenticated_client.get("/export/alerts", params={"limit": 2})
    assert r1.status_code == 200
    body1 = r1.json()
    assert [i["platform_alert_id"] for i in body1["items"]] == [7401, 7402]
    assert body1["next_cursor"] == "pyronear_french:7402"

    # Idempotency: same request, same page
    r1b = await authenticated_client.get("/export/alerts", params={"limit": 2})
    assert [i["platform_alert_id"] for i in r1b.json()["items"]] == [7401, 7402]

    # Page 2: strictly after the cursor, short page -> null cursor
    r2 = await authenticated_client.get(
        "/export/alerts", params={"limit": 2, "cursor": body1["next_cursor"]}
    )
    body2 = r2.json()
    assert [i["platform_alert_id"] for i in body2["items"]] == [7403]
    assert body2["next_cursor"] is None


@pytest.mark.asyncio
async def test_export_alerts_full_last_page_then_empty(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
):
    """A page that is exactly `limit` long returns a cursor; the follow-up
    page is empty with a null cursor."""
    for pid in (7411, 7412):
        await seed_minimal_fp_alert(authenticated_client, platform_alert_id=pid)

    r1 = await authenticated_client.get("/export/alerts", params={"limit": 2})
    body1 = r1.json()
    assert len(body1["items"]) == 2
    assert body1["next_cursor"] == "pyronear_french:7412"

    r2 = await authenticated_client.get(
        "/export/alerts", params={"limit": 2, "cursor": body1["next_cursor"]}
    )
    body2 = r2.json()
    assert body2["items"] == []
    assert body2["next_cursor"] is None


@pytest.mark.asyncio
async def test_export_alerts_malformed_cursor_422(
    authenticated_client: AsyncClient,
    sequence_session,
    detection_session,
    dummy_bucket,
):
    for bad in ("nonsense", "pyronear_french", "pyronear_french:abc", "mars_api:12"):
        resp = await authenticated_client.get("/export/alerts", params={"cursor": bad})
        assert resp.status_code == 422, bad
