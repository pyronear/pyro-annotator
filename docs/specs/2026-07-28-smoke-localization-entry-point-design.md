# Smoke Localization Entry Point — Design

**Date:** 2026-07-28
**Issue:** [#168](https://github.com/pyronear/pyro-annotator/issues/168)
**Status:** Approved

## Problem

A sequence-annotated smoke alert has no navigable path into detection-level box
review, and the auto-annotate worker (`auto_annotate_sequence`, which writes the
`detection.auto_predictions` reference layer) has no trigger — today it only runs
when someone manually POSTs `/api/v1/auto_annotate/sequences/{id}`.

Since the object-split import (#166), one platform alert is split into one
annotation sequence per detected smoke object ("lanes"): the primary keeps the
platform `alert_api_id`; siblings get synthetic ids
(`1e9 + platform_sid * 1000 + object_index`). Lanes are classified
independently, so the alert as a whole is only fully classified when its last
lane reaches `seq_annotation_done`. Nothing in the backend models this sibling
relation — it exists only as arithmetic in the import script.

## Naming

The new stage is called **Smoke Localization**: a human confirms per-frame smoke
boxes against the auto reference layer, for smoke objects only. Nav label
**Detections → Localize**, route `/detections/localize`. ("Detection review" is
avoided: it collides with the existing `/detections/review` verification page,
and false-positive lanes are never box-reviewed.)

## Scope

**In scope (this branch):**

1. `platform_alert_id` as a first-class column on `sequences`.
2. Per-alert, gated auto-annotate trigger (periodic sweep).
3. Alert-grouped Smoke Localization queue (API endpoint + frontend page).
4. User-driven exit transition (submit lane → `annotated`) with a server-side
   completeness guard.

**Out of scope (follow-ups):**

- Collocated multi-plume review UI (all lanes of an alert on shared frames in
  one screen). This branch navigates the existing per-sequence review UI lane by
  lane; `platform_alert_id` and the queue endpoint are designed to serve the
  collocated UI later without backend changes.
- Retiring the dead `in_review` / `needs_manual` stages
  ([#207](https://github.com/pyronear/pyro-annotator/issues/207), lands after
  this branch; gates below carry compatibility caveats until then).
- The verification flag/rework action on `/detections/review`.

## Data model

One migration, three columns on `sequences`:

| Column | Type | Semantics |
| --- | --- | --- |
| `platform_alert_id` | BigInteger, indexed, NOT NULL | Groups object-split siblings of one platform alert. **Alert identity is always the composite (`source_api`, `platform_alert_id`)** — French alert 12345 ≠ CENIA alert 12345. Backfilled by a set-based UPDATE in the migration using an *existence-checked* decode: a row is decoded (`(x − 1e9) // 1000`) only when (a) `source_api` ∈ {`pyronear_french`, `api_cenia`} (both platforms are ingested via the object-split import), (b) `alert_api_id >= 1e9`, and (c) the decoded primary exists (`EXISTS` a sequence with the decoded value as `alert_api_id`, same `source_api`) — a structural invariant of the scheme, since object 0 always keeps the raw platform sid. Every other row gets `alert_api_id` (singleton identity). The existence check is required because the YOLO import generates `alert_api_id = crc32 & 0x7FFFFFFF` under *any* source, so within the platform sources an id ≥ 1e9 is ambiguous by value alone; a crc32 row only mis-groups on a negligible-probability collision with a real sid, and an orphaned sibling (primary deleted) falls back to singleton. Written explicitly by the object-split import going forward; the create endpoint applies the same existence-checked decode as a default for platform-source creates missing the field (older-script safety net; the import posts the primary first), else defaults to `alert_api_id`. The decode arithmetic thus lives server-side in exactly two places (migration + create default), both mirrors of `object_split.py`'s constants. |
| `auto_annotate_enqueued_at` | timestamptz, nullable | Stamped by the sweep when it defers the job; prevents re-enqueueing on every sweep run. |
| `auto_annotated_at` | timestamptz, nullable | Stamped by `auto_annotate_sequence` after it finishes writing `auto_predictions`. Queue gate: "the reference layer exists". |

Two timestamps because *queued* ≠ *reference layer exists*: the queue must not
surface a lane before its auto predictions are written.

`platform_alert_id` is exposed in `SequenceRead` and as a filter on
`GET /sequences` (used for lane advancing now, by the collocated UI later).
Sibling lookups always pair it with `source_api`
(`GET /sequences?source_api=&platform_alert_id=`).

## Trigger: periodic sweep

A procrastinate periodic task (every 5 min, same pattern as
`assign_sequence_groups`):

1. Select alerts (`source_api`, `platform_alert_id`) where **every** sibling has
   a sequence annotation at stage ∈ {`seq_annotation_done`, `in_review`,
   `annotated`}. A sibling with no annotation, or at `ready_to_annotate`,
   `under_annotation`, or `needs_manual`, blocks the whole alert. (The
   `in_review` / `needs_manual` entries are compatibility with legacy rows; #207
   collapses the set to {`seq_annotation_done`, `annotated`}.)
2. Require at least one sibling with `has_smoke = true` and
   `auto_annotate_enqueued_at IS NULL` (work to do).
3. For each such smoke lane: stamp `auto_annotate_enqueued_at`, defer
   `auto_annotate_sequence(sequence_id)`. FP lanes never get jobs — nothing to
   localize, no wasted GPU.

Properties: one code path regardless of how `seq_annotation_done` was reached
(save, bulk endpoint, group fan-out); race-free (only sees committed state);
self-healing; the first run sweeps up the pre-existing backlog of
alert-complete sequences.

Worker change: `auto_annotate_sequence` sets `auto_annotated_at` when done.

A sweep was chosen over an inline hook on the annotation endpoints because
`seq_annotation_done` is written from at least four code paths (create, update,
bulk, group fan-out — which can complete a *different* alert than the one being
saved), an inline check has a concurrent-save race where the trigger never
fires, and ≤5 min latency is irrelevant next to annotation cadence and the GPU
job itself.

## Queue endpoint

`GET /api/v1/sequences/localization-queue` — paginated **by alert**. (The
existing `/sequences` list cannot group by alert, and its
`detection_annotation_completion` filter is hard-wired to the `annotated`
stage.)

An alert appears when:

1. Every sibling's annotation stage ∈ {`seq_annotation_done`, `in_review`,
   `annotated`} — kept explicit so a sibling regressed to `needs_manual` *after*
   auto-annotate ran hides the alert again; and
2. At least one smoke lane is at `seq_annotation_done` with
   `auto_annotated_at IS NOT NULL`.

A lane leaves the queue when it is *submitted* (stage change to `annotated`),
not silently when its last box is saved — an annotator may still be adjusting a
fully-boxed lane.

Each item carries: `platform_alert_id`, `source_api`, camera, organisation,
`recorded_at`, and lanes
`[{sequence_id, alert_api_id, has_smoke, processing_stage, total_detections,
annotated_detections, auto_annotated_at}]` — enough for the UI to render
progress and pick the next lane without extra calls. Default order:
`recorded_at` descending.

## Exit transition (user-driven)

The localization UI gets an explicit **Submit** action: when the annotator
finishes a lane, the frontend PATCHes the sequence annotation
`processing_stage: seq_annotation_done → annotated`, attributed to the
submitting user. There is no implicit transition on detection-annotation saves.

**Server-side guard** on that specific transition: a PATCH moving a smoke lane
(`has_smoke = true`) from `seq_annotation_done` directly to `annotated` is
rejected (422) unless every detection of the sequence has an `annotated`-stage
detection annotation. This mirrors the completeness-validation pattern of
PR #153. The legacy path (`in_review → annotated`, where detection annotations
do not exist yet and are auto-created) is untouched, as are FP lanes.

The existing auto-create-detection-annotations hook (fires when a sequence
annotation reaches `annotated`) must skip detections that already have
annotations — to be verified during implementation.

Exited lanes surface in the existing `/detections/review` page for verification
(it filters on stage `annotated`).

## Frontend

New `SmokeLocalizationPage` at `/detections/localize`; nav entry
**Detections → Localize** with a queue-count badge (queue page total).

- One row per **alert**: camera, organisation, date/time, "M of N objects to
  localize", detection progress across smoke lanes.
- Click → existing per-sequence review UI (`/detections/{sequenceId}/annotate`)
  on the alert's first unfinished smoke lane, with `?from=localize`.
- On lane submit, advance to the alert's next unfinished smoke lane (via
  `GET /sequences?platform_alert_id=`); none left → back to the queue.
