# Temporal Score Refresh on Re-import — Design

**Date**: 2026-08-10
**Status**: Approved
**Follows**: `docs/specs/2026-08-10-import-temporal-model-score-design.md` (PR #364, merged)

## Goal

Let a re-import update the temporal-model columns on sequences the annotator
already has, so the ~19k rows that predate PR #364 can be backfilled and any
provisional score can be corrected.

## Why this is needed

`POST /sequences/` is create-only, and `uq_sequence_alert_source` makes a
re-import of an existing sequence return 409, which `shared.py` swallows as
`skip_reason: "already exists"`. There is no update path on sequences at all, so
today re-running `make import-alert-api` over a past range imports nothing and
changes nothing. Every row imported before PR #364 keeps `temporal_model_score
= NULL` permanently.

## Approach: refresh inside the import, not beside it

The import already fetches these sequences and already branches on "this one
exists". Making that branch update the temporal columns turns
`make import-alert-api DATE_FROM=… DATE_END=…` over a past window into the
backfill — no new command, no second script, idempotent by construction.

The decisive advantage is fidelity. A re-import re-fetches detections and
re-runs `split_all_records`, so `primary_identified` and the sibling-clearing
rule are recomputed exactly as for a fresh import. **Refreshed rows obey
identical attribution rules to newly imported ones**, and the column keeps one
meaning across the whole table.

The rejected alternative was a fast standalone script fetching only the
sequence list per date (minutes rather than hours). It cannot recompute
`primary_identified` — that needs the alert API's own-vs-`others_bboxes`
distinction, which the annotator does not store (`Detection` keeps
`algo_predictions` and `auto_predictions` only, and object split rewrote each
lane's boxes per object). It would therefore score lanes the guard would skip,
permanently splitting the column's meaning into "fresh" and "backfilled". Given
imports run days-to-weeks after capture — so scores are final by then — and the
backlog is finite (a comparable full run was ~6,900 sequences / 123k detections
in ~4h), an afternoon in the background is the better trade than a second code
path maintained forever.

## The endpoint

`PATCH /api/v1/sequences/temporal-score`

```json
{
  "source_api": "pyronear_french",
  "alert_api_id": 56767,
  "temporal_model_score": 0.6905358697477871,
  "temporal_model_version": "0.2.0",
  "temporal_api_version": "0.3.1"
}
```

Returns the updated `SequenceRead`; `404` when no sequence matches.

**Collection-level, keyed by natural key** rather than `/{id}`: at 409 time the
import knows only `source_api` and `alert_api_id`, never the annotator's
internal id. Keying on the unique pair avoids a lookup round-trip per sequence.
`services/alert_identity.py:36` already establishes natural-key lookup as a
pattern in this codebase.

**Narrow by design** — these three columns only. A general `PATCH
/sequences/{id}` would open mutation of `alert_api_id`, `platform_alert_id`, or
camera identity, which nothing in the system should ever change.

**JSON body, all three fields required but nullable.** Form encoding cannot
express an explicit null: `requests` drops `None` from form bodies, which is
precisely how the create path stores NULL. For an update that is fatal —
"absent" and "null" must differ, or a sibling lane could never be reset to NULL.
Requiring all three (each either a value or `null`) removes the distinction
entirely: whatever is sent is what is stored. Follows the existing
`update_sequence_annotation` client shape (`_make_request("PATCH", …,
json=…)`).

## Import integration

`shared.py`'s 409 branch calls the new endpoint instead of returning
immediately, with the temporal values from the record it was about to post.

Sibling lanes 409 as well, and their records already carry cleared `None`
values from `object_split`, so the PATCH writes NULL for them. A stale non-NULL
score from an earlier state therefore cannot survive a refresh — the sibling
invariant is re-asserted on every run rather than merely on first insert.

## Reporting

The 409 result gains a `refreshed` boolean, and the run summary reports how many
sequences were refreshed and how many refreshes failed, alongside the existing
skip counts.

`refreshed` means the PATCH succeeded — deliberately **not** "the stored value
changed". Reporting the latter would require reading each row before writing it,
and the extra round-trip buys nothing: a backfill's useful signal is that it
reached the rows at all.

This is not decoration. Without it a backfill run is indistinguishable from a
no-op — the same silent-success failure that made `unscored_primary` useless
until it was surfaced (PR #364, `dce44c0`). A refresh that quietly updates zero
rows must be visibly different from one that updates thousands.

A 404 from the endpoint should be unreachable from the import (the 409 that
triggered it proves the row exists), so it is treated as a refresh failure:
counted, logged with the sequence id, and non-fatal to the run.

## Scope boundary

Touches the three temporal columns and nothing else. No detections, no
annotations, no processing stages, no camera or organisation fields, and
explicitly **not** `is_wildfire_alertapi` — that is a human judgement annotators
may already have reacted to, and silently overwriting it during a backfill could
change what existing annotations mean. Adding it later remains possible as a
deliberate decision.

## Testing

- **Endpoint**: updates all three columns; returns 404 for an unknown
  `(source_api, alert_api_id)`; an explicit `null` resets a previously scored
  row to NULL (the sibling-reset case); rejects a body missing any of the three
  fields.
- **Import path**: the 409 branch issues the PATCH with the record's values and
  reports `refreshed`; a sibling's 409 PATCHes NULL.
- **Idempotency**: refreshing twice leaves identical values.
- **End-to-end against the pg dump**: the only way to exercise real pre-feature
  rows. Restore, confirm `temporal_model_score IS NULL` across the board, run an
  import over a date range covered by the dump, and confirm primary lanes gain
  scores matching the alert API while sibling lanes stay NULL.

## Non-goals

- No standalone fast-refresh script (see rejected alternative above).
- No change to `POST /sequences/` semantics; it stays create-only and keeps
  409ing.
- No backfill of `max_conf` or `is_validated`, which PR #364 deliberately did
  not capture.
