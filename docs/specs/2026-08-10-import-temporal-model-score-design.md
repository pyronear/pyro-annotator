# Import Temporal Model Score — Design

**Date**: 2026-08-10
**Status**: Approved

## Goal

Capture the alert API's temporal-model verdict on every sequence the importer
creates, so annotation work can later be triaged by "did the platform's temporal
model think this was a fire" instead of importing an undifferentiated stream of
detection candidates.

This spec covers **capture only**. Backfilling the sequences already in the
annotator is a follow-up (see Non-goals).

## Background: what the alert API knows

A pyro-api `Sequence` is not raw footage. It exists only after the on-camera
YOLO detector fired on ≥3 spatially-overlapping frames within 5 minutes
(`SEQUENCE_MIN_INTERVAL_DETS=3`, `SEQUENCE_MIN_INTERVAL_SECONDS=300`). That is a
persistence filter, not a fire confirmation — clouds, fog, dust and industrial
plumes all clear it, which is why the annotator carries a false-positive
taxonomy at all.

pyro-api then runs a second-opinion pipeline (`app/services/validation.py`,
added 2026-06-11 in PR #615, migration `c5e2f7a8b1d0`):

1. **Risk gate** — drops low-`max_conf` sequences on low-FWI days.
2. **Temporal model** — scores the frame sequence; `probability >
   TEMPORAL_MODEL_THRESHOLD` (default `0.45`) sets `validation_status='model'`,
   flips `is_validated`, and triggers triangulation + notification.

The importer currently takes everything that reaches step 1 and explicitly
bypasses the risk gate by passing `risk_score="extreme"` (`import.py:548`;
`FWI_MIN_CONF["extreme"] = 0.0`, and `min_confidence_for_class` maps `0.0` to
`None`, i.e. no filter).

### Which field carries the verdict

`validation_status` is the exact signal, but it is `exclude=True` on both the
model (`models.py:186`) and the read schema (`schemas/sequences.py:31`), so it
never appears in an API response. `temporal_model_score` is a faithful stand-in:

- It is written **only** after a real model call returned a probability
  (`validation.py:325-332`) — never on a fail-open, never by the migration's
  backfill.
- `validated = probability > threshold`, and validated implies
  `validation_status='model'` (`validation.py:320-321`).
- Once `is_validated` is set, the worker resumes without re-scoring
  (`validation.py:234-238`), so a high score cannot later decay.

Therefore `temporal_model_score > 0.45` ⟺ the temporal model confirmed the
sequence.

It also subsumes the risk gate: the gate runs in phase 1 and returns early on
failure (`validation.py:252-255`), before the model call at `:310`. A sequence
that fails the risk gate is never scored, so a non-`NULL` score implies the risk
gate passed.

`is_validated` is deliberately **not** captured. It is true for both fail-open
paths (`fail_open_unavailable`, `fail_open_stale`), and the migration backfilled
`is_validated = true` for every sequence predating 2026-06-11
(`c5e2f7a8b1d0:58-62`), which makes it a constant on historical data.

## Data model

Three nullable columns on the annotator `Sequence` (`annotation_api/src/app/models.py`):

| column | type | source |
|---|---|---|
| `temporal_model_score` | `float`, nullable | alert API `SequenceRead.temporal_model_score` |
| `temporal_model_version` | `str(32)`, nullable | `SequenceRead.temporal_model_version` |
| `temporal_api_version` | `str(32)`, nullable | `SequenceRead.temporal_api_version` |

Plus `Index("ix_sequence_temporal_model_score", "temporal_model_score")`, for the
follow-up triage phase.

The version pair is captured alongside the score because pyro-api writes them in
the same `UPDATE` for exactly this purpose (`models.py:137-139`): a score is only
interpretable against the model release and serving image that produced it, and
a redeploy otherwise makes stored scores incomparable.

### `NULL` semantics

`NULL` means precisely **"the platform never scored this sequence"**, never "the
model scored it low". It covers:

- sequences recorded before 2026-06-11 (the feature did not exist);
- fail-opens — the model was unreachable or the job went stale;
- sequences that never reached the model's `MIN_FRAMES`;
- sequences the risk gate dropped;
- everything imported before this change ships (no backfill — see Non-goals).

This distinction is the whole value of the column, so it carries a SQL comment
saying so. Consumers must treat `NULL` and `0.0` as different, and in particular
must not coalesce `NULL` to `0.0` when filtering.

One additive Alembic migration. No data migration.

## Import capture

Three touch points, all in
`annotation_api/scripts/data_transfer/ingestion/alert_api/`:

**1. `utils.py`** (`to_record`, the flattened-record builder). The raw alert-API
`SequenceRead` JSON is already in hand as `sequence`, so the values are read
directly and emitted under the module's existing `sequence_*` naming:

```python
"sequence_temporal_model_score": sequence.get("temporal_model_score"),
"sequence_temporal_model_version": sequence.get("temporal_model_version"),
"sequence_temporal_api_version": sequence.get("temporal_api_version"),
```

**2. `shared.py`** (`transform_sequence_data`, line 173). Map the three record
keys into the sequence-creation payload.

**3. `object_split.py`** — **no change required.** `split_sequence_records`
copies the whole record per member (`record = dict(records_by_key[key])`, line
233), so the new keys reach every sibling automatically.

### Sibling semantics

Object-splitting turns one alert-API sequence into N annotator lanes. All N
share one score, which is correct by construction: `platform_alert_id` is the
alert-API *sequence* id (`object_split.py:322`), so a `platform_alert_id` group
descends from exactly one scored sequence. Aggregating a score per alert is
unambiguous — `MAX` and `ANY` are identical.

The consequence to remember downstream: **the score is an alert-level prior, not
per-object truth**. An alert-sequence containing both a real plume and a cloud
produces two lanes carrying the same high score.

### Staleness

Validation is asynchronous. A sequence imported shortly after it started may
still be pending, so the import captures `NULL` (or a provisional
below-threshold score) and — with no update path — keeps it permanently. Same-day
imports therefore capture provisional verdicts. Refreshing them is the
follow-up's job.

## API surface

- `SequenceCreate` (`schemas/sequence.py:46`) and the `POST /sequences/` form
  (`endpoints/sequences.py:145`) gain the three fields, all optional.
- `SequenceRead` (`schemas/sequence.py:108`) returns them.

Read-only exposure. No filtering, ordering, or mutation endpoints in this spec.

## Testing

- **Import mapping**: a fetched sequence carrying a score yields a create-payload
  carrying it; a sequence whose key is absent *or* explicitly `null` yields
  `None` — asserting `None` and not `0.0`, since that is the distinction the
  `NULL` semantics rest on.
- **Object split**: every sibling produced from a split sequence carries the
  parent's score and versions.
- **Endpoint round-trip**: `POST /sequences/` with the three fields returns them
  from `GET`; `POST` without them stores `None`.

## Non-goals

- **Backfill.** `POST /sequences/` is create-only and `uq_sequence_alert_source`
  makes a re-import of an existing sequence 409, which the importer swallows as
  `skip_reason: "already exists"` (`shared.py:620-624`). Re-running the import
  over past dates will therefore **not** populate scores on existing rows; only
  sequences imported fresh after this ships carry them. A follow-up will add a
  bulk upsert path and a backfill script that can also refresh stale scores.
- **Queue triage.** Filtering or sorting the classify/localization queues by
  score is a separate phase. Note that until the backfill lands, the column is
  `NULL` for existing rows, so a "hide below threshold" filter would empty the
  queue rather than narrow it.
- **Import-time filtering.** No `--confirmed-fires-only` flag. Storing the score
  supersedes filtering on it: the import stays lossless and triage becomes a
  reversible UI decision.
- **`max_conf` and `is_validated`** are not captured.
- **No pyro-api changes.** Exposing `validation_status` would give finer
  resolution (fail-open cause, terminal vs pending), but only within the rows
  this design already discards, and would require a cross-repo PR plus a deploy.
