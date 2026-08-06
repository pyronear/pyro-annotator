# Alert API Connector — Design

**Date:** 2026-08-06
**Status:** Approved for planning

## Problem

Importing from an alert API is a manual, per-operator ritual:

```bash
make import-alert-api DATE_FROM=2026-08-05 DATE_END=2026-08-05
```

The script runs on someone's laptop, reads four credentials from
`annotation_api/.env`, and imports whatever the `ALERT_API_LOGIN` account happens
to see. Consequences:

- **Nobody imports daily.** It only happens when a person remembers.
- **Organization scope is implicit.** The account you log in as decides what you
  get. There is no way to say "ingest Ardèche and Gard, not Aveyron".
- **Coverage is invisible.** Nothing records which days were imported for which
  organization, so gaps are found by accident.
- **Adding an alert API means editing `.env` and redeploying.**

## Goal

A *connector*: a stored, credentialed link to one alert API. You plug it in
through the UI, pick which of its organizations to ingest, and the annotation
API imports them daily on its own. The page then shows you, per organization
and per day, what was covered.

The connector page is **configuration and observation, not a control panel** —
there is no "run now" button. Backfill remains a CLI job.

## Architecture

```
┌──────────────┐   verify / discover orgs    ┌───────────────┐
│  Frontend    │ ──────────────────────────▶ │  Annotation   │
│ /connectors  │ ◀────────── coverage ────── │     API       │
└──────────────┘                             └───────┬───────┘
                                                     │ DB
                                             ┌───────▼───────┐
        alert API  ◀───── fetch ──────────── │    Worker     │
                                             │ (procrastinate)│
        annotation API ◀──── POST ────────── └───────────────┘
```

The worker holds the schedule and the import loop. It reuses the existing
importer as a library and posts through the annotation API's own HTTP
endpoints, which already handle image transfer and 409 reconciliation.

## Data model

Three new tables.

### `alert_api_connector`

One row per alert API.

| field | type | notes |
| --- | --- | --- |
| `id` | int PK | |
| `name` | str | e.g. `Pyronear France` |
| `base_url` | str, unique | e.g. `https://alertapi.pyronear.org` |
| `source_api` | `SourceApi` enum, **unique** | see below |
| `login` | str | alert API account (expected to be an admin) |
| `password_encrypted` | str | Fernet token; never returned by the API |
| `is_enabled` | bool | pause without deleting |
| `trailing_days` | int, default 3 | size of the re-imported window |
| `image_transfer` | str \| null | `url` / `bucket-copy` / null = importer's auto-detect |
| `last_verified_at` | datetime \| null | set by the verify action |
| `last_verify_error` | str \| null | |
| `created_at`, `updated_at` | datetime | |

**`source_api` is unique across connectors.** Sequence identity is
`(alert_api_id, source_api)` and alert identity is
`(source_api, platform_alert_id)`; two connectors sharing a `source_api` would
let alert ids from different platforms collide.

Adding a *new* platform stays a code change (enum value + Alembic migration).
`source_api` is referenced throughout the frontend's filters, so making it
free-form has a far larger blast radius than this feature justifies.

### `alert_api_connector_organization`

Organizations discovered on a connector.

| field | type | notes |
| --- | --- | --- |
| `id` | int PK | |
| `connector_id` | FK → connector, cascade delete | |
| `organization_id` | int | the id on the **remote** alert API |
| `name` | str | cached at discovery |
| `is_enabled` | bool, default false | ingest this org or not |
| `enabled_at` | datetime \| null | first time it was enabled |

Unique on `(connector_id, organization_id)`.

### `alert_api_import_coverage`

**One row per heatmap cell.**

