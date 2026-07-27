from datetime import datetime, timedelta

from scripts.data_transfer.ingestion.alert_api.object_clustering import (
    cluster_objects,
)

T0 = datetime(2026, 7, 1, 10, 0, 0)

BOX_A = [0.10, 0.10, 0.20, 0.20, 0.9]  # object A, stable position
BOX_B = [0.60, 0.60, 0.70, 0.70, 0.8]  # object B, disjoint from A


def make_frames(box_lists, minutes_apart=1):
    """box_lists: one list of boxes per frame, 1 minute apart by default."""
    return [
        {
            "frame_idx": i,
            "recorded_at": T0 + timedelta(minutes=i * minutes_apart),
            "image_filename": f"img_{i}.jpg",
            "boxes": boxes,
        }
        for i, boxes in enumerate(box_lists)
    ]


class TestClusterObjects:
    def test_overlapping_boxes_across_frames_form_one_object(self):
        objects = cluster_objects(make_frames([[BOX_A], [BOX_A], [BOX_A], [BOX_A]]))
        assert len(objects) == 1
        assert len(objects[0].members) == 4

    def test_two_disjoint_box_groups_form_two_objects(self):
        frames = make_frames([[BOX_A, BOX_B], [BOX_A, BOX_B], [BOX_A, BOX_B]])
        objects = cluster_objects(frames)
        assert len(objects) == 2
        assert all(len(o.members) == 3 for o in objects)

    def test_below_spawn_threshold_yields_no_objects(self):
        # min_dets=3: two overlapping detections never spawn an object
        assert cluster_objects(make_frames([[BOX_A], [BOX_A]])) == []

    def test_straggler_boxes_below_threshold_are_dropped(self):
        # A spawns (3 dets); B appears only twice -> dropped
        frames = make_frames([[BOX_A, BOX_B], [BOX_A, BOX_B], [BOX_A]])
        objects = cluster_objects(frames)
        assert len(objects) == 1
        assert all(m.box[:4] == BOX_A[:4] for m in objects[0].members)

    def test_late_box_joins_open_object_within_relaxation_window(self):
        frames = make_frames([[BOX_A], [BOX_A], [BOX_A]])
        frames.append(
            {
                "frame_idx": 3,
                "recorded_at": T0 + timedelta(minutes=30),  # > 5min spawn window, < 2h relaxation
                "image_filename": "img_3.jpg",
                "boxes": [BOX_A],
            }
        )
        objects = cluster_objects(frames)
        assert len(objects) == 1
        assert len(objects[0].members) == 4

    def test_empty_frames_yield_no_objects(self):
        assert cluster_objects(make_frames([[], [], []])) == []
