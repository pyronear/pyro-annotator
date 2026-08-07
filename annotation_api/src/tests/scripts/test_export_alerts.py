import json
from pathlib import Path

from scripts.data_transfer.export.export_alerts import (
    ExportStats,
    frame_rel_path,
    plan_downloads,
    run_export,
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


def fake_pages(pages):
    """fetch_page stub walking a list of AlertExportPage dicts via cursor."""

    def fetch_page(cursor):
        index = 0 if cursor is None else int(cursor)
        page = dict(pages[index])
        page["next_cursor"] = str(index + 1) if index + 1 < len(pages) else None
        return page

    return fetch_page


def make_download(calls, fail_detection_ids=()):
    def download(url, dest: Path):
        calls.append(url)
        det_id = int(Path(url).stem)
        if det_id in fail_detection_ids:
            raise RuntimeError("boom")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"jpg")

    return download


def two_page_export():
    item_a = make_item(
        [
            {
                "sequence_id": 1,
                "record_kind": "smoke",
                "smoke_types": ["wildfire"],
                "false_positive_types": [],
                "frames": [
                    make_frame(10, image_url="https://s3/10"),
                    make_frame(11, image_url="https://s3/11"),
                ],
            },
        ]
    )
    item_b = make_item(
        [
            {
                "sequence_id": 2,
                "record_kind": "false_positive",
                "smoke_types": [],
                "false_positive_types": ["cliff"],
                "frames": [make_frame(20, image_url="https://s3/20")],
            },
        ]
    )
    item_b["platform_alert_id"] = 5678
    return [{"items": [item_a]}, {"items": [item_b]}]


def test_run_export_walks_cursor_and_materializes(tmp_path):
    calls: list[str] = []
    stats = run_export(
        fake_pages(two_page_export()), make_download(calls), tmp_path, max_workers=2
    )
    assert stats == ExportStats(alerts=2, downloaded=3, skipped=0, failed=0)
    lines = [
        json.loads(line)
        for line in (tmp_path / "manifest.jsonl").read_text().splitlines()
    ]
    assert [item["platform_alert_id"] for item in lines] == [1234, 5678]
    frame = lines[0]["objects"][0]["frames"][0]
    assert frame["image_path"] == "images/pyronear_french/1234/10.jpg"
    assert (tmp_path / "images/pyronear_french/1234/10.jpg").read_bytes() == b"jpg"
    assert not (tmp_path / "manifest.jsonl.tmp").exists()


def test_run_export_second_run_downloads_nothing(tmp_path):
    first: list[str] = []
    run_export(fake_pages(two_page_export()), make_download(first), tmp_path, 2)
    manifest_after_first = (tmp_path / "manifest.jsonl").read_text()

    second: list[str] = []
    stats = run_export(
        fake_pages(two_page_export()), make_download(second), tmp_path, 2
    )
    assert second == []
    assert stats.skipped == 3 and stats.downloaded == 0
    assert (tmp_path / "manifest.jsonl").read_text() == manifest_after_first


def test_run_export_failed_download_yields_null_path(tmp_path):
    stats = run_export(
        fake_pages(two_page_export()),
        make_download([], fail_detection_ids={11}),
        tmp_path,
        max_workers=2,
    )
    assert stats.failed == 1 and stats.downloaded == 2
    lines = [
        json.loads(line)
        for line in (tmp_path / "manifest.jsonl").read_text().splitlines()
    ]
    frames = lines[0]["objects"][0]["frames"]
    assert frames[0]["image_path"] is not None
    assert frames[1]["image_path"] is None


def test_run_export_frame_without_url_is_counted_not_downloaded(tmp_path):
    # The endpoint sends image_url=None for a detection with no bucket_key.
    pages = two_page_export()
    pages[0]["items"][0]["objects"][0]["frames"][1]["image_url"] = None

    calls: list[str] = []
    stats = run_export(fake_pages(pages), make_download(calls), tmp_path, 2)
    assert stats.missing_url == 1
    assert calls == ["https://s3/10", "https://s3/20"]
    lines = [
        json.loads(line)
        for line in (tmp_path / "manifest.jsonl").read_text().splitlines()
    ]
    assert lines[0]["objects"][0]["frames"][1]["image_path"] is None
