# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from fastapi import APIRouter

from app.api.api_v1.endpoints import (
    detection_annotations,
    detections,
    sequence_annotations,
    sequences,
)

api_router = APIRouter(redirect_slashes=True)

api_router.include_router(detections.router, prefix="/detections", tags=["detections"])
api_router.include_router(
    detection_annotations.router,
    prefix="/annotations/detections",
    tags=["detection annotations"],
)
api_router.include_router(sequences.router, prefix="/sequences", tags=["sequences"])
api_router.include_router(
    sequence_annotations.router,
    prefix="/annotations/sequences",
    tags=["sequence annotations"],
)
