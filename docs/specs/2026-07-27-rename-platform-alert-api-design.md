# Deep rename: platform → alert-api across the ingestion scripts

**Issue:** #175
**Date:** 2026-07-27
**Status:** Approved

## Problem

The upstream service the ingestion scripts talk to is the **alert API**. "The
platform" properly means the firefighter-facing frontend, so the historical
"platform" naming throughout the ingestion tooling is a misnomer. The import
consolidation (#167 / PR #177) renamed only the surfaces it touched (CLI flags,
the `import-alert-api` Make target, rewritten docs). Everything else still says
"platform":

- the module directory `annotation_api/scripts/data_transfer/ingestion/platform/`
  (26 files), referenced by 14 Makefile module paths and 4 internal cross-imports
- the `PLATFORM_LOGIN` / `PLATFORM_PASSWORD` / `PLATFORM_ADMIN_LOGIN` /
  `PLATFORM_ADMIN_PASSWORD` env vars, read in `shared.py`, `import.py`, and
  `pull_sequence_annotations.py`, documented in `.env.example`, the Makefile,
  both CLAUDE.md files, README, and the data-ingestion guide
- ~240 case-insensitive "platform" mentions inside the scripts (docstrings,
  comments, local variables such as `platform_login`, log labels such as the
  importer's debug `Platform:` line)

## Design

The rename lands atomically in one PR, in four parts.

### 1. Directory move

`git mv annotation_api/scripts/data_transfer/ingestion/platform`
→ `annotation_api/scripts/data_transfer/ingestion/alert_api`.

Update the 4 internal cross-imports, the 14
`scripts.data_transfer.ingestion.platform.*` module paths in
`annotation_api/Makefile`, and every docs reference to the path. Script
filenames inside the directory are unchanged.

### 2. Env var rename with fallback

Canonical names become `ALERT_API_LOGIN`, `ALERT_API_PASSWORD`,
`ALERT_API_ADMIN_LOGIN`, `ALERT_API_ADMIN_PASSWORD`.

A small helper in `shared.py` reads the new name first and falls back to the
matching `PLATFORM_*` name, logging a deprecation warning when the fallback is
used (e.g. `PLATFORM_LOGIN is deprecated; rename it to ALERT_API_LOGIN`).
Existing deployed `.env` files keep working unchanged. All three readers
(`shared.py`, `import.py`, `pull_sequence_annotations.py`) go through the
helper. `.env.example` switches to the new names.

`MAIN_ANNOTATION_*` vars are unrelated and unchanged.

### 3. Deep identifier sweep

Across the script files that mention "platform": rename internal variables
(`platform_login` → `alert_api_login`), function/parameter names, docstrings,
and log/debug labels (`Platform:` → `Alert API:`). Prose wording becomes
"alert API".

Justified survivors: comments that genuinely refer to the backend app setting
`PLATFORM_SERVER_NAME` (e.g. in `import.py`) keep that literal name.

### 4. Docs sweep

`README.md`, both `CLAUDE.md` files, and
`annotation_api/docs/data-ingestion-guide.md` get the path, env-var, and
wording updates. Historical spec documents under `docs/specs/` are a record of
past decisions and stay untouched.

## Out of scope

- `PLATFORM_SERVER_NAME` in `annotation_api/src/app/core/config.py` — deployed
  backend app config, not an ingestion-script concern; renaming it would touch
  production deployment env.
- The frontend.
- Removing the `PLATFORM_*` fallback (a later cleanup once deployed `.env`
  files have migrated).

## Verification

- `make lint` output identical to main (17 pre-existing formatting failures in
  unrelated files are a known baseline; files touched by this change pass
  cleanly).
- Every renamed Makefile entry point resolves: `uv run python -m
  scripts.data_transfer.ingestion.alert_api.<module> --help` for each target's
  module.
- `grep -ri platform annotation_api/scripts/` returns only the justified
  survivors listed above.
- Fallback check: with only `PLATFORM_*` set, credential loading succeeds and
  logs the deprecation warning.
- End-to-end smoke test with a locally renamed `.env` (`ALERT_API_*` names):
  `make import-alert-api` authenticates successfully.
