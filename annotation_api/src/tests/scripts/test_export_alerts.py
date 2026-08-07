from scripts.data_transfer.export.export_alerts import (
    frame_rel_path,
    plan_downloads,
    to_manifest_item,
)


def make_frame(detection_id: int, image_url: str | None = "https://s3/presigned"):
    return {
        "detection_id": detection_id,
        "recorded_at": "2026-07-01T10:00:00",
        "bucket_key": f"key-{detection_id}.jpg",
        "image_url": image_url,
        "boxes": [
            {
                "xyxyn": [0.1, 0.1, 0.2, 0.2],
                "smoke_type": "wildfire",
                "false_positive_types": None,
                "origin": "human",
            }
        ],
    }


def make_item(objects):
    return {
        "source_api": "pyronear_french",
        "platform_alert_id": 1234,
        "camera_id": 1,
        "camera_name": "cam",
        "organisation_id": 1,
        "organisation_name": "org",
        "lat": 44.0,
        "lon": 4.0,
        "azimuth": 90,
        "recorded_at": "2026-07-01T10:00:00",
        "last_annotated_at": "2026-07-02T10:00:00",
        "objects": objects,
    }


def test_frame_rel_path_layout():
    assert (
        frame_rel_path("pyronear_french", 1234, 18709)
        == "images/pyronear_french/1234/18709.jpg"
    )


def test_plan_downloads_dedupes_shared_frames_across_objects():
    # Objects (lanes) of one alert share frames: same detection twice.
    item = make_item(
        [
            {
                "sequence_id": 1,
                "record_kind": "smoke",
                "smoke_types": ["wildfire"],
                "false_positive_types": [],
                "frames": [make_frame(10), make_frame(11)],
            },
            {
                "sequence_id": 2,
                "record_kind": "false_positive",
                "smoke_types": [],
                "false_positive_types": ["cliff"],
                "frames": [make_frame(10)],
            },
        ]
    )
    plan = plan_downloads(item)
    assert set(plan) == {10, 11}
    assert plan[10] == ("https://s3/presigned", "images/pyronear_french/1234/10.jpg")


def test_plan_downloads_prefers_frame_copy_that_has_a_url():
    item = make_item(
        [
            {
                "sequence_id": 1,
                "record_kind": "smoke",
                "smoke_types": ["wildfire"],
                "false_positive_types": [],
                "frames": [make_frame(10, image_url=None)],
            },
            {
                "sequence_id": 2,
                "record_kind": "false_positive",
                "smoke_types": [],
                "false_positive_types": ["cliff"],
                "frames": [make_frame(10)],
            },
        ]
    )
    assert plan_downloads(item)[10][0] == "https://s3/presigned"


def test_to_manifest_item_swaps_image_url_for_image_path():
    item = make_item(
        [
            {
                "sequence_id": 1,
                "record_kind": "smoke",
                "smoke_types": ["wildfire"],
                "false_positive_types": [],
                "frames": [make_frame(10), make_frame(11)],
            },
        ]
    )
    out = to_manifest_item(item, materialized={10})
    frames = out["objects"][0]["frames"]
    assert "image_url" not in frames[0]
    assert frames[0]["image_path"] == "images/pyronear_french/1234/10.jpg"
    assert frames[1]["image_path"] is None  # failed/missing download
    # input not mutated
    assert item["objects"][0]["frames"][0]["image_url"] == "https://s3/presigned"
