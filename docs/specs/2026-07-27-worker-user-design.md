# Dedicated Worker User for Automatic Group Assignment

**Date**: 2026-07-27
**Status**: Approved
**Issue**: #178

## Problem

The periodic `assign_sequence_groups` worker task attributes inherited
annotations to the admin user seeded from `AUTH_USERNAME` (`app/worker.py`,
with the value pinned in the worker service's compose environment). Two
drawbacks:

- Inherited annotations are indistinguishable from the human admin's work in
  contribution counts and contributor UI.
- The worker reuses an auth setting (`AUTH_USERNAME`) for something that has
  nothing to do with authentication, and the compose pin exists only to keep
  the two services accidentally aligned.

## Decision

Seed a dedicated, login-disabled `worker` user in the API's startup lifespan
(next to the existing admin seeding) and attribute the sweep's inherited
annotations to it.

Decisions made during design:

- **Seeding location: API startup lifespan.** Same idempotent get-or-create
  pattern as the admin user. Boot order is already guaranteed in compose:
  the worker service has `depends_on: annotation_api: condition:
  service_healthy`, and the API's healthcheck only passes after the lifespan
  completes. The sweep's existing "user not found → warn and skip this run"
  fallback covers deployments without that ordering.
- **No login.** The worker user exists purely for attribution. It is seeded
  with `is_active=False` and a random, immediately-discarded password
  (`secrets.token_urlsafe(32)` run through the normal bcrypt hashing —
  `hashed_password` is a required column). Login is doubly impossible:
  unknowable password and inactive account. No password env var exists; a
  credential that doesn't exist can't leak or need rotation. If the need
  ever arises, an admin can set a password and activate the user via the
  existing user management.
- **No HTTP involved.** The worker never calls the API — it invokes the
  shared service (`assign_ungrouped_sequences`) directly with a DB session
  and only needs the worker user's row id for the `labeled_by_user_id` /
  contribution foreign keys. (The manual `POST /sequence_groups/assign`
  endpoint keeps attributing to the calling user's JWT identity; its
  deprecation is tracked separately in #181.)

## Design

### 1. Config

- New setting `WORKER_USERNAME` in `app/core/config.py`, default `"worker"`,
  read from the environment like the other auth settings.
- It is an identity, not a secret. It only needs overriding if a deployment
  wants a different username, and must then match on API and worker.
- The `AUTH_USERNAME` pin on the worker service in `docker-compose.yml`
  (added in #173) is removed — the worker no longer reads `AUTH_USERNAME`.

### 2. Seeding (API lifespan)

In `main.py`, immediately after the admin-user seeding block:

- `UserCRUD.get_by_username(settings.WORKER_USERNAME)`; if present, done.
- Otherwise create via the existing `create_user` path with:
  - `username=settings.WORKER_USERNAME`
  - `password=secrets.token_urlsafe(32)` (local variable, discarded after
    hashing; never logged or stored)
  - `is_active=False`
  - `is_superuser=False`
- Failures are logged and non-fatal, matching the admin seeding's behavior.

### 3. Worker task

In `app/worker.py`, the sweep resolves `settings.WORKER_USERNAME` instead of
`settings.AUTH_USERNAME` and passes that user's id to
`assign_ungrouped_sequences`. The not-found fallback (warn + skip the run,
retry next tick) stays unchanged.

### 4. Effect on attribution

Inherited annotations (and their contribution records) are attributed to
"worker", cleanly separated from human work in contribution counts and any
contributor UI. Historical annotations already attributed to the admin are
not migrated.

### 5. Testing

- Lifespan seeding: after app startup, the worker user exists with
  `is_active=False` and `is_superuser=False`; seeding is idempotent (second
  startup does not create a duplicate); login as the worker user fails.
- Worker task: attribution of inherited annotations goes to the worker
  user's id (the existing service tests pass `user_id` explicitly and are
  unaffected).

## Out of scope

- Migrating historical admin-attributed annotations.
- Any UI changes.
- Endpoint deprecation/removal (#181) and Sentry observability (#180).
