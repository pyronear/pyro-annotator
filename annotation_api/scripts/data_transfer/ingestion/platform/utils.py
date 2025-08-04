""" """

from pathlib import Path

import yaml


class MyDumper(yaml.Dumper):
    """Formatter for dumping yaml."""

    def increase_indent(self, flow=False, indentless=False):
        return super(MyDumper, self).increase_indent(flow, False)


def yaml_read(path: Path) -> dict:
    """Returns yaml content as a python dict."""
    with open(path, "r") as f:
        return yaml.safe_load(f)


def yaml_write(to: Path, data: dict, dumper=MyDumper) -> None:
    """Writes a `data` dictionnary to the provided `to` path."""
    with open(to, "w") as f:
        yaml.dump(
            data=data,
            stream=f,
            Dumper=dumper,
            default_flow_style=False,
            sort_keys=False,
        )


def index_by(xs: list[dict], key: str) -> dict[str, dict]:
    """
    Index a collection of dicts `xs` by the provided `key`.
    """
    return {x[key]: x for x in xs}


def to_record(
    detection: dict,
    camera: dict,
    organization: dict,
    sequence: dict,
) -> dict:
    """
    Convert detection, camera, organization, and sequence data into a structured record.

    Parameters:
        detection (dict): Information about the detection including metadata.
        camera (dict): Information about the camera that captured the detection.
        organization (dict): Information about the organization managing the camera.
        sequence (dict): Information about the sequence of detections.

    Returns:
        dict: A structured record containing relevant metadata for the detection.
    """

    return {
        # Organization metadata
        "organization_id": camera["organization_id"],
        "organization_name": organization["name"],
        # Camera metadata
        "camera_id": sequence["camera_id"],
        "camera_name": camera["name"],
        "camera_lat": camera["lat"],
        "camera_lon": camera["lon"],
        "camera_is_trustable": camera["is_trustable"],
        "camera_angle_of_view": camera["angle_of_view"],
        # Sequence metadata
        "sequence_id": sequence["id"],
        "sequence_is_wildfire": sequence["is_wildfire"],
        "sequence_started_at": sequence["started_at"],
        "sequence_last_seen_at": sequence["last_seen_at"],
        "sequence_azimuth": sequence["azimuth"],
        # Detection metadata
        "detection_id": detection["id"],
        "detection_created_at": detection["created_at"],
        "detection_azimuth": detection["azimuth"],
        "detection_url": detection["url"],
        "detection_bboxes": detection["bboxes"],
        "detection_bucket_key": detection["bucket_key"],
    }
