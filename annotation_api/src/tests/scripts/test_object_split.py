from datetime import datetime

from scripts.data_transfer.ingestion.platform.object_clustering import cluster_objects
from scripts.data_transfer.ingestion.platform.object_split import (
    DEFAULT_ALERT_ID_BASE,
    build_frames,
    select_primary_index,
    synthetic_alert_api_id,
)

# No __init__.py convention in src/tests/ — pytest inserts the test dir on
# sys.path, so sibling helpers are imported as top-level modules.
from factories import make_record

BOX_A = [0.10, 0.10, 0.20, 0.20, 0.9]  # in the platform's own `bbox` field
BOX_B = [0.60, 0.60, 0.70, 0.70, 0.8]  # sibling, in `others_bboxes`


def two_object_records():
    """Mirrors platform seq 47105 from #166: A tracked, B in others_bboxes."""
    return [
        make_record(1, "2026-07-01T10:00:00", [BOX_A], others=[BOX_B]),
        make_record(2, "2026-07-01T10:01:00", [BOX_A], others=[BOX_B]),
        make_record(3, "2026-07-01T10:02:00", [BOX_A], others=[BOX_B]),
    ]


class TestBuildFrames:
    def test_frames_merge_own_and_others_boxes(self):
        frames, primary_keys = build_frames(two_object_records())
        assert len(frames) == 3
        assert all(len(f["boxes"]) == 2 for f in frames)
        assert all(isinstance(f["recorded_at"], datetime) for f in frames)
        # only the bbox-sourced boxes are tagged primary
        assert primary_keys == {(str(i), tuple(BOX_A[:4])) for i in (1, 2, 3)}

    def test_frames_are_time_ordered_and_keyed_by_detection_id(self):
        records = list(reversed(two_object_records()))
        frames, _ = build_frames(records)
        assert [f["image_filename"] for f in frames] == ["1", "2", "3"]
        assert [f["frame_idx"] for f in frames] == [0, 1, 2]

    def test_malformed_boxes_are_skipped(self):
        records = [make_record(1, "2026-07-01T10:00:00", [[0.1, 0.1]], others=None)]
        frames, primary_keys = build_frames(records)
        assert frames[0]["boxes"] == []
        assert primary_keys == set()


class TestSelectPrimaryIndex:
    def test_object_with_most_bbox_sourced_boxes_wins(self):
        frames, primary_keys = build_frames(two_object_records())
        objects = cluster_objects(frames)
        assert len(objects) == 2
        primary = select_primary_index(objects, primary_keys)
        assert objects[primary].members[0].box[:4] == BOX_A[:4]

    def test_tie_broken_by_earliest_start(self):
        # No box is bbox-sourced -> counts all zero -> earliest object wins
        frames, _ = build_frames(two_object_records())
        objects = cluster_objects(frames)
        primary = select_primary_index(objects, primary_keys=set())
        starts = [o.started_at for o in objects]
        assert objects[primary].started_at == min(starts)


class TestSyntheticAlertApiId:
    def test_scheme(self):
        assert (
            synthetic_alert_api_id(47105, 1) == DEFAULT_ALERT_ID_BASE + 47105 * 1000 + 1
        )

    def test_custom_base(self):
        assert (
            synthetic_alert_api_id(5, 2, alert_id_base=2_000_000_000) == 2_000_005_002
        )
