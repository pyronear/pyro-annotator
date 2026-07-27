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
  After a failed create the session is rolled back so a lost
  concurrent-boot race on the username unique constraint cannot poison the
  session for the seeding steps that follow.
- If the configured username already belongs to a pre-existing *active*
  account, seeding adopts it but logs a warning — that is almost certainly
  a naming collision with a human user, and sweep attribution would land on
  it.

### 3. Worker task

In `app/worker.py`, the sweep resolves `settings.WORKER_USERNAME` instead of
`settings.AUTH_USERNAME` and passes that user's id to
`assign_ungrouped_sequences`. The not-found fallback (warn + skip the run,
retry next tick) stays unchanged.

### 4. Effect on attribution

The CRUD's create/update paths only auto-record contribution rows at the
ANNOTATED stage (completed human work), so machine-written annotations at
SEQ_ANNOTATION_DONE historically had no attribution at all — the `user_id`
passed in was silently discarded (discovered during the live end-to-end
check of this change). The three machine-writing paths now record a
contribution explicitly via `SequenceAnnotationCRUD.record_contribution`:

- **Sweep inheritance** (a new sequence joins an already-labeled group,
  no human in the loop) → attributed to the **worker user** (or, until
  #181 removes it, to the caller of the manual assign endpoint).
- **Validated-group fan-out** (a human's save propagates their label to
  sibling members) → attributed to the **saving human**: the label is
  their judgment; the machine only copies it.
- **Bulk annotate** → attributed to the **calling human**.

Consequence: contribution rows no longer exclusively mean "completed work
at ANNOTATED" — they also attribute machine-written SEQ_ANNOTATION_DONE
annotations. Contributor lists show "worker" on sweep-inherited
annotations; human contribution counts include group-accelerated
throughput (fan-out, bulk). Historical annotations written before this
change are not backfilled.

The same identity-less pattern existed on the detection side (#195):
`auto_create_detection_annotations` bulk-inserts `DetectionAnnotation`
rows when a human saves a sequence annotation at ANNOTATED, with no
attribution. It now records contributions via
`DetectionAnnotationCRUD.record_contribution`, with these semantics:

- **Rows written directly at ANNOTATED** (FP-only sequences, where the
  empty annotation *is* the final content) → attributed to the **saving
  human**: the detection labels are derived from their sequence-level
  judgment; the machine only materializes it. Same rationale as the
  fan-out case above.
- **Placeholder rows** (VISUAL_CHECK / BBOX_ANNOTATION) → **no
  contribution**: they are empty scaffolding carrying nobody's judgment
  yet. The annotator who later completes them is credited by the
  existing detection-annotation update path.
- The group-assignment sweep writes no detection annotations, so no
  worker-user attribution is needed on the detection side. If a
  detection-annotation path is ever added to the sweep, it must record
  contributions for the worker user explicitly.

As on the sequence side, historical rows are not backfilled.

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
