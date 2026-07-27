"""End-to-end test of the TP review pipeline against the dev API stack.

Seeds fake sequences covering the label-corruption scenarios (#139/#140/#141),
then runs the real pipeline stages in order:

    seed -> pull_sequence_annotations (real, in-process)
         -> auto_annotate.process_sequence (fake model, no ONNX download)
         -> apply_fiftyone_review.process_one_group (real, FiftyOne bypassed)

and asserts the label files, the stage transitions and the detection
annotations pushed back to the API.

Only runs inside the docker test stack (`make test`) where the API is served
on localhost:5050; skipped elsewhere.
"""

import io
import json
import sys
import time
from datetime import datetime, timedelta, UTC

import numpy as np
import pytest
import requests
from PIL import Image

API = "http://localhost:5050"
LOGIN = {"username": "admin", "password": "admin12345"}

# Prediction boxes shared by seeding and the fake model
P_LEFT = [0.10, 0.10, 0.20, 0.20]
P_RIGHT = [0.60, 0.60, 0.70, 0.70]

now = datetime.now(UTC)


def _api_up() -> bool:
    try:
        return requests.get(f"{API}/status", timeout=2).status_code == 200
    except requests.RequestException:
        return False


pytestmark = pytest.mark.skipif(
    not _api_up(), reason="requires the dev API stack (run via make test)"
)


def _token() -> str:
    """Authenticate against the live API.

    Retried because the DB-reset fixture invalidates the running server's
    asyncpg prepared-statement cache: the first request after a schema reset
    can 500 once (InvalidCachedStatementError) before SQLAlchemy clears the
    cache and everything recovers.
    """
    response = None
    for _ in range(10):
        response = requests.post(f"{API}/api/v1/auth/login", json=LOGIN, timeout=10)
        if response.status_code == 200:
            return response.json()["access_token"]
        time.sleep(0.3)
    raise AssertionError(f"login kept failing: {response.status_code} {response.text}")


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _post_with_retry(url: str, *, prepare: dict | None = None, **kwargs):
    """POST with one retry on the transient InvalidCachedStatementError 500
    (see _token docstring); the failed statement is rolled back server-side,
    so retrying cannot double-insert. ``prepare`` maps file-like kwargs to
    reset before each attempt."""
    for attempt in range(2):
        for stream in (prepare or {}).values():
            stream.seek(0)
        response = requests.post(url, timeout=10, **kwargs)
        if (
            response.status_code < 500
            or "InvalidCachedStatementError" not in response.text
        ):
            return response
    return response


