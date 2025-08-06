from .crud_detection import DetectionCRUD
from .crud_detection_annotation import DetectionAnnotationCRUD
from .crud_sequence import SequenceCRUD
from .crud_sequence_annotation import SequenceAnnotationCRUD

__all__ = [
    "DetectionCRUD",
    "DetectionAnnotationCRUD",
    "SequenceCRUD",
    "SequenceAnnotationCRUD",
]
