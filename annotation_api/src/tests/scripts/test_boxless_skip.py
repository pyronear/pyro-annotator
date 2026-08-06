"""Auto-skip of boxless alerts at import time (#333).

An alert whose records carry no usable engine box produces a zero-object
lane that the classify page cannot act on. The import detects those alerts
(`boxless_platform_alert_ids`) and parks them via the alert-skip overlay
(`skip_boxless_alerts`).
"""

import requests_mock as requests_mock_lib

from scripts.data_transfer.ingestion.alert_api.shared import (
    boxless_platform_alert_ids,
    skip_boxless_alerts,
)

# No __init__.py convention in src/tests/ — pytest inserts the test dir on
# sys.path, so sibling helpers are imported as top-level modules.
from factories import make_record

GOOD_BOX = [0.10, 0.10, 0.20, 0.20, 0.9]
ZERO_BOX = [0.0, 0.0, 0.0, 0.0, 0.0]
POINT_BOX = [0.5, 0.5, 0.5, 0.5, 0.9]  # non-zero but zero-area
INVERTED_BOX = [0.6, 0.6, 0.4, 0.4, 0.9]  # x1 > x2, y1 > y2


def alert_records(platform_alert_id, bboxes_per_record):
    return [
        make_record(
            det_id=platform_alert_id * 100 + i,
            created_at=f"2026-08-04T13:0{i}:00",
            bboxes=bboxes,
            sid=platform_alert_id,
            platform_alert_id=platform_alert_id,
        )
        for i, bboxes in enumerate(bboxes_per_record)
    ]


class TestBoxlessPlatformAlertIds:
    def test_all_records_boxless_flags_alert(self):
        records = alert_records(56861, [None, None, None])
        assert boxless_platform_alert_ids(records) == {56861}

    def test_empty_box_lists_flag_alert(self):
        records = alert_records(56861, [[], [], []])
        assert boxless_platform_alert_ids(records) == {56861}

    def test_all_zero_boxes_flag_alert(self):
        # _sanitize_predictions drops all-zero boxes, same as posting does.
        records = alert_records(56861, [[ZERO_BOX], [ZERO_BOX]])
        assert boxless_platform_alert_ids(records) == {56861}

    def test_one_usable_box_clears_alert(self):
        records = alert_records(56861, [None, [GOOD_BOX], None])
        assert boxless_platform_alert_ids(records) == set()

    def test_mixed_alerts_only_boxless_flagged(self):
        records = alert_records(1111, [[GOOD_BOX], [GOOD_BOX]]) + alert_records(
            2222, [None, []]
        )
        assert boxless_platform_alert_ids(records) == {2222}

    def test_degenerate_boxes_flag_alert(self):
        # Non-zero but zero-area/inverted boxes are dropped by
        # build_single_track_annotation, so the lane would have no tracks.
        records = alert_records(56861, [[POINT_BOX], [INVERTED_BOX]])
        assert boxless_platform_alert_ids(records) == {56861}

    def test_records_without_platform_alert_id_are_ignored(self):
        # The object-split exception fallback emits records without the key;
        # they cannot be alert-skipped and must not crash the decision.
        records = alert_records(2222, [None])
        no_pid = make_record(1, "2026-08-04T13:00:00", None, sid=999)
        assert boxless_platform_alert_ids([no_pid] + records) == {2222}

    def test_no_records(self):
        assert boxless_platform_alert_ids([]) == set()


class TestSkipBoxlessAlerts:
    BASE = "http://localhost:5050"

    def test_skips_each_alert_with_note(self):
        with requests_mock_lib.Mocker() as m:
            m.post(f"{self.BASE}/api/v1/sequences/alert/skip", json={}, status_code=201)
            counts = skip_boxless_alerts(
                self.BASE, "token", "pyronear_french", [56861, 56999]
            )
        assert counts == {"skipped": 2, "already_skipped": 0, "failed": 0}
        assert m.call_count == 2
        payload = m.request_history[0].json()
        assert payload["source_api"] == "pyronear_french"
        assert payload["platform_alert_id"] == 56861
        assert "boxless" in payload["note"]

    def test_409_counts_as_already_skipped(self):
        with requests_mock_lib.Mocker() as m:
            m.post(
                f"{self.BASE}/api/v1/sequences/alert/skip",
                json={"detail": "Alert is already skipped"},
                status_code=409,
            )
            counts = skip_boxless_alerts(self.BASE, "token", "pyronear_french", [56861])
        assert counts == {"skipped": 0, "already_skipped": 1, "failed": 0}

    def test_other_errors_count_as_failed_and_do_not_raise(self):
        with requests_mock_lib.Mocker() as m:
            m.post(
                f"{self.BASE}/api/v1/sequences/alert/skip",
                json={"detail": "No sequences for alert"},
                status_code=404,
            )
            counts = skip_boxless_alerts(self.BASE, "token", "pyronear_french", [56861])
        assert counts == {"skipped": 0, "already_skipped": 0, "failed": 1}

    def test_no_alerts_no_requests(self):
        with requests_mock_lib.Mocker() as m:
            counts = skip_boxless_alerts(self.BASE, "token", "pyronear_french", [])
        assert counts == {"skipped": 0, "already_skipped": 0, "failed": 0}
        assert m.call_count == 0
