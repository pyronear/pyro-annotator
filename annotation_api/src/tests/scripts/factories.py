"""Record factories for alert-api-ingestion script tests."""


def make_record(det_id, created_at, bboxes, others=None, sid=47105, **overrides):
    """An alert-api record as produced by utils.to_record (boxes already parsed)."""
    record = {
        "organization_id": 1,
        "organization_name": "org",
        "camera_id": 7,
        "camera_name": "cam-01",
        "camera_lat": 44.0,
        "camera_lon": 5.0,
        "camera_is_trustable": True,
        "camera_angle_of_view": 87.0,
        "sequence_id": sid,
        "sequence_is_wildfire": "wildfire_smoke",
        "sequence_started_at": "2026-07-01T10:00:00",
        "sequence_last_seen_at": "2026-07-01T10:30:00",
        "camera_azimuth": 100.0,
        "detection_id": det_id,
        "detection_created_at": created_at,
        "detection_azimuth": None,
        "detection_url": f"https://img.example/{det_id}.jpg",
        "detection_bboxes": bboxes,
        "detection_others_bboxes": others or [],
        "detection_bucket_key": f"key/{det_id}.jpg",
    }
    record.update(overrides)
    return record
