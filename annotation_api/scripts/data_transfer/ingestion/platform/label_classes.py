"""
Shared YOLO class registry for the TP review pipeline label files.

The class integer written in ``seq_*/labels/*.txt`` is a contract between
``pull_sequence_annotations.py``, ``auto_annotate.py``,
``visual_check_fiftyone.py`` and ``apply_fiftyone_review.py``:

- ids 0-2: smoke objects, one id per ``SmokeType`` value
- ids 3+:  false-positive objects, one id per ``FalsePositiveType`` value,
  named ``fp_<type>``

Ids are persisted in label files across pipeline runs: both lists are
append-only and must never be reordered. A sync test
(``src/tests/scripts/test_label_classes.py``) guards them against the app
enums.
"""

from typing import Optional

FP_CLASS_PREFIX = "fp_"

SMOKE_CLASSES = ["wildfire", "industrial", "other"]

FP_CLASSES = [
    "fp_antenna",
    "fp_building",
    "fp_cliff",
    "fp_dark",
    "fp_dust",
    "fp_high_cloud",
    "fp_low_cloud",
    "fp_lens_flare",
    "fp_lens_droplet",
    "fp_light",
    "fp_rain",
    "fp_trail",
    "fp_road",
    "fp_sky",
    "fp_tree",
    "fp_water_body",
    "fp_other",
    "fp_unlabeled",
]

CLASS_NAMES = SMOKE_CLASSES + FP_CLASSES
CLASS_ID = {name: idx for idx, name in enumerate(CLASS_NAMES)}
FP_CLASS_ID_START = len(SMOKE_CLASSES)

FP_FALLBACK_CLASS = "fp_unlabeled"


def is_fp_class_id(class_id: int) -> bool:
    return class_id >= FP_CLASS_ID_START


def class_id_to_name(class_id: int) -> Optional[str]:
    """Name for a persisted class id, or None for an unknown id."""
    if 0 <= class_id < len(CLASS_NAMES):
        return CLASS_NAMES[class_id]
    return None


def smoke_class_name(smoke_type: Optional[str]) -> str:
    """YOLO class name for a smoke object (unknown/missing types map to wildfire)."""
    return smoke_type if smoke_type in SMOKE_CLASSES else SMOKE_CLASSES[0]


def fp_class_name(fp_type: Optional[str]) -> str:
    """YOLO class name for a false-positive object (unknown/missing types map to fp_unlabeled)."""
    name = f"{FP_CLASS_PREFIX}{fp_type}" if fp_type else FP_FALLBACK_CLASS
    return name if name in CLASS_ID else FP_FALLBACK_CLASS


def fp_type_from_class_name(name: str) -> str:
    """FalsePositiveType value encoded in an ``fp_*`` class name."""
    return name[len(FP_CLASS_PREFIX) :]
