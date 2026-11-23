import hashlib
import io
import json
import tarfile
from pathlib import Path

import pytest

from app.cli import seed_sample as seed
from app.schemas.annotation_validation import SequenceAnnotationData
from app.schemas.detection_annotations import DetectionAnnotationBulkItem
from app.schemas.sequence_annotations import ClassifySubmitItem
from app.services.localization_rule import needs_localization


def make_object(
    *, smoke_type=None, fp_types=(), has_missed_smoke=False, boxed_frames=(101,)
):
    is_smoke = smoke_type is not None
    frames = []
    for det_id in (101, 102):
        boxes = []
        if det_id in boxed_frames:
            boxes.append(
                {
                    "xyxyn": [0.1, 0.1, 0.2, 0.2],
                    "smoke_type": smoke_type,
                    "false_positive_types": None if is_smoke else list(fp_types),
                    "origin": "auto" if is_smoke else "engine",
                }
            )
        frames.append(
            {
                "detection_id": det_id,
                "recorded_at": "2026-07-01T10:00:00Z",
                "image_path": f"images/pyronear_french/1001/{det_id}.jpg",
                "boxes": boxes,
                "seed": {
                    "alert_api_id": det_id,
                    "algo_predictions": {"predictions": []},
                    "others_bboxes": None,
                    "auto_predictions": None,
                },
            }
        )
    return {
        "frames": frames,
        "seed": {
            "alert_api_id": 1001,
            "has_missed_smoke": has_missed_smoke,
            "sequences_bbox": [
                {
                    "is_smoke": is_smoke,
                    "smoke_type": smoke_type,
                    "false_positive_types": list(fp_types),
                    "bboxes": [
                        {"detection_id": 101, "xyxyn": [0.1, 0.1, 0.2, 0.2]},
                        {"detection_id": 102, "xyxyn": [0.1, 0.1, 0.2, 0.2]},
                    ],
                }
            ],
        },
    }


DETECTION_IDS = {101: 7, 102: 8}


@pytest.mark.parametrize(
    "kwargs",
    [
        {"smoke_type": "wildfire"},
        {"smoke_type": "industrial"},
        {"smoke_type": "other"},
        {"fp_types": ["road"]},
        {"fp_types": ["road"], "has_missed_smoke": True},
    ],
)
def test_lane_needs_localization_matches_the_server_rule(kwargs):
    obj = make_object(**kwargs)
    track = obj["seed"]["sequences_bbox"][0]
    expected = needs_localization(
        has_smoke=track["is_smoke"],
        has_missed_smoke=obj["seed"]["has_missed_smoke"],
        is_unsure=False,
        smoke_types=[track["smoke_type"]] if track["smoke_type"] else [],
    )
    assert seed.lane_needs_localization(obj) is expected


def test_import_annotation_resets_the_human_labels():
    obj = make_object(fp_types=["road"])
    annotation = seed.import_annotation(obj, DETECTION_IDS)
    SequenceAnnotationData.model_validate(annotation)
    track = annotation["sequences_bbox"][0]
    assert track["is_smoke"] is True
    assert track["smoke_type"] is None
    assert track["false_positive_types"] == []
    assert [b["detection_id"] for b in track["bboxes"]] == [7, 8]


@pytest.mark.parametrize(
    "kwargs, stage",
    [
        ({"smoke_type": "wildfire"}, "seq_annotation_done"),
        ({"smoke_type": "industrial"}, "annotated"),
        ({"fp_types": ["road"]}, "annotated"),
    ],
)
def test_classify_item_takes_the_two_lane_exit(kwargs, stage):
    item = seed.classify_item(42, make_object(**kwargs), DETECTION_IDS)
    parsed = ClassifySubmitItem.model_validate(item)
    assert parsed.processing_stage.value == stage
    assert parsed.annotation.sequences_bbox[0].bboxes[0].detection_id == 7


