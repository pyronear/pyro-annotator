# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.

import logging
import time

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi

from app.api.api_v1.router import api_router
from app.core.config import settings
from app.schemas.base import Status

logger = logging.getLogger("uvicorn.error")


app = FastAPI(
    title=settings.PROJECT_NAME,
    description=settings.PROJECT_DESCRIPTION,
    debug=settings.DEBUG,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=None,
    openapi_tags=[
        {
            "name": "detections",
            "description": "Wildfire detection data with algo predictions",
        },
        {
            "name": "sequences",
            "description": "Image sequences from the pyronear platform",
        },
        {
            "name": "detection annotations",
            "description": "Manual annotations for detection data with smoke type classification",
        },
        {
            "name": "sequence annotations",
            "description": "Manual annotations for sequences.",
        },
    ],
)


# Healthcheck
@app.get(
    "/status",
    status_code=status.HTTP_200_OK,
    summary="Healthcheck for the API",
    include_in_schema=False,
)
def get_status() -> Status:
    return Status(status="ok")


# Routing
app.include_router(api_router, prefix=settings.API_V1_STR)


# Middleware
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGIN,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Overrides swagger to include favicon
@app.get("/docs", include_in_schema=False)
def swagger_ui_html():
    return get_swagger_ui_html(
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        title=settings.PROJECT_NAME,
        swagger_favicon_url="https://pyronear.org/img/favicon.ico",
        # Remove schemas from swagger
        swagger_ui_parameters={"defaultModelsExpandDepth": -1},
    )


# OpenAPI config
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    # https://fastapi.tiangolo.com/tutorial/metadata/
    openapi_schema = get_openapi(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        description=settings.PROJECT_DESCRIPTION,
        routes=app.routes,
        license_info={
            "name": "Apache 2.0",
            "url": "http://www.apache.org/licenses/LICENSE-2.0.html",
        },
        contact={
            "name": "API support",
            "email": settings.SUPPORT_EMAIL,
            "url": "https://github.com/pyronear/pyro-annotator/issues",
        },
    )
    openapi_schema["info"]["x-logo"] = {
        "url": "https://pyronear.org/img/logo_letters.png"
    }
    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi  # type: ignore[method-assign]
