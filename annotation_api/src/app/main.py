# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.

import logging
import time
import traceback

import asyncpg
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from fastapi_pagination import add_pagination
from pydantic import ValidationError
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


# Helper function to make objects JSON serializable
def make_json_serializable(obj):
    """Recursively convert an object to be JSON serializable."""
    import json

    if isinstance(obj, dict):
        # For dictionaries, recursively process all values
        return {key: make_json_serializable(value) for key, value in obj.items()}
    elif isinstance(obj, (list, tuple)):
        # For lists/tuples, recursively process all items
        return [make_json_serializable(item) for item in obj]
    else:
        # For individual values, test if they're JSON serializable
        try:
            json.dumps(obj)
            return obj
        except (TypeError, ValueError):
            # If not serializable, convert to string
            return str(obj)


# Handle FastAPI's built-in validation errors (422)
@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    request: Request, exc_: RequestValidationError
):
    """Handle request validation errors with detailed logging."""
    # Extract request details for logging
    request_info = {
        "method": request.method,
        "url": str(request.url),
        "path": request.url.path,
        "query_params": dict(request.query_params),
    }

    # Format validation errors for logging
    errors = exc_.errors()
    formatted_errors = []
    for error in errors:
        error_detail = {
            "field": " -> ".join(str(loc) for loc in error.get("loc", [])),
            "message": error.get("msg", ""),
            "type": error.get("type", ""),
            "input": str(error.get("input", "")),  # Convert to string for logging
        }
        formatted_errors.append(error_detail)

    logger.error(
        f"Request validation failed (422): {request_info['method']} {request_info['path']}\n"
        f"Request details: {request_info}\n"
        f"Validation errors: {formatted_errors}"
    )

    # Create JSON-serializable error list for response
    serializable_errors = [make_json_serializable(error) for error in errors]

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": serializable_errors},
    )


# Handle Pydantic validation errors (422)
@app.exception_handler(ValidationError)
async def validation_error_handler(request: Request, exc_: ValidationError):
    """Handle Pydantic validation errors with detailed logging."""
    request_info = {
        "method": request.method,
        "url": str(request.url),
        "path": request.url.path,
    }

    logger.error(
        f"Pydantic validation failed (422): {request_info['method']} {request_info['path']}\n"
        f"Validation errors: {exc_.errors()}"
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc_.errors()},
    )


# Handle all HTTPException errors with logging
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc_: HTTPException):
    """Handle HTTP exceptions with appropriate logging."""
    request_info = {
        "method": request.method,
        "url": str(request.url),
        "path": request.url.path,
        "status_code": exc_.status_code,
    }

    # Choose log level based on status code
    if exc_.status_code >= 500:
        logger.error(
            f"HTTP {exc_.status_code} error: {request_info['method']} {request_info['path']}\n"
            f"Detail: {exc_.detail}"
        )
    elif exc_.status_code >= 400:
        logger.warning(
            f"HTTP {exc_.status_code} error: {request_info['method']} {request_info['path']}\n"
            f"Detail: {exc_.detail}"
        )
    else:
        logger.info(
            f"HTTP {exc_.status_code}: {request_info['method']} {request_info['path']}\n"
            f"Detail: {exc_.detail}"
        )

    return JSONResponse(
        status_code=exc_.status_code,
        content={"detail": exc_.detail},
    )


@app.exception_handler(exc.IntegrityError)
async def integrity_error_handler(request: Request, exc_: exc.IntegrityError):
    """Handle database integrity constraint violations with detailed logging."""
    request_info = {
        "method": request.method,
        "url": str(request.url),
        "path": request.url.path,
    }

    # Log full error details including SQL statement if available
    logger.error(
        f"Database integrity error at {request_info['method']} {request_info['path']}\n"
        f"Error type: {type(exc_.orig).__name__}\n"
        f"Error message: {exc_.orig}\n"
        f"SQL statement: {exc_.statement if hasattr(exc_, 'statement') else 'N/A'}\n"
        f"Parameters: {exc_.params if hasattr(exc_, 'params') else 'N/A'}"
    )

    # Check if this is an enum validation error
    if isinstance(exc_.orig, asyncpg.InvalidTextRepresentationError):
        error_msg = str(exc_.orig)
        if "invalid input value for enum" in error_msg:
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={"detail": "Invalid field value provided"},
            )

    # Other integrity errors (unique constraints, foreign keys, etc.)
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "Resource already exists"},
    )


@app.exception_handler(exc.DataError)
async def data_error_handler(request: Request, exc_: exc.DataError):
    """Handle database data validation errors with detailed logging."""
    request_info = {
        "method": request.method,
        "url": str(request.url),
        "path": request.url.path,
    }

    logger.error(
        f"Database data error at {request_info['method']} {request_info['path']}\n"
        f"Error type: {type(exc_.orig).__name__}\n"
        f"Error message: {exc_.orig}\n"
        f"SQL statement: {exc_.statement if hasattr(exc_, 'statement') else 'N/A'}\n"
        f"Parameters: {exc_.params if hasattr(exc_, 'params') else 'N/A'}"
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Invalid data format provided"},
    )


@app.exception_handler(asyncpg.InvalidTextRepresentationError)
async def asyncpg_enum_error_handler(
    request: Request, exc_: asyncpg.InvalidTextRepresentationError
):
    """Handle asyncpg enum validation errors that slip through."""
    request_info = {
        "method": request.method,
        "url": str(request.url),
        "path": request.url.path,
    }

    logger.error(
        f"AsyncPG enum validation error at {request_info['method']} {request_info['path']}\n"
        f"Error details: {exc_}"
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Invalid field value provided"},
    )


# Catch-all handler for unhandled exceptions
@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc_: Exception):
    """Handle all unhandled exceptions with full stack trace logging."""
    request_info = {
        "method": request.method,
        "url": str(request.url),
        "path": request.url.path,
    }

    # Get the full stack trace
    stack_trace = traceback.format_exc()

    logger.error(
        f"Unhandled exception at {request_info['method']} {request_info['path']}\n"
        f"Exception type: {type(exc_).__name__}\n"
        f"Exception message: {str(exc_)}\n"
        f"Stack trace:\n{stack_trace}"
    )

    # Return a generic error to the client (don't expose internal details)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An internal server error occurred"},
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

    # Add JWT Bearer authentication security scheme
    openapi_schema["components"]["securitySchemes"] = {
        "bearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Enter your JWT token obtained from the /api/v1/auth/login endpoint",
        }
    }

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi  # type: ignore[method-assign]

# Add pagination support
add_pagination(app)
