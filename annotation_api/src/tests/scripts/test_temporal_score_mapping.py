"""Temporal-model score mapping from alert-API payload to sequence payload."""

from scripts.data_transfer.ingestion.alert_api import shared, utils

# No __init__.py convention in src/tests/ — pytest inserts the test dir on
# sys.path, so sibling helpers are imported as top-level modules.
from factories import make_record

CAMERA = {
    "id": 7,
    "name": "cam-01",
    "lat": 44.0,
    "lon": 5.0,
    "organization_id": 1,
    "is_trustable": True,
    "angle_of_view": 87.0,
}
ORGANIZATION = {"id": 1, "name": "org"}
DETECTION = {
    "id": 11,
    "created_at": "2026-08-09T14:22:10",
    "url": "https://img.example/11.jpg",
    "bucket_key": "key/11.jpg",
    "bbox": "[(0.1,0.1,0.2,0.2,0.9)]",
    "others_bboxes": None,
}


def _sequence(**overrides):
    sequence = {
        "id": 48211,
        "camera_id": 7,
        "camera_azimuth": 212.4,
        "started_at": "2026-08-09T14:22:10",
        "last_seen_at": "2026-08-09T14:51:03",
        "is_wildfire": None,
    }
    sequence.update(overrides)
    return sequence


class TestToRecord:
    def test_carries_temporal_fields(self):
        sequence = _sequence(
            temporal_model_score=0.87,
            temporal_model_version="0.1.0",
            temporal_api_version="v1.4.2",
        )
        record = utils.to_record(DETECTION, CAMERA, ORGANIZATION, sequence)
        assert record["sequence_temporal_model_score"] == 0.87
        assert record["sequence_temporal_model_version"] == "0.1.0"
        assert record["sequence_temporal_api_version"] == "v1.4.2"

    def test_absent_temporal_fields_become_none(self):
        """An older alert API omits the keys entirely; must be None, not 0.0."""
        record = utils.to_record(DETECTION, CAMERA, ORGANIZATION, _sequence())
        assert record["sequence_temporal_model_score"] is None
        assert record["sequence_temporal_model_version"] is None
        assert record["sequence_temporal_api_version"] is None

    def test_null_score_stays_none(self):
        sequence = _sequence(temporal_model_score=None)
        record = utils.to_record(DETECTION, CAMERA, ORGANIZATION, sequence)
        assert record["sequence_temporal_model_score"] is None

    def test_zero_score_is_preserved(self):
        """0.0 is a real verdict and must not be flattened to None."""
        sequence = _sequence(temporal_model_score=0.0)
        record = utils.to_record(DETECTION, CAMERA, ORGANIZATION, sequence)
        assert record["sequence_temporal_model_score"] == 0.0


class TestTransformSequenceData:
    def test_maps_temporal_fields_to_payload(self):
        record = make_record(
            1,
            "2026-08-09T14:22:10",
            [[0.1, 0.1, 0.2, 0.2, 0.9]],
            sequence_temporal_model_score=0.87,
            sequence_temporal_model_version="0.1.0",
            sequence_temporal_api_version="v1.4.2",
        )
        data = shared.transform_sequence_data(record)
        assert data["temporal_model_score"] == 0.87
        assert data["temporal_model_version"] == "0.1.0"
        assert data["temporal_api_version"] == "v1.4.2"

    def test_missing_temporal_fields_map_to_none(self):
        record = make_record(1, "2026-08-09T14:22:10", [[0.1, 0.1, 0.2, 0.2, 0.9]])
        data = shared.transform_sequence_data(record)
        assert data["temporal_model_score"] is None
        assert data["temporal_model_version"] is None
        assert data["temporal_api_version"] is None

    def test_zero_score_survives_the_payload(self):
        record = make_record(
            1,
            "2026-08-09T14:22:10",
            [[0.1, 0.1, 0.2, 0.2, 0.9]],
            sequence_temporal_model_score=0.0,
        )
        data = shared.transform_sequence_data(record)
        assert data["temporal_model_score"] == 0.0