| field | type | notes |
| --- | --- | --- |
| `id` | int PK | |
| `connector_id` | FK → connector, cascade delete | |
| `organization_id` | int | remote org id |
| `covered_date` | date | UTC date on the alert API |
| `status` | `ok` / `partial` / `failed` | see below |
| `alerts_fetched` | int | alert-API sequences seen for this org that day |
| `alerts_imported` | int | newly imported |
| `alerts_skipped` | int | already present (short-circuited) |
| `alerts_failed` | int | errored during import |
| `lanes_created` | int | annotation sequences created (object-split fan-out) |
| `error` | str \| null | |
| `last_attempt_at` | datetime | |

Unique on `(connector_id, organization_id, covered_date)`; upserted on every
attempt.

`status` is derived, not free-form:

- `failed` — nothing was imported for this org that day: the connector itself
  errored, or every alert failed.
- `partial` — `alerts_failed > 0` **and** at least one alert imported or skipped.
- `ok` — everything else, including a day with zero alerts.

Two behaviours follow from this shape:

- An org with **zero alerts** that day still gets a row with counts `0` and
  status `ok`. That is what distinguishes "we looked, nothing was there" (grey)
  from "we never got there" (hatched).
- A **connector-level failure** (bad credentials, alert API down) writes
  `failed` rows for *every* enabled org on that date. This is why no separate
  run-history table is needed — failures always have a cell to land in.

Counts are in **alerts** (alert-API sequences), not annotation lanes, because
that is the unit a human reasons about. `lanes_created` records the fan-out
separately.

## Credentials

New `app/services/secrets.py` (~15 lines): `encrypt_secret` / `decrypt_secret`
over `Fernet(settings.CONNECTOR_SECRET_KEY)`. Adds `cryptography` as a
dependency.

- The read schema exposes `has_password: bool`, never the value.
- The write schema accepts `password` only on create or an explicit replace.
- If `CONNECTOR_SECRET_KEY` is unset, connector create/update returns **400**
  with a message naming the variable, and the worker logs and skips affected
  connectors. Existing deployments keep working untouched until someone opts in.

The threat this addresses is a **database dump** — a backup, a copy pulled for
debugging — not an attacker with a shell on the host (who would read the env
too). Losing the key means re-entering credentials through the UI.

**One credential pair, not two.** Today's importer holds a regular login *and*
an admin login. The premise here is that the admin account alone covers both
roles. The verify action tests that premise empirically rather than assuming it
(see *Verify*). If sequence listing turns out to be organization-scoped, the org
table is where per-org credentials would later hang — no reshaping needed.

## Worker: authentication to its own API

The importer POSTs to the annotation API over HTTP. The worker therefore needs
a token — but **not a password**.

`create_access_token` is a pure function over `settings.JWT_SECRET`
(`app/auth/dependencies.py:34`), which the worker already has, and the worker
already resolves the worker user by name (`app/worker.py:159`):

```python
worker_user = await UserCRUD(session).get_by_username(settings.WORKER_USERNAME)
token = create_access_token({"sub": worker_user.username, "user_id": worker_user.id})
```

This avoids a plaintext password in the worker's environment (the exact thing
Fernet encryption exists to prevent), avoids duplicating a credential to talk to
itself, and removes the cold-boot race where the worker starts before the API
seeds its users.

**Known coupling:** the worker user is seeded **inactive** on purpose so login
rejects it (`app/main.py:71`). A minted token works because the sequence and
detection endpoints depend on `get_current_user`, which does not check
`is_active` — only `get_current_active_user` does. A pinning test locks this in
so a future auth tightening fails CI instead of silently breaking nightly
imports.

The only new setting is `ANNOTATION_API_INTERNAL_URL` (`http://api:5050` in
compose), which is not a secret.

## Importer refactor

`scripts/data_transfer/ingestion/alert_api/import.py` is refactored, with **no
behaviour change to the CLI**:

- Extract an `ImportConfig` dataclass and `run_import(config) -> ImportResult`
  holding everything `main()` currently does after argument parsing.
- `main()` becomes: parse argv + read env → build `ImportConfig` → `run_import`
  → render the console summary.

`ImportConfig` gains two fields the CLI does not currently expose:

- `organization_ids: set[int] | None` — restrict to enabled organizations
- `skip_platform_alert_ids: set[int]` — alerts already in the database

`ImportConfig` keeps the importer's existing *two* credential slots (regular and
admin). A connector stores one pair and passes it to both, which is precisely
the premise verify tests; the CLI continues to fill them from the four existing
environment variables.

**Both filters apply immediately after the day's sequence listing, before any
detection fetch.** The camera index (built once from `list_cameras`) resolves
`camera_id → organization_id`, so filtering is a dict lookup.

This is the short-circuit: re-running an already-imported day costs **one
listing call and zero detection calls**. Today the importer discovers "already
exists" only at POST time (`shared.py:554`), after paying for every detection
fetch.

`ImportResult` gains **per-organization counters**; today's statistics are
global only, and the coverage rows need the breakdown.

`risk_score="extreme"` is retained deliberately — it neutralizes the alert API's
FWI filter so low-risk sequences are not dropped.

**Dockerfile:** add `COPY scripts /app/scripts` to the builder stage.
`PYTHONPATH=/app` is already set, and `requests`, `rich`, and `tqdm` are already
main dependencies, so nothing else changes.

## Worker: scheduling and import

Two tasks in `app/worker.py`, following the existing periodic-sweep pattern.

### `schedule_connector_imports` — `@app.periodic(cron="0 3 * * *")`

Fires once a day. Defers one `run_connector_import` job for every enabled
connector that has at least one enabled organization, each with
`queueing_lock=f"connector-import-{id}"` so a still-running connector cannot
have a second job queued behind it.

No "already ran today" bookkeeping is needed: procrastinate defers a periodic
task once per cron period, and the `queueing_lock` covers the overlap case.

**Why not an hourly sweep with a per-connector run hour?** That only buys the
ability to stagger connectors across the night, and it is not what makes the
schedule robust — `trailing_days` is. A worker that is down at 03:00 loses
nothing, because the next day's run re-covers that date inside its window. If
staggering is ever needed (several heavy connectors competing for the same
hour), it is a small change: add `run_at_hour_utc`, move the cron to `0 * * * *`,
and match on the current hour.

The run hour is fixed at deploy time, since `@app.periodic` takes a static cron
expression.

### `run_connector_import(connector_id)`

1. Load the connector and its enabled organizations; decrypt the password (log
   and bail if `CONNECTOR_SECRET_KEY` is missing).
2. Build the skip set in one query:
   `SELECT DISTINCT platform_alert_id FROM sequence WHERE source_api = :src`.
   `platform_alert_id` is the alert API's own sequence id, shared by every lane
   of an alert, and already indexed as `ix_sequence_platform_alert_id`
   (`app/models.py:197`).
3. For each date in `[today − trailing_days, today − 1]` (UTC), call `run_import`
   via `asyncio.to_thread` — the importer is synchronous `requests`, and this
   keeps it off the event loop.
4. Upsert coverage rows per enabled organization from the per-org statistics. On
   a connector-level failure, write `failed` rows for every enabled organization
   on that date.

A manual `make import-alert-api` running concurrently with a scheduled job is
wasteful but not corrupting — both skip alerts that already exist.

## API

All endpoints under `/api/v1/connectors/`, gated by the existing
`get_current_superuser`.

| endpoint | purpose |
| --- | --- |
| `GET /` | list connectors with `has_password`, last import, org counts |
| `POST /` | create |
| `PATCH /{id}` | update; `password` optional |
| `DELETE /{id}` | delete (cascades to orgs and coverage) |
| `POST /{id}/verify` | log in, discover orgs, report reachability |
| `PATCH /{id}/organizations/{org_id}` | toggle `is_enabled` |
| `GET /{id}/coverage?date_from=&date_end=` | heatmap data |

### Verify

Runs in the API process via `asyncio.to_thread` with a timeout, since the user
is waiting on it. It:

