# Alert skip escape hatch

Date: 2026-08-05
Status: approved, not implemented

## Problem

The annotation UI is still partial (multi-object collocation and related work
are in flight), and annotators sometimes hit an alert they cannot faithfully
annotate with the tools on screen. Today they have no way out: the alert sits
at the front of a queue, and the only options are to annotate it wrong or to
leave it blocking their flow. `is_unsure` does not cover this — it records
"the content is undecidable", not "the tooling cannot express what I see".

Annotators need an escape hatch: park the alert, move on, and come back once
the UI catches up.

## Decisions

- **Scope:** the skip is available from both queues — classify
  (`ClassifyAlertPage`) and smoke localization (`LocalizeAlertPage`).
- **Granularity:** whole alert. One action parks every sibling lane of the
  alert `(source_api, platform_alert_id)` together.
- **Lifecycle:** recoverable park. Skipped alerts leave both queues, remain
  listable behind a per-queue "Skipped" filter, and anyone can unskip.
  Unskip returns the alert to exactly where it was, because skipping never
  mutates lane state.
- **Metadata:** a skip records who, when, and an optional free-text note
  ("two plumes overlap, can't split") — the note is the signal for which UI
  gaps hurt the most.

## Data model

Skip is an **overlay**, not a lane state. A new table holds one row per
currently-skipped alert:

```
alert_skips
  id                  serial PK
  source_api          SourceApi enum      ┐ alert identity
  platform_alert_id   bigint              ┘ UNIQUE (source_api, platform_alert_id)
  skipped_by_user_id  int, FK users ON DELETE SET NULL, nullable
  skipped_at          timestamptz, NOT NULL, default now
  note                text, nullable
```

One Alembic migration. No index beyond the one backing the unique
constraint: it is the exact composite key every query uses (queue anti-joins,
skip/unskip point lookups), and the table stays small by design — it is a
backlog meant to be drained, not an archive. The surrogate `id` is kept for
uniformity with the rest of the schema.

Skip = insert a row. Unskip = delete it. No `processing_stage`, annotation,
or auto-annotation state is ever touched, which is what makes the park
trivially recoverable:

- Sibling lanes sit at different stages when an alert is skipped (some
  classified, some not) — nothing needs snapshotting or restoring.
- A lane added to a skipped alert later (add-object flow) is covered by
  identity, not by a flag it would have missed.
- On unskip the alert simply reappears in whichever queue its lane stages
  already qualify it for.

### Rejected alternatives

- **New `SKIPPED` processing stage on lanes** — requires a
  `stage_before_skip` snapshot per lane to restore, and every stage-based
  gate, export, and done-page filter must learn the new value. Entangles an
  alert-level, tooling-related fact with the lane lifecycle.
- **Skip columns stamped on every sibling `sequences` row** — denormalizes
  one fact N times: partial-update/clobber risk, duplicated note, and a lane
  added after the skip silently isn't skipped.

## API

Alert-level operations follow the existing
`GET /sequences/alert?source_api=&platform_alert_id=` convention
(`annotation_api/src/app/api/api_v1/endpoints/sequences.py`).

### Skip

`POST /sequences/alert/skip` — body
`{source_api, platform_alert_id, note?}`. Stamps the calling user and
`skipped_at`.

- 409 if the alert is already skipped (unique constraint surfaced cleanly).
- 404 if no sequence exists with that alert identity.
- 409 if every lane of the alert is at `annotated` — the alert has fully
  exited the pipeline, and a skip row would be visible in neither queue's
  skipped view (stale-tab race: annotator A submits the final lane, annotator
  B skips from a stale screen).

### Unskip

`DELETE /sequences/alert/skip?source_api=&platform_alert_id=` — deletes the
row. 404 if the alert is not skipped.

### Listing skipped alerts

No dedicated backlog endpoint. Each queue endpoint gains a
`skipped: bool = false` query parameter:

- `GET /sequences/classify-queue?skipped=true`
- `GET /sequences/localization-queue?skipped=true`

Default (`false`) applies the new `NOT EXISTS (alert_skips …)` exclusion;
`true` inverts it to `EXISTS` and includes the skip metadata
(`skipped_at`, `skipped_by` username, `note`) on each row.

Because each queue's own gate determines membership, the two skipped views
partition the skipped set naturally: an alert skipped at classify still has
unclassified lanes and matches classify's gate; an alert skipped at localize
still satisfies the localization gate. No "which queue does this return to"
computation exists anywhere.

## Pipeline integration

- **Queue exclusion:** `classify-queue` and `localization-queue`
  (`sequences.py`) each add the skip anti-join. That is the whole queue
  change.
- **Submit guards:** the classify submit path (sequence-annotation update
  moving a lane to a done stage) and the localize submit path reject with
  409 when the lane's alert has a skip row — a stale tab must not race a
  teammate's skip. Non-stage-changing edits are not guarded.
- **Auto-annotate sweep: untouched.** A classify-skipped alert has
  unclassified lanes, so the all-siblings-done gate already fails; a
  localize-skipped alert already has its reference layer built (that is the
  localization queue's entry condition). No GPU is spent on newly skipped
  work and the sweep never learns the table exists.
- **Exports and done pages: untouched.** Lanes keep their real stages. An FP
  lane that reached `annotated` before its alert was skipped is finished work
  and stays visible and exportable as such.

## Frontend

- **Skip action** on both `ClassifyAlertPage` and `LocalizeAlertPage`: a
  clearly-secondary "Skip alert" button opening a small dialog — optional
  note textarea, confirm/cancel. On confirm, skip and advance to the next
  queue item.
- **Skipped filter** on both queue pages: a "Skipped (n)" toggle following
  the existing queue-filter patterns. Rows in the skipped view show the skip
  metadata (note, who, when) and an inline **Unskip** action; unskipping
  returns the row to the normal queue view. No new nav entry, no dedicated
  page.
- Queue pages otherwise unchanged — skipped alerts simply stop appearing in
  the default view.

## Testing

Backend (pytest, isolated compose stack):

- Skip/unskip CRUD: happy paths, 409 already-skipped, 404 unknown alert,
  404 unskip-not-skipped, 409 fully-annotated alert, note round-trip,
  user attribution, `SET NULL` on user deletion.
- Queue behaviour: a skipped alert disappears from its queue's default view,
  appears under `skipped=true` with metadata, and reappears in the default
  view after unskip. An alert skipped at classify appears only in classify's
  skipped view; one skipped at localize only in localization's.
- Submit guards: classify and localize submits on a skipped alert return
  409; the same submits succeed after unskip.

Frontend (vitest): skip dialog flow (note optional, confirm advances),
skipped filter toggle rendering metadata and unskip action, per existing
test patterns.
