from datetime import datetime

import pytest

from scripts.data_transfer.ingestion.alert_api.object_clustering import cluster_objects
from scripts.data_transfer.ingestion.alert_api.object_split import (
    DEFAULT_ALERT_ID_BASE,
    build_frames,
    build_single_track_annotation,
    select_primary_index,
    split_all_records,
    split_sequence_records,
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


class TestSplitSequenceRecords:
    def test_two_objects_yield_two_groups_primary_first(self):
        groups = split_sequence_records(two_object_records())
        assert len(groups) == 2
        primary, sibling = groups
        assert primary.is_primary and primary.object_index == 0
        assert primary.alert_api_id == 47105  # keeps the platform id
        assert not sibling.is_primary and sibling.object_index == 1
        assert sibling.alert_api_id == DEFAULT_ALERT_ID_BASE + 47105 * 1000 + 1
        assert not primary.is_fallback and not sibling.is_fallback

    def test_rewritten_records_carry_object_boxes_and_ids(self):
        primary, sibling = split_sequence_records(two_object_records())
        for record in primary.records:
            assert record["sequence_id"] == 47105
            assert record["detection_bboxes"] == [BOX_A]
            assert record["detection_others_bboxes"] == [BOX_B]
        for record in sibling.records:
            assert record["sequence_id"] == sibling.alert_api_id
            assert record["detection_bboxes"] == [BOX_B]
            assert record["detection_others_bboxes"] == [BOX_A]

    def test_rewritten_records_have_per_object_temporal_extent(self):
        records = two_object_records()
        # object B misses the last frame
        records[2]["detection_others_bboxes"] = []
        records.append(make_record(4, "2026-07-01T10:03:00", [BOX_A], others=[BOX_B]))
        primary, sibling = split_sequence_records(records)
        assert primary.records[0]["sequence_started_at"] == "2026-07-01T10:00:00"
        assert primary.records[0]["sequence_last_seen_at"] == "2026-07-01T10:03:00"
        assert sibling.records[0]["sequence_started_at"] == "2026-07-01T10:00:00"
        assert sibling.records[0]["sequence_last_seen_at"] == "2026-07-01T10:03:00"
        # B has no box on frame 3
        assert len(sibling.records) == 3

    def test_per_object_cone_azimuth_rewrites_camera_azimuth(self):
        primary, sibling = split_sequence_records(two_object_records())
        # resolve_cone(100.0, [BOX_A], 87.0): center 0.15 -> 100 + 87*(0.15-0.5) = 69.55
        # (resolve_cone rounds to 1 decimal; tolerate float-rounding at the last digit)
        assert primary.records[0]["camera_azimuth"] == pytest.approx(69.55, abs=0.06)
        # BOX_B center 0.65 -> 100 + 87*(0.65-0.5) = 113.05
        assert sibling.records[0]["camera_azimuth"] == pytest.approx(113.05, abs=0.06)

    def test_no_azimuth_rewrite_without_angle_of_view(self):
        records = [
            make_record(i, f"2026-07-01T10:0{i}:00", [BOX_A], camera_angle_of_view=None)
            for i in range(1, 4)
        ]
        (group,) = split_sequence_records(records)
        assert group.records[0]["camera_azimuth"] == 100.0

    def test_too_short_sequence_falls_back_to_single_unmodified_group(self):
        records = two_object_records()[:2]  # below min_dets=3
        (group,) = split_sequence_records(records)
        assert group.is_fallback and group.is_primary
        assert group.alert_api_id == 47105
        assert len(group.records) == 2
        assert group.records[0]["detection_bboxes"] == [BOX_A]
        assert group.records[0]["detection_others_bboxes"] == [BOX_B]

    def test_boxless_sequence_falls_back(self):
        records = [make_record(i, f"2026-07-01T10:0{i}:00", []) for i in range(1, 5)]
        (group,) = split_sequence_records(records)
        assert group.is_fallback
        assert len(group.records) == 4


class TestSplitAllRecords:
    def test_flattens_groups_and_reports_stats(self):
        records = two_object_records() + [
            make_record(10 + i, f"2026-07-01T11:0{i}:00", [BOX_A], sid=200)
            for i in range(3)
        ]
        out, stats = split_all_records(records)
        assert stats == {
            "platform_sequences": 2,
            "objects": 3,
            "sibling_objects": 1,
            "fallback_sequences": 0,
            "cross_deduped_siblings": 0,
        }
        assert {r["sequence_id"] for r in out} == {
            47105,
            DEFAULT_ALERT_ID_BASE + 47105 * 1000 + 1,
            200,
        }

    def test_broken_sequence_falls_back_others_still_split(self):
        # detection_created_at=None can't be parsed, so split_sequence_records
        # raises for this sequence -> it must fall back, not take down the batch.
        broken = [
            make_record(1, None, [BOX_A], others=[BOX_B], sid=999),
            make_record(2, None, [BOX_A], others=[BOX_B], sid=999),
            make_record(3, None, [BOX_A], others=[BOX_B], sid=999),
        ]
        good = two_object_records()
        out, stats = split_all_records(broken + good)
        assert stats["platform_sequences"] == 2
        assert stats["fallback_sequences"] == 1
        # the good sequence still split into primary + sibling
        assert stats["objects"] == 3
        assert stats["sibling_objects"] == 1
        broken_records = [r for r in out if r["sequence_id"] == 999]
        assert len(broken_records) == 3
        assert {r["sequence_id"] for r in out} >= {
            999,
            47105,
            DEFAULT_ALERT_ID_BASE + 47105 * 1000 + 1,
        }


class TestBuildSingleTrackAnnotation:
    def test_one_track_with_time_ordered_bboxes(self):
        results = [
            {"annotation_detection_id": 12, "xyxyns": [[0.1, 0.1, 0.2, 0.2]], "recorded_at": "2026-07-01T10:01:00"},
            {"annotation_detection_id": 11, "xyxyns": [[0.1, 0.1, 0.2, 0.2]], "recorded_at": "2026-07-01T10:00:00"},
        ]
        data = build_single_track_annotation(results)
        assert len(data.sequences_bbox) == 1
        track = data.sequences_bbox[0]
        assert track.is_smoke is True
        assert track.false_positive_types == []
        assert [b.detection_id for b in track.bboxes] == [11, 12]

    def test_multiple_boxes_on_one_detection_become_multiple_track_entries(self):
        results = [
            {
                "annotation_detection_id": 11,
                "xyxyns": [[0.1, 0.1, 0.2, 0.2], [0.3, 0.3, 0.4, 0.4]],
                "recorded_at": "2026-07-01T10:00:00",
            }
        ]
        data = build_single_track_annotation(results)
        assert len(data.sequences_bbox[0].bboxes) == 2

    def test_zero_area_and_empty_results_yield_empty_sequences_bbox(self):
        # zero-area boxes would fail BoundingBox validation -> must be filtered
        results = [
            {"annotation_detection_id": 11, "xyxyns": [[0.5, 0.5, 0.5, 0.9]], "recorded_at": "2026-07-01T10:00:00"}
        ]
        assert build_single_track_annotation(results).sequences_bbox == []
        assert build_single_track_annotation([]).sequences_bbox == []


class TestBuildFramesDedupesOwnAndOthers:
    def test_duplicate_box_in_own_and_others_appears_once(self):
        records = [
            make_record(i, f"2026-07-01T10:0{i}:00", [BOX_A], others=[BOX_A])
            for i in range(1, 4)
        ]
        frames, primary_keys = build_frames(records)
        assert all(len(f["boxes"]) == 1 for f in frames)
        assert primary_keys == {(str(i), tuple(BOX_A[:4])) for i in (1, 2, 3)}

    def test_duplicate_box_survives_split_exactly_once(self):
        records = [
            make_record(i, f"2026-07-01T10:0{i}:00", [BOX_A], others=[BOX_A])
            for i in range(1, 4)
        ]
        (group,) = split_sequence_records(records)
        for record in group.records:
            assert record["detection_bboxes"] == [BOX_A]


class TestSplitAllRecordsCrossSequenceDedup:
    def _reciprocal_sequences(self):
        """Mirrors live seqs 55283/55284: each sequence's `bbox` is the
        other's `others_bboxes`, on the same bucket keys."""
        seq_a = [
            make_record(
                1 + i,
                f"2026-07-01T10:0{i}:00",
                [BOX_A],
                others=[BOX_B],
                sid=100,
                detection_bucket_key=f"key/frame{i}.jpg",
            )
            for i in range(3)
        ]
        seq_b = [
            make_record(
                4 + i,
                f"2026-07-01T10:0{i}:00",
                [BOX_B],
                others=[BOX_A],
                sid=200,
                detection_bucket_key=f"key/frame{i}.jpg",
            )
            for i in range(3)
        ]
        return seq_a, seq_b

    def test_reciprocal_siblings_are_dropped(self):
        seq_a, seq_b = self._reciprocal_sequences()
        out, stats = split_all_records(seq_a + seq_b)
        assert {r["sequence_id"] for r in out} == {100, 200}
        assert stats["cross_deduped_siblings"] == 2
        # Dropped groups must not inflate the emitted-object accounting.
        assert stats["objects"] == 2
        assert stats["sibling_objects"] == 0

    def test_sibling_with_no_cross_sequence_match_is_kept(self):
        out, stats = split_all_records(two_object_records())
        assert stats["cross_deduped_siblings"] == 0
        assert DEFAULT_ALERT_ID_BASE + 47105 * 1000 + 1 in {
            r["sequence_id"] for r in out
        }
