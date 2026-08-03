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
        monkeypatch.setattr(
            shared,
            "list_detections",
            lambda url, token, **params: {
                "items": [
                    {"id": 777, "alert_api_id": 1, "sequence_id": 99},
                    {"id": 778, "alert_api_id": 2, "sequence_id": 99},
                ],
                "pages": 1,
            },
        )

        records = [make_record(1, "2026-07-01T10:00:00", [BOX])]
        result = shared.post_sequence_to_annotation_api(
            "http://annotation.test", records, "token", max_detection_workers=1
        )
        assert result["successful_detections"] == 1
        assert result["failed_detections"] == 0
        assert result["detection_results"][0]["annotation_detection_id"] == 777
        assert result["detection_results"][0]["xyxyns"] == [[0.1, 0.1, 0.2, 0.2]]

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
