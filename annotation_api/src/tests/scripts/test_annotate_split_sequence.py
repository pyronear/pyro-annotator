import scripts.data_transfer.ingestion.alert_api.annotation_management as am


def seq_result(failed=0, detection_results=None):
    return {
        "success": True,
        "sequence_id": 42,
        "platform_sequence_id": 47105,
        "successful_detections": 3 - failed,
        "failed_detections": failed,
        "total_detections": 3,
        "detection_results": detection_results
        if detection_results is not None
        else [
            {
                "annotation_detection_id": 11,
                "xyxyns": [[0.1, 0.1, 0.2, 0.2]],
                "recorded_at": "2026-07-01T10:00:00",
            },
            {
                "annotation_detection_id": 12,
                "xyxyns": [[0.1, 0.1, 0.2, 0.2]],
                "recorded_at": "2026-07-01T10:01:00",
            },
            {
                "annotation_detection_id": 13,
                "xyxyns": [[0.1, 0.1, 0.2, 0.2]],
                "recorded_at": "2026-07-01T10:02:00",
            },
        ],
    }


class TestAnnotateSplitSequence:
    def test_happy_path_creates_one_track_annotation(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(am, "check_existing_annotation", lambda url, sid: None)

        def fake_create(
            url, sid, annotation_data, dry_run, existing_id, stage, config=None
        ):
            captured.update(
                sid=sid,
                data=annotation_data,
                dry_run=dry_run,
                existing=existing_id,
                stage=stage,
            )
            return True

        monkeypatch.setattr(am, "create_annotation_from_data", fake_create)
        result = am.annotate_split_sequence(
            seq_result(), "http://annotation.test", dry_run=False
        )
        assert result["annotation_created"] is True
        assert result["errors"] == []
        assert captured["sid"] == 42
        assert len(captured["data"].sequences_bbox) == 1
        assert [b.detection_id for b in captured["data"].sequences_bbox[0].bboxes] == [
            11,
            12,
            13,
        ]

    def test_partial_import_rolls_back_sequence(self, monkeypatch):
        deleted = []
        monkeypatch.setattr(
            am.shared, "get_annotation_credentials", lambda url: ("u", "p")
        )
        monkeypatch.setattr(am, "get_auth_token", lambda url, username, password: "tok")
        monkeypatch.setattr(
            am, "delete_sequence", lambda url, token, sid: deleted.append(sid)
        )
        result = am.annotate_split_sequence(
            seq_result(failed=1), "http://annotation.test", dry_run=False
        )
        assert deleted == [42]
        assert result["annotation_created"] is False
        assert result["errors"] and "rolled back" in result["errors"][0]

    def test_annotation_failure_reports_error(self, monkeypatch):
        deleted = []
        monkeypatch.setattr(am, "check_existing_annotation", lambda url, sid: None)
        monkeypatch.setattr(
            am, "create_annotation_from_data", lambda *args, **kwargs: False
        )
        monkeypatch.setattr(
            am.shared, "get_annotation_credentials", lambda url: ("u", "p")
        )
        monkeypatch.setattr(am, "get_auth_token", lambda url, username, password: "tok")
        monkeypatch.setattr(
            am, "delete_sequence", lambda url, token, sid: deleted.append(sid)
        )
        result = am.annotate_split_sequence(
            seq_result(), "http://annotation.test", dry_run=False
        )
        assert result["annotation_created"] is False
        assert result["errors"]
        assert deleted == [42]

    def test_annotation_failure_rolls_back_sequence(self, monkeypatch):
        deleted = []
        monkeypatch.setattr(am, "check_existing_annotation", lambda url, sid: None)
        monkeypatch.setattr(
            am, "create_annotation_from_data", lambda *args, **kwargs: False
        )
        monkeypatch.setattr(
            am.shared, "get_annotation_credentials", lambda url: ("u", "p")
        )
        monkeypatch.setattr(am, "get_auth_token", lambda url, username, password: "tok")
        monkeypatch.setattr(
            am, "delete_sequence", lambda url, token, sid: deleted.append(sid)
        )
        result = am.annotate_split_sequence(
            seq_result(), "http://annotation.test", dry_run=False
        )
        assert deleted == [42]
        assert result["annotation_created"] is False
        assert result["errors"] and "rolled back" in result["errors"][0]

    def test_unexpected_error_building_annotation_rolls_back_sequence(
        self, monkeypatch
    ):
        deleted = []

        def _raise(detection_results):
            raise ValueError("boom")

        monkeypatch.setattr(am, "build_single_track_annotation", _raise)
        monkeypatch.setattr(
            am.shared, "get_annotation_credentials", lambda url: ("u", "p")
        )
        monkeypatch.setattr(am, "get_auth_token", lambda url, username, password: "tok")
        monkeypatch.setattr(
            am, "delete_sequence", lambda url, token, sid: deleted.append(sid)
        )
        result = am.annotate_split_sequence(
            seq_result(), "http://annotation.test", dry_run=False
        )
        assert deleted == [42]
        assert result["annotation_created"] is False
        assert result["errors"] and "rolled back" in result["errors"][0]
