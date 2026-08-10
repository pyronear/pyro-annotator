"""The import's 409 branch refreshes temporal columns instead of skipping."""

from unittest.mock import patch

import pytest

from app.clients.annotation_api import AnnotationAPIError
from scripts.data_transfer.ingestion.alert_api import shared

# No __init__.py convention in src/tests/ — pytest inserts the test dir on
# sys.path, so sibling helpers are imported as top-level modules.
from factories import make_record

BOX = [0.1, 0.1, 0.2, 0.2, 0.9]


def _records(**overrides):
    return [make_record(1, "2026-08-09T14:22:10", [BOX], **overrides)]


def _conflict():
    exc = AnnotationAPIError("exists")
    exc.status_code = 409
    return exc


class TestRefreshOn409:
    def test_409_patches_the_temporal_columns(self):
        records = _records(
            sequence_temporal_model_score=0.87,
            sequence_temporal_model_version="0.2.0",
            sequence_temporal_api_version="0.3.1",
        )

        with patch.object(shared, "create_sequence", side_effect=_conflict()):
            with patch.object(
                shared, "update_sequence_temporal_score", return_value={"id": 1}
            ) as mock_patch:
                result = shared.post_sequence_to_annotation_api(
                    "http://api", records, auth_token="t", source_api="pyronear_french"
                )

        assert result["skipped"] is True
        assert result["refreshed"] is True
        sent = mock_patch.call_args[0][2]
        assert sent["alert_api_id"] == records[0]["sequence_id"]
        assert sent["source_api"] == "pyronear_french"
        assert sent["temporal_model_score"] == 0.87
        assert sent["temporal_model_version"] == "0.2.0"
        assert sent["temporal_api_version"] == "0.3.1"

    def test_sibling_refresh_sends_explicit_nulls(self):
        """A sibling's correct value is NULL; the key must be present and null,
        never omitted, or a stale score would survive."""
        records = _records(
            sequence_temporal_model_score=None,
            sequence_temporal_model_version=None,
            sequence_temporal_api_version=None,
        )

        with patch.object(shared, "create_sequence", side_effect=_conflict()):
            with patch.object(
                shared, "update_sequence_temporal_score", return_value={"id": 1}
            ) as mock_patch:
                shared.post_sequence_to_annotation_api(
                    "http://api", records, auth_token="t", source_api="pyronear_french"
                )

        sent = mock_patch.call_args[0][2]
        assert "temporal_model_score" in sent
        assert sent["temporal_model_score"] is None
        assert sent["temporal_model_version"] is None
        assert sent["temporal_api_version"] is None

    def test_failed_refresh_is_reported_not_raised(self):
        """A refresh failure must not abort the run, but must be visible."""
        failure = AnnotationAPIError("boom")
        failure.status_code = 500

        with patch.object(shared, "create_sequence", side_effect=_conflict()):
            with patch.object(
                shared, "update_sequence_temporal_score", side_effect=failure
            ):
                result = shared.post_sequence_to_annotation_api(
                    "http://api",
                    _records(),
                    auth_token="t",
                    source_api="pyronear_french",
                )

        assert result["skipped"] is True
        assert result["refreshed"] is False

    def test_non_409_errors_still_raise(self):
        boom = AnnotationAPIError("nope")
        boom.status_code = 500
        with patch.object(shared, "create_sequence", side_effect=boom):
            with pytest.raises(AnnotationAPIError):
                shared.post_sequence_to_annotation_api(
                    "http://api",
                    _records(),
                    auth_token="t",
                    source_api="pyronear_french",
                )


class TestRefreshAggregation:
    def test_refreshed_and_failed_counts_reach_the_caller(self):
        """A backfill run must be distinguishable from a no-op, so the counts
        have to survive aggregation rather than dying in the worker."""
        records = [
            make_record(1, "2026-08-09T14:00:00", [BOX], sid=1),
            make_record(2, "2026-08-09T14:01:00", [BOX], sid=2),
        ]

        def fake_refresh(_base_url, _token, payload):
            # Keyed off the payload, not call order: the workers run in a
            # thread pool, so a side_effect list would be nondeterministic.
            if payload["alert_api_id"] == 2:
                failure = AnnotationAPIError("boom")
                failure.status_code = 500
                raise failure
            return {"id": 1}

        with patch.object(shared, "get_auth_token", return_value="t"):
            with patch.object(shared, "create_sequence", side_effect=_conflict()):
                with patch.object(
                    shared, "update_sequence_temporal_score", side_effect=fake_refresh
                ):
                    result = shared.post_records_to_annotation_api(
                        "http://api", records, source_api="pyronear_french"
                    )

        assert result["skipped_sequences"] == 2
        assert result["refreshed_sequences"] == 1
        assert result["refresh_failures"] == 1

    def test_counts_are_zero_when_nothing_was_posted(self):
        result = shared.post_records_to_annotation_api("http://api", [])
        assert result["refreshed_sequences"] == 0
        assert result["refresh_failures"] == 0
