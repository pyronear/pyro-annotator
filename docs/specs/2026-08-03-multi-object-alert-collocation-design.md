# Multi-Object Alert Collocation — Design

**Date:** 2026-08-03
**Issues:** [#217](https://github.com/pyronear/pyro-annotator/issues/217) (missed-smoke-only lanes),
[#224](https://github.com/pyronear/pyro-annotator/issues/224) (alerts naming),
and the collocated multi-plume follow-up deferred by
`docs/specs/2026-07-28-smoke-localization-entry-point-design.md`.
**Status:** Approved

## Problem

The object-split import (#166) turns one platform alert into one sequence per
smoke object ("lanes", grouped by `platform_alert_id`). The annotation UIs
never reunite them:

- **Classify** (`/classify`) shows one row per object with no alert awareness.
  Sibling objects of the same alert look like unrelated rows, and an annotator
  cannot see — let alone classify — them together, even though they share the
  same physical frames. Meanwhile the per-alert sweep gate silently holds every
  classified lane hostage until its last sibling is classified.
- **Localize** (`/localize`) groups queue rows by alert but reviews objects one
  at a time; siblings appear only as read-only grey overlays.
- **Missed-smoke-only lanes** (`has_smoke = false, has_missed_smoke = true`)
  count as "done" for the sibling gate but are surfaced by no queue — they park
  at `seq_annotation_done` forever (#217).
- **Vocabulary** for "one object in a sequence" differs at every layer
  (`sequences_bbox`, track, cluster, object, lane, group, and a classify card
  titled "Detection N" that collides with the `Detection` entity), and "alert"
  appears in exactly one page's copy, unexplained (#224).

## Architecture decision

**The alert becomes the unit of interaction; the sequence stays the unit of
storage.** No DB migration, no re-import. One sequence = one object = one lane,
exactly as today; the collocated experience is built on `platform_alert_id`
reads. Rejected alternatives: a first-class `alerts` table (migration and
refactor before any UX improves; the composite key `(source_api,
platform_alert_id)` already serves every query need) and re-merging objects
into multi-track sequences (destroys per-object lifecycle and GPU anchoring).

## Vocabulary

One triad everywhere, introduced in the guide page: **Alert → Objects →
Frames.**

- **Alert**: one camera event; groups N objects. Standardized as the
  user-facing name for queue rows in both classify and localize (resolves
  #224 by adopting the term rather than removing it).
- **Object**: one smoke plume (or false-positive source) tracked over time.
  User-facing everywhere ("3 objects", "Object 1..N" — replacing the classify
  cards' "Detection N"). Internally a lane (sibling sequence); "lane" remains
  the backend term.
- **Frame**: one image at one moment (a `Detection` row).

Import scripts already speak this vocabulary (`object_split.py`,
`platform_alert_id`); the only import work is a clarity pass on log lines and
docstrings where "sequence" is ambiguous (alert-API sequence vs annotation
sequence), plus a paragraph in `data-ingestion-guide.md` stating the mapping:
one alert-API sequence = one alert = N annotation-API sequences (objects). The
alert API's own "sequence" terminology is not renamed — it is upstream's word.

## Shared foundation

### Alert-detail endpoint

```
GET /api/v1/sequences/alert?source_api=…&platform_alert_id=…
→ { source_api, platform_alert_id, camera_name, organisation_name,
    recorded_at,   # per-object cone azimuths live on each lane's SequenceRead
    lanes: [ { sequence: SequenceRead,
               annotation: SequenceAnnotationRead | null } ] }
```

Lanes ordered by `alert_api_id` ascending (primary first). Both collocated
screens and the lane-advance logic consume this one payload; it replaces the
current hack where `DetectionSequenceAnnotatePage` fabricates
`LocalizationQueueLane` objects with placeholder fields.

### Routes

Existing routes broaden in place: `/classify/:id` and `/localize/:sequenceId`
load **the whole alert containing that sequence** (siblings fetched via the
alert-detail endpoint). URL identity stays a plain sequence id — deep links and
dashboard CTAs keep working, and no composite-key URLs are invented. Queue rows
link to the alert's primary lane id.

### Frame identity

Sibling lanes reference the same physical images where their timelines
overlap; alignment across lanes is `recorded_at` equality (the import copies
the source frame's timestamp into every lane that includes it). Images are
per-lane S3 copies (`detections/sequence_{id}/…`); which lane's copy renders is
irrelevant. A drifting plume can produce siblings with few or no shared frames
— the UIs must tolerate frames where some objects are absent.

## Sub-project 1 — Missed smoke enters localize (closes #217)

One rule replaces `has_smoke = true` in every localization predicate:

> **needs_localization = (has_smoke OR has_missed_smoke) AND NOT is_unsure**

Defined **once** (a shared predicate module) and imported by all consumers —
today `_pending_ready_lane` (`auto_annotate_scheduling.py`) and
`_ready_smoke_lane` (`sequences.py`) are near-duplicates that must be kept in
sync by hand; this collapses them.

Touch points:

- **Sweep**: missed-smoke-only lanes get enqueued and receive the GPU pass.
  The auto layer anchors on the rejected track and may contribute little for
  them; that is accepted — one uniform code path beats a special case, and the
  annotator draws the missed smoke by hand.
- **Localize queue**: membership and ready-lane predicates adopt the rule; the
  lane counts as work to do.
- **Exit guard**: the `seq_annotation_done → annotated` completeness guard
  extends from `has_smoke` lanes to the rule, so a missed-smoke lane cannot
  exit half-boxed.
- **Verification** (`/localize/done` default filter): `has_smoke: true`
  becomes the rule, so submitted missed-smoke lanes appear for spot-checking.

No change needed: the classify-submit fast path already refuses to fast-path
missed-smoke lanes, and `auto_create_detection_annotations` already maps them
to `bbox_annotation`.

Ships standalone; unsticks every currently-parked #217 lane on the first sweep
after deploy.

## Sub-project 2 — Collocated classify

### Queue (`/classify`)

Rows become alerts. New endpoint `GET /api/v1/sequences/classify-queue`,
paginated by alert: an alert appears when at least one lane is at
`ready_to_annotate`. Each item: camera, organisation, `recorded_at`, source,
objects count, and per-lane progress (e.g. "2 of 3 classified" when group
inheritance pre-labeled a lane). Default order `recorded_at` descending.

**Performance is a requirement, not an afterthought** (lesson of #215): the
query MUST use the candidate-pre-filter shape of the post-#221 localization
queue — pre-filter to alerts with ≥1 lane at `ready_to_annotate` (covered by
`ix_sequence_annotation_processing_stage`; the working set is the unclassified
backlog), then group only those by the existing composite index
`ix_sequence_platform_alert_id (source_api, platform_alert_id)`. No
completeness aggregate exists here at all (no gate — one ready lane suffices),
so the query is strictly cheaper than the localization queue's. Acceptance
criterion: P95 in the same ms-range as the post-#221 localization queue on
production-scale data, verified by EXPLAIN + timing against a realistic
dataset.

### Screen (`/classify/:id`)

Layout: **shared frame player on top, one classify card per object below,
side by side** (single-object alerts degrade to today's screen with one card).

- Player overlays every object's track boxes, color-coded per object; cards
  carry the matching color, the object's crops, and controls: Smoke + smoke
  type XOR false-positive types, plus **per-object unsure** (the existing
  per-sequence `is_unsure`, which post-split is per-object — it moves onto the
  card).
- Cards titled "Object 1..N". Objects already at `seq_annotation_done` or
  beyond render read-only (same lock rule as `_BULK_LOCKED_STAGES`).
- **Missed smoke is alert-level in the UI** (footer toggle: "smoke elsewhere
  in the frames, not covered by any object") and **stored on the primary
  lane** only — giving it exactly one localization path via sub-project 1's
  rule.
- Group-inheritance pre-labels appear pre-filled and overridable.

### Submit

One button, one transaction: `POST /api/v1/annotations/sequences/classify-submit`
takes per-lane payloads (annotation + target stage) and writes all lanes
atomically. Target stages stay client-computed by the existing two-lane logic
(FP-only → `annotated`; smoke / missed-smoke / unsure → `seq_annotation_done`);
the server validates each lane exactly as single PATCHes do today. The
sibling-completeness gate therefore flips in one commit — the alert becomes
sweep-eligible the moment it is submitted.

## Sub-project 3 — Collocated localize

> UI note: the layout below is the approved direction; visual details will be
> iterated during this sub-project's implementation.

### Principle: verify fast, escalate rarely

The dominant flow is "glance and accept": the auto layer is usually right, so
the screen is a verification surface first and an editor second.

### Screen (`/localize/:sequenceId`, whole alert)

Top to bottom:

1. **Per-object timelines** — one color-coded row per object across the
   alert's frame union: solid = confirmed box, translucent = auto-prediction
   pending, grey = object absent on that frame (no detection row). Presence /
   absence and disjoint-sibling drift are visible at a glance. Each row carries
   a small **looping crop thumbnail** (the object's bbox region cycling
   through its frames — built with the existing crop utilities). Clicking a
   segment jumps to that frame with that object active.
2. **Frame grid** — the primary scanning surface, one cell per union frame
   with every object's boxes mini-rendered. Clicking a cell expands an
   **inline frame detail** (full-frame view with all objects' boxes) where any
   object's pending box can be accepted or resized directly — no navigation.
3. **Footer** — progress summary, a contextual **"Open Object N"** shortcut,
   and the primary **"⚡ Accept all & submit alert"** button.

### Interaction grains

- **Alert grain (common case)**: scan timelines/crops/grid → "Accept all &
  submit" auto-accepts every remaining pending model box for all objects
  (today's quick-submit logic, applied per lane) and submits the whole alert.
- **Frame grain (spot fixes)**: any grid cell → inline detail; existing boxes
  already belong to an object (their color), so accepting/resizing needs no
  mode switch. Only **drawing a new box** requires an owner: it goes to the
  active object.
- **Object grain (rare)**: "Open Object N" / clicking a timeline row activates
  that object and jumps to its first unresolved frame — an in-page action, not
  a navigation. Per-object quick-accept remains for "this whole track is
  fine".

### Missed smoke: the ⚑ pseudo-object

A **⚑ Missed row is always present** (ghosted until used), because classify
can miss it too:

- If the alert was flagged at classify, the row starts highlighted with zero
  boxes.
- Drawing a first ⚑ box on an unflagged alert sets `has_missed_smoke`
  retroactively.
- **Storage rule**: ⚑ boxes and the flag live on the alert's **primary lane —
  or the first still-open lane if the primary already exited** (e.g. FP-only
  fast path). One deterministic home. Known limitation, stated plainly: after
  save, ⚑ boxes are indistinguishable from that lane's own boxes (detection
  annotation boxes carry no object id); if training data ever needs the
  distinction, the follow-up is spawning a real lane for missed smoke — out of
  scope here.
- **Soft confirm on submit**: if `has_missed_smoke` is set and no ⚑ box was
  drawn, "Accept all & submit" asks "You flagged missed smoke but drew no
  boxes — submit anyway?" with options *submit anyway*, *submit & clear flag*,
  *go back*. No hard block (the flag may simply have been wrong).

### Data flow

- **Load**: alert-detail endpoint for the lanes, then each lane's detections +
  annotations via the existing per-sequence endpoints. Frame union built
  client-side on `recorded_at`.
- **Save**: per-frame accepts/edits keep writing DetectionAnnotations
  incrementally per lane — no new write path; attribution comes from the box's
  owning object.
- **Submit**: `POST /api/v1/annotations/sequences/localize-submit` transitions
  all still-open lanes matching the localization rule (sub-project 1)
  `seq_annotation_done → annotated` in one
  transaction, running the existing per-lane completeness guard inside it. The
  alert leaves the queue in one action.

## Non-goals

- **S3 image dedup**: overlapping frames are stored once per lane
  (`detections/sequence_{id}/…`). Content-hash dedup is possible but is a
  storage-cost optimization with zero UX effect — explicitly out of scope.
- **Box→object linkage in detection annotations**: no schema change; the
  sequence *is* the object, and ⚑ carries the one stated limitation.
- **First-class `alerts` table**; **re-merging** objects into multi-track
  sequences; renaming the alert API's own "sequence" terminology.
- **Legacy classify-review path** (`/classify/done`): it can still push a
  smoke lane to `annotated` pre-localization (seam documented in the smoke
  localization spec); making it localization-aware stays out of scope.

## Testing

**Backend**

- Shared predicate: one source of truth; sweep, queue, guard, and verification
  filters all adopt `(has_smoke OR has_missed_smoke) AND NOT is_unsure`;
  missed-smoke-only lane is enqueued, queued, guarded, and verifiable.
- Bulk submits: atomicity (one failing lane rolls back the alert), per-lane
  validation parity with single PATCHes, gate flips in one commit,
  localize-submit runs the completeness guard per lane.
- Classify queue: membership (≥1 ready lane), progress counts, pagination,
  candidate-pre-filter query shape; perf criterion (P95 ms-range on
  production-scale data, EXPLAIN-verified).
- Alert-detail endpoint: lane ordering, null annotations, singleton alerts.
- ⚑ storage rule: primary lane; first-open-lane fallback; retroactive flag.

**Frontend (Vitest)**

- Per-lane stage computation on classify submit (unchanged logic, bulk
  payload); read-only locked cards; alert-level missed-smoke toggle mapping to
  primary lane.
- Localize: frame-union building on `recorded_at` (including disjoint
  siblings); timeline presence/status mapping; drawn-box attribution to the
  active object; ⚑ retro-flag; soft-confirm paths.
- Visual pass with the screenshot recipe for both new screens.

## Rollout

Three independently shippable branches, in order:

1. **Missed smoke → localize** — backend only; closes #217 immediately.
2. **Collocated classify** — classify-queue endpoint, alert-detail endpoint,
   classify-submit bulk endpoint, the new screen, naming (#224: "alert" copy,
   "Object N" cards), sidebar count switches to alerts.
3. **Collocated localize** — the timeline/grid screen, ⚑ pseudo-object,
   localize-submit bulk endpoint; replaces the per-lane flow (the per-lane
   route keeps working for deep links until then).

The old per-lane screens keep working throughout; no data migration at any
step.