def test_detection_annotation_items_cover_every_frame():
    obj = make_object(smoke_type="wildfire", boxed_frames=(101,))
    items = seed.detection_annotation_items(obj, DETECTION_IDS)
    for item in items:
        DetectionAnnotationBulkItem.model_validate(item)
    assert [item["detection_id"] for item in items] == [7, 8]
    assert items[0]["annotation"]["annotation"][0]["smoke_type"] == "wildfire"
    assert items[0]["annotation"]["annotation"][0]["origin"] == "auto"
    assert items[1]["annotation"]["annotation"] == []


def test_effective_state_finishes_alerts_with_nothing_to_localize():
    fp_alert = {"objects": [make_object(fp_types=["road"])]}
    fire_alert = {"objects": [make_object(smoke_type="wildfire")]}
    assert seed.effective_state(fp_alert, "to_localize") == "done"
    assert seed.effective_state(fire_alert, "to_localize") == "to_localize"
    assert seed.effective_state(fp_alert, "to_classify") == "to_classify"


def test_read_load_states_rejects_an_unknown_state(tmp_path: Path):
    path = tmp_path / "load_states.csv"
    path.write_text(
        "source_api,platform_alert_id,load_state\npyronear_french,1001,finished\n"
    )
    with pytest.raises(seed.SeedError, match="unknown load_state 'finished'"):
        seed.read_load_states(path)


def test_read_load_states_keys_alerts_by_source_and_id(tmp_path: Path):
    path = tmp_path / "load_states.csv"
    path.write_text(
        "source_api,platform_alert_id,load_state\n"
        "pyronear_french,1001,done\napi_cenia,1001,skip\n"
    )
    assert seed.read_load_states(path) == {
        ("pyronear_french", 1001): "done",
        ("api_cenia", 1001): "skip",
    }


def make_archive(version: str = "v9") -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        content = json.dumps({"platform_alert_id": 1001}).encode()
        info = tarfile.TarInfo(f"sample-data-{version}/manifest.jsonl")
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


URL = "https://example.test/sample-data-v9.tar.gz"


def test_ensure_dataset_downloads_once(tmp_path: Path, requests_mock):
    archive = make_archive()
    checksum = hashlib.sha256(archive).hexdigest()
    requests_mock.get(URL, content=archive)

    first = seed.ensure_dataset(tmp_path, "v9", URL, checksum)
    second = seed.ensure_dataset(tmp_path, "v9", URL, checksum)

    assert first == second == tmp_path / "sample-data-v9"
    assert (first / "manifest.jsonl").exists()
    assert requests_mock.call_count == 1


def test_ensure_dataset_reuses_an_archive_already_on_disk(
    tmp_path: Path, requests_mock
):
    archive = make_archive()
    (tmp_path / "sample-data-v9.tar.gz").write_bytes(archive)

    dataset = seed.ensure_dataset(
        tmp_path, "v9", URL, hashlib.sha256(archive).hexdigest()
    )

    assert (dataset / "manifest.jsonl").exists()
    assert requests_mock.call_count == 0


def test_ensure_dataset_rejects_a_bad_checksum(tmp_path: Path, requests_mock):
    requests_mock.get(URL, content=make_archive())
    with pytest.raises(seed.SeedError, match="Checksum mismatch"):
        seed.ensure_dataset(tmp_path, "v9", URL, "0" * 64)
    assert not (tmp_path / "sample-data-v9.tar.gz").exists()
    assert not (tmp_path / "sample-data-v9").exists()


def test_ensure_dataset_refetches_when_the_pin_changes(tmp_path: Path, requests_mock):
    archive = make_archive()
    checksum = hashlib.sha256(archive).hexdigest()
    requests_mock.get(URL, content=archive)
    seed.ensure_dataset(tmp_path, "v9", URL, checksum)
    (tmp_path / ".sample-data-v9.sha256").write_text("an-older-checksum\n")

    seed.ensure_dataset(tmp_path, "v9", URL, checksum)

    # The archive on disk still matches, so it is re-extracted, not re-downloaded.
    assert requests_mock.call_count == 1
    assert (tmp_path / ".sample-data-v9.sha256").read_text().strip() == checksum


def test_ensure_dataset_explains_an_unpublished_release(tmp_path: Path):
    with pytest.raises(seed.SeedError, match="--dataset-dir"):
        seed.ensure_dataset(tmp_path, "v9", URL, "")