- Sibling objects' boxes already render as context overlays (`others_bboxes`),
  keeping multi-plume alerts legible in per-lane review.

## Known seam (documented, not fixed)

The legacy `/sequences/review` flow can still push a smoke lane
`seq_annotation_done → annotated` *before* localization; such a lane leaves this
queue and lands in the legacy detection flow instead. Making that path
localization-aware is out of scope.

## End-to-end flow

```
import (object-split): 1 platform alert -> N lanes (1 per smoke object)
  each lane classified (human or group inheritance) -> seq_annotation_done
    sweep (5 min): all lanes of the alert done?
      -> yes: enqueue auto_annotate_sequence per smoke lane
         -> worker writes auto_predictions, stamps auto_annotated_at
            -> alert surfaces in /detections/localize (alert row)
               -> annotator localizes each smoke lane, submits
                  -> lane: seq_annotation_done -> annotated (guarded)
                     -> last smoke lane submitted: alert leaves queue
                        -> lanes appear in /detections/review for verification
```

## Testing

**Backend:**

- Sweep: complete alert enqueues smoke lanes only; incomplete sibling blocks;
  `needs_manual` sibling blocks; FP-only alert never enqueues; singleton alert
  passes; re-run is idempotent (`auto_annotate_enqueued_at`).
- Worker stamps `auto_annotated_at`.
- Queue endpoint: membership gates, alert grouping/pagination, lane stats,
  regressed-sibling removal.
- Exit guard: submit with incomplete detections → 422; complete → transition,
  attributed to submitting user; guard does not fire for FP lanes or from other
  stages.
- Migration: backfill decode (primary id, synthetic id under both platform
  sources, non-platform sources; a YOLO-style `alert_api_id >= 1e9` row with no
  matching primary must NOT be decoded; an orphaned synthetic sibling falls
  back to singleton; same numeric id under two sources stays two alerts).

**Frontend (Vitest):** queue page rendering; lane-advance navigation logic.

## Dependencies

- #166 object-split import — merged (prerequisite, done).
- [#207](https://github.com/pyronear/pyro-annotator/issues/207) stage
  retirement — follows this branch, simplifies the stage gates.
- Collocated multi-plume review UI — future ticket, builds on
  `platform_alert_id` + the queue endpoint.
