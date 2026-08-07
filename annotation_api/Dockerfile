FROM python:3.11-slim-bookworm AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    libmagic1 \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Builder stage
FROM base AS builder

# Copy uv from official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Configure uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Copy dependency files
COPY uv.lock pyproject.toml /app/

# Install dependencies (excluding project itself)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Copy project files
COPY src/alembic.ini /app/alembic.ini
COPY src/migrations /app/migrations
COPY src/app /app/app
# The worker imports the alert-API importer as a library (see app/worker.py).
COPY scripts /app/scripts

# Install project
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Bake the auto-annotate ONNX model into the image (see AUTOANNOTATE_MODEL_PATH)
RUN mkdir -p /app/models \
    && curl -fsSL "https://huggingface.co/pyronear/yolo11s_sensitive-detector/resolve/main/onnx_cpu.tar.gz" \
        -o /tmp/model.tar.gz \
    && tar -xzf /tmp/model.tar.gz -C /app/models \
    && rm /tmp/model.tar.gz

# Test stage (includes dev dependencies)
FROM base AS test

# Copy uv from official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/app" \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Copy virtual environment and app from builder, then install dev dependencies
COPY --from=builder /app /app

# Install dev dependencies for testing
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --group dev

# Runtime stage
FROM base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/app" \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Copy virtual environment and app from builder
COPY --from=builder /app /app

# Expose port
EXPOSE 5050

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5050/status || exit 1

# Default command
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5050"]