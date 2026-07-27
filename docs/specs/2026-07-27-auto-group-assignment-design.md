# Automatic Sequence-Group Assignment

**Date**: 2026-07-27
**Status**: Approved

## Problem

Sequence-group assignment currently only runs when an operator triggers it: the
import scripts (`import_filtered.py`, `import_predictor_split.py`) chain a call
to `POST /sequence_groups/assign` as their final step, and `make
pull-seq-annotations` chains `make assign-groups`. The plain `make
import-platform` path never triggers it at all, so freshly imported sequences
show "no group" in the UI until someone remembers to run `make assign-groups`.

Goal: no human ever runs a make command (or clicks anything) for grouping.
Assignment happens automatically within minutes of data being imported.

## Decision

A **periodic procrastinate task** running in the existing `worker` container
sweeps for ungrouped, fully-imported sequences every 5 minutes and runs the
existing assignment logic over them.

Approaches considered and rejected:

- **Event-driven defer from the API** (defer a job when detections are
  uploaded): faster, but hooks the detection-upload hot path, still needs a
  completion heuristic, and adds a second trigger path. Minutes-scale latency
  is acceptable, so the complexity buys nothing.
- **Frontend button**: still requires a human; kept off the table as the
  primary mechanism. The manual endpoint survives, so a button can be added
  later at near-zero cost.

## Design

### 1. Trigger: periodic worker task

- New procrastinate task `assign_sequence_groups` in `app/worker.py`,
  registered with procrastinate's periodic/cron support: `*/5 * * * *`.
- Runs in the existing `worker` container (same image, same command). No new
  services and no docker-compose changes.
- Procrastinate's periodic mechanism guarantees at most one queued instance
  per tick; missed ticks are harmless because assignment is idempotent.

### 2. Completion gate: annotation row exists

The sweep only considers sequences where:

- `sequence_group_id IS NULL` (as today), and
- `is_group_excluded IS FALSE` (as today), and
- **a `sequence_annotations` row exists for the sequence** (new).

Rationale: every import path creates the sequence-annotation row strictly
*after* all of the sequence's detections are uploaded — `import.py` creates
annotations in a separate step after the full import step completes, and
`import_predictor_split.py` posts all detections (deleting the sequence on any
shortfall) before posting the annotation. So *annotation row exists ⇔ import
finished successfully*. This is an exact gate, not a heuristic:

- Sequences mid-import are skipped and picked up on a later tick.
- Sequences stranded by a failed import (no annotation row) are never grouped.
- No schema change and no settle-window guesswork.

This invariant is a contract for future import paths: create the sequence
annotation last, only after all detections are posted.

### 3. Shared service

- Extract the body of `POST /sequence_groups/assign`
  (`app/api/api_v1/endpoints/sequence_groups.py`) into a service function in
  `app/services/group_assignment.py` that takes an `AsyncSession` and returns
  the existing counters (`processed`, `new_groups`, `joined_existing`,
  `inherited_annotations`, `skipped_no_bbox`).
- Both the endpoint and the worker task call this function; behavior stays
  identical between the two entry points.
- The annotation-exists gate lives in the service, so the manual endpoint
  gains it too — fixing the existing footgun where running assign mid-import
  could group a half-uploaded sequence.

### 4. Concurrency guard

- The service takes a Postgres session-level advisory lock
  (`pg_try_advisory_lock`) with a fixed key at the start of the run, held on
  a dedicated connection for the whole run. (Transaction-scoped
  `pg_try_advisory_xact_lock` doesn't work here: the annotation CRUD helpers
  commit mid-run, which would release the lock early; and holding a
  session-level lock on the pooled work session risks unlocking on a
  different connection after a commit.)
- If the lock is already held (sweep and manual call overlapping), the
  service returns immediately with a "skipped: already running" result
  instead of interleaving. This preserves the assignment logic's
  single-runner contract.

### 5. Script and Makefile cleanup

Assignment gets a single trigger path (the sweep) plus the manual endpoint:

- Remove `step_assign_groups` and `--skip-group-assignment` from
  `import_filtered.py` and `import_predictor_split.py`.
- Remove the `assign-groups` chaining from the `pull-seq-annotations` make
  target.
- Delete the `assign_groups.py` thin client and the `make assign-groups`
  target. The endpoint remains reachable via the API docs or curl if a manual
  run is ever needed.

### 6. Testing

- Service tests: ungrouped sequence *without* an annotation row is skipped;
  *with* an annotation row it is grouped; advisory-lock contention returns the
  "already running" result without processing.
- Existing `test_sequence_groups.py` endpoint tests must keep passing via the
  refactored service. Tests that expect grouping now need an annotation row
  for their sequences — audit and adjust fixtures where needed.
- Worker smoke test: the periodic task is registered with the expected cron
  expression.

## Out of scope

- Frontend changes (no button, no UI work).
- Event-driven / near-instant triggering.
- Any database schema migration.
