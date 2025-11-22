# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from fastapi import APIRouter

from app.api.api_v1.endpoints import (
    cameras,
    detection_annotations,
    detections,
    organizations,
    sequence_annotations,
    sequences,
    source_apis,
    users,
    export
)
from app.auth import endpoints as auth

api_router = APIRouter()

# Authentication endpoints
api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])

# User management endpoints
api_router.include_router(users.router, prefix="/users", tags=["users"])

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
api_router.include_router(cameras.router, prefix="/cameras", tags=["cameras"])
api_router.include_router(
    organizations.router, prefix="/organizations", tags=["organizations"]
)
api_router.include_router(
    source_apis.router, prefix="/source-apis", tags=["source apis"]
)

api_router.include_router(
    export.router,
    prefix="/export",
    tags=["export"]
)
