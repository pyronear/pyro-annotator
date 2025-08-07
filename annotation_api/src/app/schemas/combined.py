# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from typing import Optional
from pydantic import Field

from app.schemas.sequence import SequenceRead
from app.schemas.sequence_annotations import SequenceAnnotationRead

__all__ = [
    "SequenceWithAnnotationRead",
]


class SequenceWithAnnotationRead(SequenceRead):
    """Extended sequence response including complete annotation data."""
    
    annotation: Optional[SequenceAnnotationRead] = Field(
        default=None,
        description="Complete sequence annotation data including processing stage, smoke classification, false positives, and annotation details. None if no annotation exists."
    )