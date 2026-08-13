# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pyro-Annotator is a suite for annotating wildfire detection sequences. It combines a FastAPI backend, a React frontend, and data transfer scripts to collect, manage, and annotate fire detection data from multiple sources.

## Repository Structure

```
pyro-annotator/
├── annotation_api/      # FastAPI backend + data transfer scripts
├── frontend/            # React/TypeScript annotation UI
├── docker-compose.yml   # Full stack orchestration
└── Makefile             # Docker build/push targets
```

Each submodule has its own `CLAUDE.md` with detailed context — read those when working within a specific module.

## Quick Start

```bash
# Start all services (PostgreSQL, MinIO S3, API, Frontend)
docker compose up -d

# Services:
# Frontend:  http://localhost:3000
# API:       http://localhost:5050  (docs at /docs)
# Database:  localhost:5432
# S3:        http://localhost:4566  (MinIO console: http://localhost:9001)
```

## Backend (`annotation_api/`)

**Stack**: FastAPI, Python 3.11+, uv, PostgreSQL (SQLModel/SQLAlchemy), S3-compatible storage, JWT auth

```bash
cd annotation_api

# Dev environment via Docker
make start          # Start dev containers
make stop           # Stop (preserves data)
make clean          # Remove containers and volumes

# Local dev (requires uv: curl -LsSf https://astral.sh/uv/install.sh | sh)
uv sync --group dev
uv run uvicorn app.main:app --reload --app-dir src

# Quality
make lint           # Format check + ruff + mypy
make fix            # Auto-fix formatting/lint issues

# Tests
make test                                          # Full suite in Docker
make test-specific TEST=tests/test_foo.py::test_bar  # Single test
```

## Frontend (`frontend/`)

**Stack**: React 18, TypeScript, Vite, Tailwind CSS, Zustand, TanStack Query v5, Axios

```bash
cd frontend
npm install
npm run dev          # Dev server at http://localhost:5173

npm run build        # TypeScript compile + Vite build
npm run lint         # ESLint (strict)
npm run type-check   # TypeScript check
npm run quality      # All checks
npm run quality:fix  # Fix all issues
npm run test         # Vitest
```

## Data Transfer Scripts

Scripts live in `annotation_api/scripts/data_transfer/ingestion/alert_api/`. Run from `annotation_api/` with `make` targets.

### Alert API Import

Credentials live in `annotation_api/.env` (copy from `.env.example` once). Each data-transfer script loads it at startup via `python-dotenv`; Make does not parse `.env`.

```bash
# Import sequences from alert API (.env must define ALERT_API_LOGIN, ALERT_API_PASSWORD,
# ALERT_API_ADMIN_LOGIN, ALERT_API_ADMIN_PASSWORD, MAIN_ANNOTATION_LOGIN, MAIN_ANNOTATION_PASSWORD)
make import-alert-api DATE_FROM=2024-01-01 DATE_END=2024-01-02
```

The import object-splits each alert sequence from the alert API's own boxes and writes one annotation track per object client-side (no pyro-engine/pyro-dataset involved).

### Alert Export

```bash
# Pull finished annotation work into a dataset directory
make export-alerts OUTPUT_DIR=outputs/alerts_export
```

Writes `manifest.jsonl` (one line per alert) plus `images/{source_api}/{platform_alert_id}/{detection_id}.jpg`; each frame carries an `image_path` into that tree. Only alerts whose every lane reached `ANNOTATED` are exported. Re-runs are idempotent — the manifest is rewritten and only missing images are downloaded.

### Export QA overlays

```bash
# Draw the exported boxes onto the exported frames for visual review
make render-overlays DATASET_DIR=outputs/alerts_export
```

Writes `<dataset>/overlays/`: one contact sheet per object under `smoke/` and `false_positive/`, a combined sheet per multi-object alert under `multi_object/`, and an `index.csv`. Each cell pairs the full frame with a magnified crop of the box, since exported boxes are often ~0.05% of the frame area. Every smoke lane is rendered plus `FP_SAMPLE` false-positive lanes (round-robin across type combinations). `FP_SAMPLE` caps only the per-object sheets — the multi-object pass always covers every multi-lane alert; `--alerts` and `--mode` (script-only flags) are what bound a run.

## Key Architecture Concepts

**Backend data flow**: Alert API → ingestion scripts → annotation_api DB → frontend UI → human annotations

**Processing stages** (sequence): `IMPORTED` → `READY_TO_ANNOTATE` → `SEQ_ANNOTATION_DONE` → `ANNOTATED`. Two-lane exit: FP-only lanes jump straight to `ANNOTATED` at classify submit; smoke lanes park at `SEQ_ANNOTATION_DONE`, get auto-annotated per alert once every sibling (shared `platform_alert_id`) is classified, and reach `ANNOTATED` via the Smoke Localization submit (see `docs/specs/2026-07-28-smoke-localization-entry-point-design.md`).

**Backend patterns**: CRUD modules per entity, Pydantic schemas separate from SQLModel, dependency injection, fastapi-pagination, IoU-based annotation generation service.

**Frontend patterns**: Zustand for client state, TanStack Query for server state, canvas-based bbox drawing utilities, 13+ focused utility modules in `src/utils/`.

## Pre-commit Hooks

```bash
# Hooks run: ruff (format + lint), mypy, prevents commits to main
pre-commit install   # Install hooks
pre-commit run --all-files  # Run manually
```
