import scripts.data_transfer.ingestion.alert_api.shared as shared

from factories import make_record

BOX = [0.1, 0.1, 0.2, 0.2, 0.9]


def _patch_clients(monkeypatch, created_ids):
    monkeypatch.setattr(shared, "create_sequence", lambda url, token, data: {"id": 99})

    def fake_create(url, token, detection_data, source_key):
        created_ids.append(detection_data["alert_api_id"])
        return {"id": 500 + len(created_ids)}

    monkeypatch.setattr(shared, "create_detection_from_bucket_key", fake_create)


class TestDetectionResultsPlumbing:
    def test_post_sequence_collects_detection_results(self, monkeypatch):
        created = []
        _patch_clients(monkeypatch, created)
        records = [
            make_record(1, "2026-07-01T10:00:00", [BOX]),
            make_record(2, "2026-07-01T10:01:00", [BOX]),
        ]
        result = shared.post_sequence_to_annotation_api(
            "http://annotation.test", records, "token", max_detection_workers=1
        )
        assert result["successful_detections"] == 2
        by_time = sorted(result["detection_results"], key=lambda r: r["recorded_at"])
        assert [r["annotation_detection_id"] for r in by_time] == [501, 502]
        assert by_time[0]["xyxyns"] == [[0.1, 0.1, 0.2, 0.2]]
        assert by_time[0]["recorded_at"] == "2026-07-01T10:00:00"

    def test_failed_detection_not_in_detection_results(self, monkeypatch):
        monkeypatch.setattr(
            shared, "create_sequence", lambda url, token, data: {"id": 99}
        )

        def failing_create(url, token, detection_data, source_key):
            raise shared.ValidationError("bad detection", field_errors=[])

        monkeypatch.setattr(shared, "create_detection_from_bucket_key", failing_create)
        records = [make_record(1, "2026-07-01T10:00:00", [BOX])]
        result = shared.post_sequence_to_annotation_api(
            "http://annotation.test", records, "token", max_detection_workers=1
        )
        assert result["failed_detections"] == 1
        assert result["detection_results"] == []


class TestDetection409Recovery:
    def test_409_recovers_existing_detection(self, monkeypatch):
        monkeypatch.setattr(
            shared, "create_sequence", lambda url, token, data: {"id": 99}
        )

        def conflicting_create(url, token, detection_data, source_key):
            raise shared.AnnotationAPIError("already exists", status_code=409)

        monkeypatch.setattr(
            shared, "create_detection_from_bucket_key", conflicting_create
        )

        # Two pages, match on page 2: proves the lookup is scoped to the new
        # sequence and actually paginates instead of matching page 1 only.
        list_calls = []

        def fake_list_detections(url, token, **params):
            list_calls.append(params)
            if params["page"] == 1:
                return {
                    "items": [{"id": 778, "alert_api_id": 2, "sequence_id": 99}],
                    "pages": 2,
                }
            return {
                "items": [{"id": 777, "alert_api_id": 1, "sequence_id": 99}],
                "pages": 2,
            }

        monkeypatch.setattr(shared, "list_detections", fake_list_detections)

        records = [make_record(1, "2026-07-01T10:00:00", [BOX])]
        result = shared.post_sequence_to_annotation_api(
            "http://annotation.test", records, "token", max_detection_workers=1
        )
        assert result["successful_detections"] == 1
        assert result["failed_detections"] == 0
        assert result["detection_results"][0]["annotation_detection_id"] == 777
        assert result["detection_results"][0]["xyxyns"] == [[0.1, 0.1, 0.2, 0.2]]
        assert [call["page"] for call in list_calls] == [1, 2]
        assert all(call["sequence_id"] == 99 for call in list_calls)

    def test_409_with_unfindable_detection_stays_failed(self, monkeypatch):
        monkeypatch.setattr(
            shared, "create_sequence", lambda url, token, data: {"id": 99}
        )

        def conflicting_create(url, token, detection_data, source_key):
            raise shared.AnnotationAPIError("already exists", status_code=409)

        monkeypatch.setattr(
            shared, "create_detection_from_bucket_key", conflicting_create
        )
        monkeypatch.setattr(
            shared,
            "list_detections",
            lambda url, token, **params: {"items": [], "pages": 1},
        )

        records = [make_record(1, "2026-07-01T10:00:00", [BOX])]
        result = shared.post_sequence_to_annotation_api(
            "http://annotation.test", records, "token", max_detection_workers=1
        )
        assert result["successful_detections"] == 0
        assert result["failed_detections"] == 1


