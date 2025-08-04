# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.

import logging
import time

import asyncpg
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from sqlalchemy import exc

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


# Exception handlers
@app.exception_handler(exc.IntegrityError)
async def integrity_error_handler(request: Request, exc_: exc.IntegrityError):
    """Handle database integrity constraint violations."""
    logger.error(f"Database integrity error: {exc_}")

    # Check if this is an enum validation error
    if isinstance(exc_.orig, asyncpg.InvalidTextRepresentationError):
        error_msg = str(exc_.orig)
        if "invalid input value for enum" in error_msg:
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={"detail": f"Validation error: {error_msg}"},
            )

    # Other integrity errors (unique constraints, foreign keys, etc.)
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "detail": "Resource conflict: this data violates database constraints"
        },
    )


@app.exception_handler(exc.DataError)
async def data_error_handler(request: Request, exc_: exc.DataError):
    """Handle database data validation errors."""
    logger.error(f"Database data error: {exc_}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": f"Data validation error: {exc_}"},
    )


@app.exception_handler(asyncpg.InvalidTextRepresentationError)
async def asyncpg_enum_error_handler(
    request: Request, exc_: asyncpg.InvalidTextRepresentationError
):
    """Handle asyncpg enum validation errors that slip through."""
    logger.error(f"AsyncPG enum validation error: {exc_}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": f"Validation error: {exc_}"},
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
