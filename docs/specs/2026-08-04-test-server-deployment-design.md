# Test Server Deployment Design

**Date**: 2026-08-04
**Status**: Approved
**Target**: `ubuntu@162.19.113.48` (hostname `test-anno-migration`, Ubuntu 26.04 LTS, 4 CPU, 7.6 GB RAM, 48 GB disk)

## Goal

Run the full pyro-annotator stack on an internet-facing test server, reachable over
plain HTTP on the raw IP. Short-lived test/staging box: no domain, no TLS, no backups,
no monitoring.

## Decisions

- **Test box, plain HTTP** on `http://162.19.113.48` — no domain or TLS.
- **Fresh, empty database** — Alembic creates the schema on API startup; the bootstrap
  admin user comes from `AUTH_USERNAME`/`AUTH_PASSWORD`.
- **Storage: MinIO first, real S3 bucket later.** An external S3 bucket is being
  provisioned separately; until it is ready the server runs MinIO. Switching is an
  `.env` edit (see below), not a redeploy.
- **Images built on the server** — `git clone` + `docker compose build` on the box.
  No registry involved.

## Architecture

A new standalone compose file, `docker-compose.server.yml`, committed to the repo:

| Service | Host port | Notes |
|---|---|---|
| `postgres` | none | never published on the host |
| `minio` | 4566 | S3 API; needed publicly for presigned image URLs. Console (9001) not published. |
| `minio-init` | none | one-shot bucket bootstrap, as in the dev compose |
| `annotation_api` | 5050 | Alembic migrate + uvicorn, as in the dev compose |
| `worker` | none | procrastinate queue worker |
| `frontend` | 80 | nginx serving the built React app |

All secrets and environment-specific values come from an untracked `.env` next to the
compose file on the server, via compose variable interpolation. A committed
`.env.server.example` documents the required keys:

- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — generated
- `AUTH_USERNAME` / `AUTH_PASSWORD` — bootstrap admin; password generated
- `JWT_SECRET` — generated
- `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` — generated (never `fake`/`fakefake` on a public IP)
- `S3_ENDPOINT_URL` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` / `S3_BUCKET_NAME`
  — point at MinIO for now, at the real bucket later
- `S3_PROXY_URL=http://162.19.113.48:4566` — rewrites presigned URL hosts so browsers
  can load images; only needed while on MinIO
- `VITE_API_BASE_URL` — public API URL baked into the frontend at build time
  (exact path shape confirmed against the frontend config during implementation)

### Switching from MinIO to the real S3 bucket

1. Edit `.env`: set the `S3_*` variables to the real bucket, remove `S3_PROXY_URL`.
2. Remove the `minio`/`minio-init` services (and the API/worker `depends_on` entries
   pointing at them) from `docker-compose.server.yml`.
3. `docker compose -f docker-compose.server.yml up -d` and close port 4566 in ufw.

## Server preparation (one-time)

- Install Ubuntu's own `docker.io` + `docker-compose-v2` packages (Ubuntu 26.04 is too
  new to rely on Docker's upstream apt repo); add `ubuntu` to the `docker` group.
- `ufw`: allow 22 (SSH), 80 (frontend), 5050 (API), 4566 (MinIO, while in use);
  default deny incoming.

## Deployment flow

1. `git clone` the repo on the server (HTTPS).
2. Write `.env` from `.env.server.example` with generated secrets.
3. `docker compose -f docker-compose.server.yml up -d --build`.
4. Iteration loop: SSH in, `git pull`, `up -d --build`.

## Verification

- `curl http://162.19.113.48:5050/status` succeeds from outside.
- Frontend loads at `http://162.19.113.48/`; login with the admin creds works.
- An image round-trips through storage (upload via API, image renders in the UI).

## Out of scope

TLS/domain, backups, monitoring, registry pushes, data migration (DB starts empty;
a dump restore or alert-API import can happen later).