class TestSkippedSequenceStats:
    def test_skipped_sequence_counts_as_skipped_not_failed(self, monkeypatch):
        monkeypatch.setattr(
            shared, "get_auth_token", lambda url, username, password: "token"
        )

        def conflicting_sequence(url, token, data):
            raise shared.AnnotationAPIError("duplicate sequence", status_code=409)

        monkeypatch.setattr(shared, "create_sequence", conflicting_sequence)

        records = [
            make_record(1, "2026-07-01T10:00:00", [BOX]),
            make_record(2, "2026-07-01T10:01:00", [BOX]),
        ]
        result = shared.post_records_to_annotation_api(
            "http://annotation.test", records, max_workers=1, max_detection_workers=1
        )
        assert result["skipped_sequences"] == 1
        assert result["skipped_detections"] == 2
        assert result["failed_detections"] == 0
        assert result["failed_sequences"] == 0
        assert result["successful_sequences"] == 0


class TestSuppliedAuthToken:
    """A caller-supplied token must be used verbatim, with no login round-trip.

    The worker self-mints its JWT so that no plaintext annotation-API password
    has to exist in its environment; a token that got silently replaced by an
    env-credential login would defeat that without failing anything.
    """

    def test_supplied_token_is_used_and_no_login_happens(self, monkeypatch):
        def fail_login(*args, **kwargs):
            raise AssertionError("must not log in when a token was supplied")

        monkeypatch.setattr(shared, "get_auth_token", fail_login)

        tokens = []
        monkeypatch.setattr(
            shared,
            "create_sequence",
            lambda url, token, data: tokens.append(token) or {"id": 99},
        )
        monkeypatch.setattr(
            shared,
            "create_detection_from_bucket_key",
            lambda url, token, detection_data, source_key: tokens.append(token)
            or {"id": 501},
        )

        records = [make_record(1, "2026-07-01T10:00:00", [BOX])]
        result = shared.post_records_to_annotation_api(
            "http://annotation.test",
            records,
            max_workers=1,
            max_detection_workers=1,
            auth_token="worker-jwt",
        )
        assert result["successful_sequences"] == 1
        assert tokens == ["worker-jwt", "worker-jwt"]

    def test_without_a_token_it_still_logs_in(self, monkeypatch):
        monkeypatch.setattr(
            shared, "get_annotation_credentials", lambda url: ("u", "p")
        )
        monkeypatch.setattr(
            shared, "get_auth_token", lambda url, username, password: "env-token"
        )
        tokens = []
        monkeypatch.setattr(
            shared,
            "create_sequence",
            lambda url, token, data: tokens.append(token) or {"id": 99},
        )
        monkeypatch.setattr(
            shared,
            "create_detection_from_bucket_key",
            lambda url, token, detection_data, source_key: {"id": 501},
        )

        records = [make_record(1, "2026-07-01T10:00:00", [BOX])]
        shared.post_records_to_annotation_api(
            "http://annotation.test", records, max_workers=1, max_detection_workers=1
        )
        assert tokens == ["env-token"]


class TestTransformSequenceData:
    def test_platform_alert_id_passed_through(self):
        record = make_record(1, "2026-07-01T10:00:00", [BOX])
        record["platform_alert_id"] = 47105
        data = shared.transform_sequence_data(record)
        assert data["platform_alert_id"] == 47105

    def test_platform_alert_id_omitted_when_absent(self):
        record = make_record(1, "2026-07-01T10:00:00", [BOX])
        record.pop("platform_alert_id", None)
        data = shared.transform_sequence_data(record)
        assert "platform_alert_id" not in data
