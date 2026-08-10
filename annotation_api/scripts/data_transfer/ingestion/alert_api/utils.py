""" """

import ast
from pathlib import Path
from typing import Optional

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


def _parse_bbox_string(s: Optional[str]) -> list:
    """Parse an alert-api bbox string into a list of [x1,y1,x2,y2,conf] lists.

    Accepts the canonical wrapped form `"[(x1,y1,x2,y2,conf), ...]"` (what the
    alert API validates against), and is defensive about edge variants such as
    a flat singular tuple `"(x1,y1,x2,y2,conf)"` that might leak through.
    """
    if not s:
        return []
    try:
        parsed = ast.literal_eval(s)
    except (ValueError, SyntaxError):
        return []
    if not isinstance(parsed, (list, tuple)):
        return []
    # Flat 5-element box: wrap as a single-box list.
    if len(parsed) == 5 and all(isinstance(x, (int, float)) for x in parsed):
        return [list(parsed)]
    out = []
    for box in parsed:
        if isinstance(box, (list, tuple)) and len(box) >= 4:
            out.append(list(box))
    return out


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

    # `bbox` = the tracked detection that drives auto-annotation.
    # `others_bboxes` = sibling boxes seen on the same image, kept separate so
    # they can be displayed read-only in the UI without leaking into the
    # auto-generated annotation.
    primary_bboxes = _parse_bbox_string(detection.get("bbox"))
    others_bboxes = _parse_bbox_string(detection.get("others_bboxes"))

    return {
        # Organization metadata
        "organization_id": camera.get("organization_id"),
        "organization_name": organization.get("name"),
        # Camera metadata
        "camera_id": sequence["camera_id"],
        "camera_name": camera.get("name"),
        "camera_lat": camera.get("lat"),
        "camera_lon": camera.get("lon"),
        "camera_is_trustable": camera.get("is_trustable"),
        "camera_angle_of_view": camera.get("angle_of_view"),
        # Sequence metadata
        "sequence_id": sequence["id"],
        "sequence_is_wildfire": sequence.get("is_wildfire"),
        # Platform temporal-model verdict for this sequence's tracked object.
        # `.get` (not `[...]`) because an older alert API omits these keys.
        "sequence_temporal_model_score": sequence.get("temporal_model_score"),
        "sequence_temporal_model_version": sequence.get("temporal_model_version"),
        "sequence_temporal_api_version": sequence.get("temporal_api_version"),
        # "we have no information" is NOT the same as "the platform scored it
        # null". An alert API predating temporal validation omits the key
        # entirely; a refresh must skip such records rather than write NULL
        # over a score captured by an earlier, better-informed run.
        "sequence_temporal_score_unknown": "temporal_model_score" not in sequence,
        "sequence_started_at": sequence["started_at"],
        "sequence_last_seen_at": sequence["last_seen_at"],
        # Camera/pose pointing direction. The alert API also exposes
        # `sequence_azimuth` (the inferred smoke cone direction); we
        # deliberately ignore that one — annotators care about where the
        # camera was looking, not where the smoke is.
        "camera_azimuth": sequence.get("camera_azimuth"),
        # Detection metadata
        "detection_id": detection["id"],
        "detection_created_at": detection["created_at"],
        "detection_azimuth": None,
        "detection_url": detection.get("url"),
        "detection_bboxes": primary_bboxes,
        "detection_others_bboxes": others_bboxes,
        "detection_bucket_key": detection["bucket_key"],
    }