1. Authenticates; on failure records `last_verify_error` and returns it.
2. Calls `list_organizations` and **upserts** org rows (idempotent; re-verifying
   never duplicates or resets `is_enabled`).
3. Lists yesterday's sequences with the connector's token, maps
   `camera_id → organization_id` via `list_cameras`, and reports **"saw
   sequences from N of M organizations"**.

Point 3 is how the cross-organization premise gets tested against reality
instead of assumed. It is reported as a count rather than a boolean on purpose:
one organization on a quiet day proves nothing, but 4-of-7 proves cross-org
listing works.

## Frontend

Route `/connectors`, superuser-gated and nav-linked exactly like
`UserManagementPage` (`frontend/src/pages/UserManagementPage.tsx:81`,
`frontend/src/components/layout/AppLayout.tsx:224`). Server state via TanStack
Query; no Zustand needed.

**List page:** name, base URL, `source_api` badge, enabled toggle, last
verified, most recent covered date, and "3 of 7 organizations enabled".

The schedule form carries only `trailing_days`; the daily run hour is deployment
configuration, not per-connector state.

**Detail page**, top to bottom:

1. Credentials and schedule form. The password field renders as *set* with a
   Replace action and is never populated from the server.
2. "Verify & discover organizations" — result banner plus the organization
   checkbox list.
3. **Coverage heatmap**: organizations as rows, days as columns, over a
   selectable window (default 30 days).

Heatmap cell states:

| state | appearance |
| --- | --- |
| imported, count > 0 | green, intensity by volume |
| covered, 0 alerts | grey |
| `partial` | green with a warning marker |
| `failed`, or no row at all | hatched red |
| before the org's `enabled_at` | dashed outline |

`failed` and "no row" share an appearance because both mean *we do not have this
day*; the tooltip distinguishes them, showing the recorded error for `failed`
and "never attempted" otherwise. Hover otherwise shows date, organization, and
counts.

## Testing

**Backend**

- Fernet round-trip; missing `CONNECTOR_SECRET_KEY` → 400 on create.
- CRUD: non-superuser gets 403; the password never appears in any response.
- Verify against a mocked alert API: discovers organizations, upserts
  idempotently without resetting `is_enabled`, records the error on bad
  credentials.
- Coverage: upsert idempotency; a zero-alert day writes `ok`; a connector
  failure writes `failed` for every enabled organization.
- Sweep: defers a job per enabled connector, and skips both disabled connectors
  and connectors with no enabled organizations.
- **Pinning test:** a worker-minted token can POST a sequence (guards the
  inactive-worker-user coupling).
- **Short-circuit test:** `skip_platform_alert_ids` causes **zero** detection
  fetches for already-imported alerts.
- Importer: the CLI's argv/env → `ImportConfig` mapping is unchanged.

**Frontend** (Vitest, under `frontend/tests/`)

- Heatmap renders every cell state, including not-enabled and failed.
- Organization toggle mutation.
- Password field write-only behaviour.
- Superuser gating.

## Risks and open questions

1. **Cross-organization admin listing is unverified.** The design works either
   way; if listing is organization-scoped, only some organizations populate, and
   the fix is per-org credentials on the organization table. Verify reports what
   it actually saw.
2. **`cryptography` becomes a new dependency**, and losing
   `CONNECTOR_SECRET_KEY` means re-entering credentials through the UI.
3. **Enabling an organization does not backfill.** It starts at the next run's
   trailing window; earlier days stay dashed.
4. **Late-arriving frames on an already-imported alert are still never picked
   up.** The skip is whole-alert, matching today's behaviour. Now at least
   visible on the heatmap as a suspiciously low count.

## Out of scope

- A "run now" button.
- Backfill from the UI — `make import-alert-api DATE_FROM=… DATE_END=…` covers
  it, and a date-range picker in a browser is an easy way to launch an enormous
  job by accident.
- Per-organization credentials.
- New `SourceApi` enum values.
- Re-ingesting alerts that already exist.
