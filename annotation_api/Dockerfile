FROM tiangolo/uvicorn-gunicorn-fastapi:python3.9-alpine3.14

WORKDIR /app

# set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV PYTHONPATH "${PYTHONPATH}:/app"

COPY pyproject.toml /app/pyproject.toml
COPY uv.lock /app/uv.lock

# install dependencies
RUN set -eux \
    && apk add --no-cache curl libmagic \
    && pip install --no-cache-dir uv \
    && uv sync --no-cache \
    && rm -rf /root/.cache

# copy project
COPY alembic.ini /app/alembic.ini
COPY src/app /app/app