def _create_sequence(token: str, alert_api_id: int, camera_id: int) -> int:
    response = _post_with_retry(
        f"{API}/api/v1/sequences/",
        headers=_headers(token),
        data={
            "source_api": "pyronear_french",
            "alert_api_id": str(alert_api_id),
            "camera_name": f"e2e_cam_{camera_id}",
            "camera_id": str(camera_id),
            "organisation_name": "e2e_org",
            "organisation_id": "1",
            "lat": "0.0",
            "lon": "0.0",
            "recorded_at": (now - timedelta(hours=1)).isoformat(),
            "last_seen_at": now.isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_detection(
    token: str,
    sequence_id: int,
    alert_api_id: int,
    minutes_ago: int,
    predictions: list,
) -> int:
    img = Image.new("RGB", (64, 64), color="gray")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_bytes.seek(0)
    response = _post_with_retry(
        f"{API}/api/v1/detections/",
        prepare={"image": img_bytes},
        headers=_headers(token),
        data={
            "sequence_id": str(sequence_id),
            "alert_api_id": str(alert_api_id),
            "recorded_at": (now - timedelta(minutes=minutes_ago)).isoformat(),
            "algo_predictions": json.dumps(
                {
                    "predictions": [
                        {"xyxyn": box, "confidence": 0.9, "class_name": "smoke"}
                        for box in predictions
                    ]
                }
            ),
        },
        files={"file": ("e2e.jpg", img_bytes, "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_seq_annotation(
    token: str, sequence_id: int, sequences_bbox: list, is_unsure: bool = False
) -> int:
    response = _post_with_retry(
        f"{API}/api/v1/annotations/sequences/",
        headers=_headers(token),
        json={
            "sequence_id": sequence_id,
            "has_missed_smoke": False,
            "is_unsure": is_unsure,
            "annotation": {"sequences_bbox": sequences_bbox},
            "processing_stage": "seq_annotation_done",
            "created_at": now.isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _get_seq_annotation(token: str, sequence_id: int) -> dict:
    response = requests.get(
        f"{API}/api/v1/annotations/sequences/",
        headers=_headers(token),
        params={"sequence_id": sequence_id},
        timeout=10,
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert items, f"no sequence annotation for sequence {sequence_id}"
    return items[0]


def _get_detection_annotations(token: str, sequence_id: int) -> list:
    response = requests.get(
        f"{API}/api/v1/annotations/detections/",
        headers=_headers(token),
        params={"sequence_id": sequence_id},
        timeout=10,
    )
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _run_pull(output_dir, monkeypatch) -> None:
    """Run the real pull script in-process; presigned S3 URLs point at the
    host-oriented proxy (localhost:4566), so rewrite them to the in-network
    localstack host before downloading."""
    from scripts.data_transfer.ingestion.alert_api import (
        pull_sequence_annotations as pull,
    )

    real_get = requests.get

    def _rewriting_get(url, **kwargs):
        return real_get(url.replace("localhost:4566", "localstack:4566"), **kwargs)

    monkeypatch.setattr(pull.requests, "get", _rewriting_get)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "pull_sequence_annotations",
            "--remote-api",
            API,
            "--output-dir",
            str(output_dir),
            "--loglevel",
            "warning",
        ],
    )
    pull.main()


class _FakeModel:
    """Deterministic stand-in for the YOLO11s classifier: one prediction near
    each seeded object box plus a stray box overlapping nothing."""

    def __call__(self, pil_img) -> np.ndarray:
        return np.array(
            [
                [0.11, 0.11, 0.19, 0.19, 0.90],  # overlaps P_LEFT
                [0.61, 0.61, 0.69, 0.69, 0.80],  # overlaps P_RIGHT
                [0.40, 0.85, 0.45, 0.90, 0.70],  # stray, overlaps nothing
            ]
        )


def _smoke_object(smoke_type: str, boxes_by_detection: dict) -> dict:
    return {
        "is_smoke": True,
        "smoke_type": smoke_type,
        "false_positive_types": [],
        "bboxes": [
            {"detection_id": det_id, "xyxyn": box}
            for det_id, box in boxes_by_detection.items()
        ],
    }


def _fp_object(fp_types: list, boxes_by_detection: dict) -> dict:
    return {
        "is_smoke": False,
        "false_positive_types": fp_types,
        "bboxes": [
            {"detection_id": det_id, "xyxyn": box}
            for det_id, box in boxes_by_detection.items()
        ],
    }


def _read_labels(seq_dir, detection_id: int) -> list:
    """Return [(class_id, [cx, cy, w, h]), ...] for one frame's label file."""
    label_path = seq_dir / "labels" / f"detection_{detection_id}.txt"
    assert label_path.exists(), f"missing label file {label_path}"
    rows = []
    for raw in label_path.read_text().splitlines():
        parts = raw.split()
        rows.append((int(parts[0]), [float(v) for v in parts[1:5]]))
    return rows


async def test_pipeline_end_to_end(tmp_path, monkeypatch, test_user):
    from scripts.data_transfer.ingestion.alert_api.apply_fiftyone_review import (
        load_manifest,
        process_one_group,
    )
    from scripts.data_transfer.ingestion.alert_api.auto_annotate import (
        process_sequence,
    )
    from scripts.data_transfer.ingestion.alert_api.label_classes import CLASS_ID

    token = _token()

    # --- Seed: 4 fake sequences covering the corruption scenarios ------------
    # 1. collision: wildfire + industrial objects on the SAME frames (#140/#139)
    seq_collision = _create_sequence(token, alert_api_id=501, camera_id=501)
    collision_dets = [
        _create_detection(token, seq_collision, 50100 + i, 50 - i, [P_LEFT, P_RIGHT])
        for i in range(2)
    ]
    _create_seq_annotation(
        token,
        seq_collision,
        [
            _smoke_object("wildfire", {d: P_LEFT for d in collision_dets}),
            _smoke_object("industrial", {d: P_RIGHT for d in collision_dets}),
        ],
    )

    # 2. mixed: wildfire + FP antenna on the same frame (#141)
    seq_mixed = _create_sequence(token, alert_api_id=502, camera_id=502)
    mixed_det = _create_detection(token, seq_mixed, 50200, 40, [P_LEFT, P_RIGHT])
    _create_seq_annotation(
        token,
        seq_mixed,
        [
            _smoke_object("wildfire", {mixed_det: P_LEFT}),
            _fp_object(["antenna"], {mixed_det: P_RIGHT}),
        ],
    )

    # 3. FP with multiple types -> one label line per type
    seq_fp = _create_sequence(token, alert_api_id=503, camera_id=503)
    fp_det = _create_detection(token, seq_fp, 50300, 30, [P_LEFT])
    _create_seq_annotation(
        token, seq_fp, [_fp_object(["antenna", "road"], {fp_det: P_LEFT})]
    )

    # 4. unsure -> must never be pulled
    seq_unsure = _create_sequence(token, alert_api_id=504, camera_id=504)
    unsure_det = _create_detection(token, seq_unsure, 50400, 20, [P_LEFT])
    _create_seq_annotation(
        token,
        seq_unsure,
        [_smoke_object("wildfire", {unsure_det: P_LEFT})],
        is_unsure=True,
    )

    # --- Stage 1: pull ------------------------------------------------------
    _run_pull(tmp_path, monkeypatch)

    collision_dir = tmp_path / "seq_501"
    mixed_dir = tmp_path / "seq_502"
    fp_dir = tmp_path / "seq_503"
    assert not (tmp_path / "seq_504").exists(), "unsure sequence must not be pulled"

    # collision: both objects on every shared frame, with their own classes
    for det_id in collision_dets:
        rows = _read_labels(collision_dir, det_id)
        assert sorted(cls for cls, _ in rows) == [
            CLASS_ID["wildfire"],
            CLASS_ID["industrial"],
        ]

    # mixed: FP box exported as fp_antenna, never as a smoke class
    rows = _read_labels(mixed_dir, mixed_det)
    assert sorted(cls for cls, _ in rows) == [
        CLASS_ID["wildfire"],
        CLASS_ID["fp_antenna"],
    ]

    # multi-type FP: one line per assigned type, same box
    rows = _read_labels(fp_dir, fp_det)
    assert sorted(cls for cls, _ in rows) == [
        CLASS_ID["fp_antenna"],
        CLASS_ID["fp_road"],
    ]

    # pull transitions the pulled sequences (and only them) to in_review
    for seq_id in (seq_collision, seq_mixed, seq_fp):
        assert _get_seq_annotation(token, seq_id)["processing_stage"] == "in_review"
    assert (
        _get_seq_annotation(token, seq_unsure)["processing_stage"]
        == "seq_annotation_done"
    )

    # --- Stage 2: auto-annotate (fake model) --------------------------------
    for seq_dir in (collision_dir, mixed_dir):
        process_sequence(
            seq_dir, _FakeModel(), conf_th=0.05, iou_nms=0.0, iou_assign=0.0
        )

    # collision: kept predictions inherit each seed group's class; stray dropped
    for det_id in collision_dets:
        rows = _read_labels(collision_dir, det_id)
        assert len(rows) == 2, "stray prediction must be dropped"
        classes = {cls: box for cls, box in rows}
        assert set(classes) == {CLASS_ID["wildfire"], CLASS_ID["industrial"]}
        # the left prediction is the wildfire one, the right the industrial one
        assert classes[CLASS_ID["wildfire"]][0] < 0.5
        assert classes[CLASS_ID["industrial"]][0] > 0.5

    # mixed: FP box untouched; the model prediction over the FP zone is
    # dropped (FP never validates a prediction), the wildfire one is kept
    rows = _read_labels(mixed_dir, mixed_det)
    classes = {cls: box for cls, box in rows}
    assert set(classes) == {CLASS_ID["wildfire"], CLASS_ID["fp_antenna"]}
    fp_box = classes[CLASS_ID["fp_antenna"]]
    assert fp_box == [pytest.approx(v) for v in [0.65, 0.65, 0.10, 0.10]]

    # --- Stage 3: apply-review (clean folder, FiftyOne bypassed) ------------
    for alert_id, seq_id, dets in (
        (502, seq_mixed, [mixed_det]),
        (501, seq_collision, collision_dets),
    ):
        manifest = load_manifest(tmp_path, alert_id)
        assert manifest is not None
        info = {"issue_frames": set(), "whole_issue": False, "all_frames": set(dets)}
        status = process_one_group(
            alert_id, info, manifest, API, token, tmp_path, dry_run=False
        )
        assert status == "ok"
        assert _get_seq_annotation(token, seq_id)["processing_stage"] == "annotated"

    # mixed sequence: detection annotation carries the smoke box AND the FP box
    det_annotations = _get_detection_annotations(token, seq_mixed)
    assert len(det_annotations) == 1
    assert det_annotations[0]["processing_stage"] == "annotated"
    items = det_annotations[0]["annotation"]["annotation"]
    smoke_items = [i for i in items if i.get("smoke_type")]
    fp_items = [i for i in items if i.get("false_positive_type")]
    assert [i["smoke_type"] for i in smoke_items] == ["wildfire"]
    assert [i["false_positive_type"] for i in fp_items] == ["antenna"]

    # collision sequence: both smoke types survive the round trip
    for annotation in _get_detection_annotations(token, seq_collision):
        types = sorted(i["smoke_type"] for i in annotation["annotation"]["annotation"])
        assert types == ["industrial", "wildfire"]

    # --- Stage 3b: apply-review with an issue-tagged frame -------------------
    # Runs in the same test so the schema is reset only once per uvicorn
    # lifetime (each reset invalidates the live server's asyncpg statement
    # cache; see _token). The sequences above are now in_review, so this
    # second pull only fetches the new one.
    seq_issue = _create_sequence(token, alert_api_id=601, camera_id=601)
    det_ok = _create_detection(token, seq_issue, 60100, 15, [P_LEFT])
    det_bad = _create_detection(token, seq_issue, 60101, 10, [P_LEFT])
    _create_seq_annotation(
        token, seq_issue, [_smoke_object("wildfire", {det_ok: P_LEFT, det_bad: P_LEFT})]
    )

    _run_pull(tmp_path, monkeypatch)

    manifest = load_manifest(tmp_path, 601)
    assert manifest is not None
    info = {
        "issue_frames": {det_bad},
        "whole_issue": False,
        "all_frames": {det_ok, det_bad},
    }
    status = process_one_group(601, info, manifest, API, token, tmp_path, dry_run=False)
    assert status == "partial_issue"

    # the issue frame sends the sequence to needs_manual; only the flagged
    # detection goes back to bbox_annotation
    assert _get_seq_annotation(token, seq_issue)["processing_stage"] == "needs_manual"
    stages = {
        annotation["detection_id"]: annotation["processing_stage"]
        for annotation in _get_detection_annotations(token, seq_issue)
    }
    assert stages[det_bad] == "bbox_annotation"
    assert stages[det_ok] == "annotated"
