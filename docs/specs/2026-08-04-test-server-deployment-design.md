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
- **Storage: OVH Object Storage.** The API and worker write to a bucket
  (`test-annotator`, region `gra`) via an S3 user provisioned for it. MinIO still runs
  alongside, unused by the API, while the import tooling is exercised against it; see
  "Storage history" below.
- **Images built on the server** — `git clone` + `docker compose build` on the box.
  No registry involved.

## Architecture

A new standalone compose file, `docker-compose.server.yml`, committed to the repo:

| Service | Host port | Notes |
|---|---|---|
| `postgres` | none | never published on the host |
| `minio` | 4566 | no longer backs the API; kept published for import-tooling work |
| `minio-init` | none | one-shot bucket bootstrap, as in the dev compose |
| `annotation_api` | 5050 | Alembic migrate + uvicorn, as in the dev compose |
| `worker` | none | procrastinate queue worker |
| `frontend` | 80 | nginx serving the built React app |

The compose project is named `pyro-annotator-server`, deliberately distinct from the
dev `docker-compose.yml`'s `pyro-annotator`. Sharing a project name meant a stray
`docker compose up -d` from the repo root would recreate these same service names in
place with dev config, on top of the server's data volume, reporting nothing as an
orphan. The volumes are pinned to their pre-rename names (`pyro-annotator_*`) so the
running server keeps its data across the rename.

All secrets and environment-specific values come from an untracked `.env` next to the
compose file on the server, via compose variable interpolation. A committed
`.env.server.example` documents the required keys:

- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — generated
- `AUTH_USERNAME` / `AUTH_PASSWORD` — bootstrap admin; password generated
- `JWT_SECRET` — generated
- `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` — generated (never `fake`/`fakefake` on a
  public IP)
- `S3_ENDPOINT_URL` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` / `S3_BUCKET_NAME`
  — the OVH bucket and the S3 user provisioned for it
- `S3_PROXY_URL` — empty against an external bucket; only rewrites presigned URL hosts
  when S3 runs inside the compose network and browsers cannot resolve it
- `VITE_API_BASE_URL` — public API URL baked into the frontend at **build** time, so
  changing it needs `up -d --build`. Required, not defaulted: an empty value overrides
  the Dockerfile ARG and ships a bundle pointing at the visitor's own `localhost:5050`.
- `UVICORN_WORKERS` — process count; also feeds the connection budget in
  `app.core.config`, so it cannot drift from what the pool sizing assumes

Changing bucket or credentials is an `.env` edit plus `up -d`, never a code change
(`VITE_API_BASE_URL` excepted, per above). The bucket itself is provisioned outside
this repo; nothing in the compose project creates it.

### Credential scope and image transfer

The S3 user needs more than the annotation bucket if server-side image copy is used.
`POST /detections` derives its source bucket as
`{PLATFORM_SERVER_NAME}-alert-api-{organisation_id}` and copies with the *same*
credentials against the *same* endpoint. Those platform buckets live in a different
region from `test-annotator`, so a single-endpoint copy cannot reach them regardless of
scope: **run imports against this server with `--image-transfer url`.** A user scoped
to `test-annotator` alone is therefore correct here, and is what credential rotation
should aim for.

### Storage history

The stack shipped with MinIO as interim storage (published on 4566, with
`S3_PROXY_URL` rewriting presigned URLs to the public MinIO address). On 2026-08-07 an
OVH bucket and an S3 user became available, and the API/worker moved to it: `.env`
repointed at the bucket with `S3_PROXY_URL` cleared, and the API/worker `depends_on`
entries pointing at MinIO dropped, since storage is no longer part of this project's
lifecycle. MinIO itself stays published for now — import tooling is still exercised
against it — and is removed once that work concludes. Objects written to MinIO before
the switch were not migrated; that test data was disposable and is being re-imported.

## Server preparation (one-time)

- Install Ubuntu's own `docker.io` + `docker-compose-v2` packages (Ubuntu 26.04 is too
  new to rely on Docker's upstream apt repo); add `ubuntu` to the `docker` group.
- `ufw`: allow 22 (SSH), 80 (frontend), 5050 (API), 4566 (MinIO, while in use);
  default deny incoming.

## Deployment flow

1. `git clone` the repo on the server (HTTPS).
2. Write `.env` from `.env.server.example` with generated secrets and the bucket
   credentials.
3. `docker compose -f docker-compose.server.yml up -d --build`.
4. Iteration loop: SSH in, `git pull`, `up -d --build`.

On the box that predates the `pyro-annotator-server` project name, the first deploy
after the rename needs the old project torn down first — otherwise its containers keep
holding ports 80/5050 while the renamed project tries to bind them:

```bash
docker compose -f docker-compose.server.yml -p pyro-annotator down   # containers only
docker compose -f docker-compose.server.yml up -d --build            # volumes are pinned
```

## Verification

- `curl http://162.19.113.48:5050/status` succeeds from outside.
- Frontend loads at `http://162.19.113.48/`; login with the admin creds works.
- An image round-trips through storage (upload via API, image renders in the UI).

## Out of scope

TLS/domain, backups, monitoring, registry pushes, data migration (DB starts empty;
a dump restore or alert-API import can happen later).
