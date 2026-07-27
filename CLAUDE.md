# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pyro-Annotator is a suite for annotating wildfire detection sequences. It combines a FastAPI backend, a React frontend, and data transfer scripts to collect, manage, and annotate fire detection data from multiple sources.

## Repository Structure

```
pyro-annotator/
├── annotation_api/      # FastAPI backend + data transfer scripts
├── frontend/            # React/TypeScript annotation UI
├── sam_based_bbox_propagation/  # SAM-based semi-automatic bbox tool (Dash, port 8050)
├── docker-compose.yml   # Full stack orchestration
└── Makefile             # Docker build/push targets
```

Each submodule has its own `CLAUDE.md` with detailed context — read those when working within a specific module.

## Quick Start

```bash
# Start all services (PostgreSQL, LocalStack S3, API, Frontend)
docker compose up -d

# Services:
# Frontend:  http://localhost:3000
# API:       http://localhost:5050  (docs at /docs)
# Database:  localhost:5432
# S3:        http://localhost:4566
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

Scripts live in `annotation_api/scripts/data_transfer/ingestion/platform/`. Run from `annotation_api/` with `make` targets.

### TP Pipeline (true positives — fire sequences)

Pull annotated sequences, enrich bboxes with YOLO, visual check, push back.

```bash
cd annotation_api

# 1. Pull seq_annotation_done sequences (remote → local files, marks remote in_review)
make pull-seq-annotations MAX_SEQUENCES=20

# 2. Auto-fill missing bboxes with YOLO model
make auto-annotate

# 3. Visual review in FiftyOne — tag "issue" on bad frames
make visual-check

# 4. Push results: clean → annotated, issue → needs_manual
make apply-review
```

### FP Pipeline (false positives — no fire sequences)

Pull sequences, visually confirm no fire was missed, push back with empty labels.

```bash
cd annotation_api

# 1. Pull seq_annotation_done sequences (separate output dir)
make pull-fp MAX_SEQUENCES=20

# 2. Visual check in FiftyOne — tag "issue" if fire was missed
make visual-check-fp

# 3. Push results: clean → annotated (no labels), issue → needs_manual
make apply-review-fp
```

### Platform Import

Credentials live in `annotation_api/.env` (copy from `.env.example` once). Each data-transfer script loads it at startup via `python-dotenv`; Make does not parse `.env`.

```bash
# Import sequences from platform API (.env must define PLATFORM_LOGIN, PLATFORM_PASSWORD,
# PLATFORM_ADMIN_LOGIN, PLATFORM_ADMIN_PASSWORD, MAIN_ANNOTATION_LOGIN, MAIN_ANNOTATION_PASSWORD)
make import-alert-api DATE_FROM=2024-01-01 DATE_END=2024-01-02
```

The import object-splits each alert sequence from the alert API's own boxes and writes one annotation track per object client-side (no pyro-engine/pyro-dataset involved).

## Key Architecture Concepts

**Backend data flow**: Platform API → ingestion scripts → annotation_api DB → frontend UI → human annotations

**Processing stages** (sequence): `IMPORTED` → `READY_TO_ANNOTATE` → `UNDER_ANNOTATION` → `SEQ_ANNOTATION_DONE` → `IN_REVIEW` → `ANNOTATED`

**Backend patterns**: CRUD modules per entity, Pydantic schemas separate from SQLModel, dependency injection, fastapi-pagination, IoU-based annotation generation service.

**Frontend patterns**: Zustand for client state, TanStack Query for server state, canvas-based bbox drawing utilities, 13+ focused utility modules in `src/utils/`.

## Pre-commit Hooks

```bash
# Hooks run: ruff (format + lint), mypy, prevents commits to main
pre-commit install   # Install hooks
pre-commit run --all-files  # Run manually
```
