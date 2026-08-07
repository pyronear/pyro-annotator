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
- **Storage: OVH Object Storage.** The server writes to a real bucket
  (`test-annotator`, region `gra`) via an S3 user provisioned for it. The stack ran
  MinIO as interim storage until 2026-08-07; see "Storage history" below.
- **Images built on the server** — `git clone` + `docker compose build` on the box.
  No registry involved.

## Architecture

A new standalone compose file, `docker-compose.server.yml`, committed to the repo:

| Service | Host port | Notes |
|---|---|---|
| `postgres` | none | never published on the host |
| `annotation_api` | 5050 | Alembic migrate + uvicorn, as in the dev compose |
| `worker` | none | procrastinate queue worker |
| `frontend` | 80 | nginx serving the built React app |

Storage is external (OVH), so no S3 service runs in the compose project.

All secrets and environment-specific values come from an untracked `.env` next to the
compose file on the server, via compose variable interpolation. A committed
`.env.server.example` documents the required keys:

- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — generated
- `AUTH_USERNAME` / `AUTH_PASSWORD` — bootstrap admin; password generated
- `JWT_SECRET` — generated
- `S3_ENDPOINT_URL` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` / `S3_BUCKET_NAME`
  — the OVH bucket and the S3 user provisioned for it
- `S3_PROXY_URL` — empty against a real bucket; only rewrites presigned URL hosts when
  S3 runs inside the compose network and browsers cannot resolve it
- `VITE_API_BASE_URL` — public API URL baked into the frontend at build time
  (exact path shape confirmed against the frontend config during implementation)

Changing bucket or credentials is an `.env` edit plus `up -d`, never a code change.
The bucket itself is provisioned outside this repo; nothing in the compose project
creates it.

### Storage history

The stack shipped with MinIO as interim storage (published on 4566, with
`S3_PROXY_URL` rewriting presigned URLs to the public MinIO address). On 2026-08-07 an
OVH bucket and a scoped S3 user became available and the switch was made as designed:
`.env` repointed at the bucket with `S3_PROXY_URL` cleared, and the `minio` /
`minio-init` services plus their `depends_on` entries and the `minio_data` volume
removed from the compose file. Objects written to MinIO before the switch were not
migrated — the test data was disposable and re-imported. Port 4566 no longer needs to
be open.

## Server preparation (one-time)

- Install Ubuntu's own `docker.io` + `docker-compose-v2` packages (Ubuntu 26.04 is too
  new to rely on Docker's upstream apt repo); add `ubuntu` to the `docker` group.
- `ufw`: allow 22 (SSH), 80 (frontend), 5050 (API); default deny incoming.

## Deployment flow

1. `git clone` the repo on the server (HTTPS).
2. Write `.env` from `.env.server.example` with generated secrets and the bucket
   credentials.
3. `docker compose -f docker-compose.server.yml up -d --build`.
4. Iteration loop: SSH in, `git pull`, `up -d --build`.

## Verification

- `curl http://162.19.113.48:5050/status` succeeds from outside.
- Frontend loads at `http://162.19.113.48/`; login with the admin creds works.
- An image round-trips through storage (upload via API, image renders in the UI).

## Out of scope

TLS/domain, backups, monitoring, registry pushes, data migration (DB starts empty;
a dump restore or alert-API import can happen later).
