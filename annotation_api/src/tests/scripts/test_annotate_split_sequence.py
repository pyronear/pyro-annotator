import scripts.data_transfer.ingestion.alert_api.annotation_management as am


def seq_result(failed=0, detection_results=None):
    return {
        "success": True,
        "sequence_id": 42,
        "alert_api_sequence_id": 47105,
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
        monkeypatch.setattr(
            am, "check_existing_annotation", lambda url, sid, token: None
        )

        def fake_create(
            url,
            sid,
            annotation_data,
            auth_token,
            dry_run,
            existing_id,
            stage,
            config=None,
        ):
            captured.update(
                sid=sid,
                data=annotation_data,
                token=auth_token,
                dry_run=dry_run,
                existing=existing_id,
                stage=stage,
            )
            return True

        monkeypatch.setattr(am, "create_annotation_from_data", fake_create)
        result = am.annotate_split_sequence(
            seq_result(), "http://annotation.test", "tok", dry_run=False
        )
        assert result["annotation_created"] is True
        assert captured["token"] == "tok"
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
        tokens = []
        monkeypatch.setattr(
            am,
            "delete_sequence",
            lambda url, token, sid: (deleted.append(sid), tokens.append(token)),
        )
        result = am.annotate_split_sequence(
            seq_result(failed=1), "http://annotation.test", "tok", dry_run=False
        )
        assert tokens == ["tok"]
        assert deleted == [42]
        assert result["annotation_created"] is False
        assert result["errors"] and "rolled back" in result["errors"][0]

    def test_annotation_failure_reports_error(self, monkeypatch):
        deleted = []
        monkeypatch.setattr(
            am, "check_existing_annotation", lambda url, sid, token: None
        )
        monkeypatch.setattr(
            am, "create_annotation_from_data", lambda *args, **kwargs: False
        )
        monkeypatch.setattr(
            am, "delete_sequence", lambda url, token, sid: deleted.append(sid)
        )
        result = am.annotate_split_sequence(
            seq_result(), "http://annotation.test", "tok", dry_run=False
        )
        assert result["annotation_created"] is False
        assert result["errors"]
        assert deleted == [42]

    def test_annotation_failure_rolls_back_sequence(self, monkeypatch):
        deleted = []
        monkeypatch.setattr(
            am, "check_existing_annotation", lambda url, sid, token: None
        )
        monkeypatch.setattr(
            am, "create_annotation_from_data", lambda *args, **kwargs: False
        )
        monkeypatch.setattr(
            am, "delete_sequence", lambda url, token, sid: deleted.append(sid)
        )
        result = am.annotate_split_sequence(
            seq_result(), "http://annotation.test", "tok", dry_run=False
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
            am, "delete_sequence", lambda url, token, sid: deleted.append(sid)
        )
        result = am.annotate_split_sequence(
            seq_result(), "http://annotation.test", "tok", dry_run=False
        )
        assert deleted == [42]
        assert result["annotation_created"] is False
        assert result["errors"] and "rolled back" in result["errors"][0]


class TestAuthTokenReuse:
    def test_annotate_split_sequence_does_not_log_in(self, monkeypatch):
        """Stage 3 must reuse the caller's token, never mint its own.

        Each login is ~143ms of bcrypt on the API's single event loop, and it
        was being paid twice per lane.
        """
        logins = []

        def _no_login(*args, **kwargs):
            logins.append(1)
            return "minted"

        # raising=False so this holds whether or not the module still imports
        # get_auth_token. Dropping the import is the stronger guarantee; this
        # test is the guard against it being reintroduced along with a call.
        monkeypatch.setattr(am, "get_auth_token", _no_login, raising=False)
        monkeypatch.setattr(
            am,
            "list_sequence_annotations",
            lambda url, token, sequence_id: {"items": []},
        )
        monkeypatch.setattr(
            am, "create_sequence_annotation", lambda url, token, payload: {"id": 7}
        )

        result = am.annotate_split_sequence(
            seq_result(), "http://annotation.test", "caller-token", dry_run=False
        )

        assert result["annotation_created"] is True
        assert (
            logins == []
        ), "stage 3 minted its own token instead of reusing the caller's"

    def test_caller_token_is_forwarded_to_the_api(self, monkeypatch):
        seen = {}

        def _list(url, token, sequence_id):
            seen["list"] = token
            return {"items": []}

        def _create(url, token, payload):
            seen["create"] = token
            return {"id": 7}

        monkeypatch.setattr(am, "list_sequence_annotations", _list)
        monkeypatch.setattr(am, "create_sequence_annotation", _create)

        am.annotate_split_sequence(
            seq_result(), "http://annotation.test", "caller-token", dry_run=False
        )

        assert seen["list"] == "caller-token"
        assert seen["create"] == "caller-token"
