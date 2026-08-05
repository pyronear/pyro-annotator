# Promoting a false-positive object back into localization

**Date**: 2026-08-05
**Status**: Approved
**Issue**: #275

## Problem

An object classify settled as a false positive exits the pipeline at
`processing_stage = 'annotated'`. If an annotator later corrects that call —
the "reflection" was real smoke — the correction never puts the object back
into localization:

- `determineClassifySubmitStage`
  (`frontend/src/utils/annotation/localizeUtils.ts`) returns `annotated`
  unchanged for anything already annotated, so the lane keeps `annotated`
  while gaining `has_smoke = true`.
- The Localize queue selects lanes at `seq_annotation_done`, so the lane
  never reappears there.
- On `/localize/:id` it renders as a non-workable Context row with no way to
  box it, and the alert ships with a smoke object that has no localization.

Two backend facts make this more than a one-line stage fix:

1. **Stale detection annotations.** The FP exit's
   `auto_create_detection_annotations` created a detection annotation at
   `annotated` stage with empty content for every frame. If the lane were
   demoted without touching them, `getCellState` would read every frame as
   `done` (the lane looks fully localized with zero boxes) and the
   localization exit guard in `apply_annotation_update` would pass trivially.
2. **No auto-review reference.** The per-alert auto-annotate pass (which
   writes `detection.auto_predictions` and stamps
   `sequence.auto_annotated_at`) never ran for a lane that exited as FP, and
   the Localize queue's `_ready_smoke_lane` requires `auto_annotated_at`.

There is no explicit never-demote guard on the backend PATCH path — the
frontend simply never sends a demotion — so "relaxing the backend rule" means
adding demotion handling and its side effects, not loosening an existing
check.

## Decisions

- **Only lanes with no committed localization work demote.** A lane that was
  smoke, got fully localized (real boxes), was demoted to FP, and is now
  promoted back stays at `annotated` — its old localization is still valid.
  The discriminator is the lane's previous flags on the frontend and the
  absence of non-empty detection annotations on the backend.
- **The auto-annotate pass is triggered immediately** at promotion (not left
  to the 5-minute periodic sweep), so the lane surfaces in the Localize
  queue within seconds. The sweep's existing stale-retry logic remains the
  safety net for a lost defer.
- **FP → unsure stays `annotated`** (an unsure lane does not need
  localization). Out of scope.
  *Amended after the 2026-08-05 "unsure lanes gate the localize queue" spec
  merged: an undeferred unsure lane now always parks at
  `seq_annotation_done` (it withholds its alert from localization until
  settled), so FP → unsure re-parks rather than staying `annotated`. That
  spec's rule takes precedence in `determineClassifySubmitStage`; its
  `wasDeferredUnsure` argument was absorbed by
  `previouslyNeededLocalization`, which covers the deferred-unsure case by
  construction (an unsure lane never needed localization pre-edit).*

## Design

### 1. Stage rule — frontend

`determineClassifySubmitStage` gains one argument,
`previouslyNeededLocalization`, computed by the caller as
`laneNeedsLocalization(lane.annotation)` from the lane's pre-edit flags. The
`annotated` branch becomes:

```ts
if (currentStage === 'annotated') {
  const nowNeedsLocalization = (hasSmoke || hasMissedSmoke) && !isUnsure;
  return nowNeedsLocalization && !previouslyNeededLocalization
    ? 'seq_annotation_done' // promoted FP lane re-enters localization
    : 'annotated';          // never-demote for everything else
}
```

The non-`annotated` branches are untouched. Both `ClassifyAlertPage` call
sites pass the new argument; queue-mode lanes are never at `annotated`, so it
only bites in done mode.

### 2. Backend — demotion handling in `apply_annotation_update`

When `existing.processing_stage == ANNOTATED`, the target stage is
`SEQ_ANNOTATION_DONE`, and the target flags need localization
(`needs_localization`):

- **Guard**: if any of the lane's detection annotations carries non-empty
  content (`annotation -> 'annotation'` array length > 0 — committed boxes),
  reject 422. The frontend never sends this; the guard protects
  genuinely-localized lanes from other clients.
- **On accept**: delete the lane's detection-annotation rows (the empty
  `annotated`-stage rows created at the FP exit) and stamp
  `sequence.auto_annotate_enqueued_at = now`.
- **Post-commit**: defer `auto_annotate_sequence` for the lane (same
  mechanism as the `/auto-annotate` endpoint). `apply_annotation_update`
  returns this as a flag alongside `run_auto_create`; both callers (the PATCH
  endpoint and `classify-submit`) defer after their commit.

Every other stage write on the PATCH path stays exactly as it is — the new
handling is scoped to the promote case.

### 3. Reclassify enablement and round trip

- `LocalizeAlertPage.objectActionProps` drops the false-positive withholding
  so `onReclassify` is offered on FP rows too; `LocalizeObjectRow` drops any
  corresponding guard. The round trip from the reclassify spec
  (`docs/specs/2026-08-04-localize-reclassify-object-design.md`) —
  `/classify/done/:id?return=/localize/:id`, save, navigate back — needs no
  change.
- **Freshness**: done-mode submit invalidates `alert-detail` but not the
  detection-annotation queries, so the localize page could redraw the
  promoted lane against cached (now-deleted) detection annotations and show
  every frame confirmed. Done-mode submit's `onSuccess` additionally
  invalidates `QUERY_KEYS.DETECTION_ANNOTATIONS`.
- On return, the promoted lane is immediately workable on `/localize/:id`
  (reference layer falls back to engine boxes until the auto pass lands —
  existing behavior for fresh smoke lanes); it appears in the Localize queue
  once the deferred job stamps `auto_annotated_at`.

## Testing

- `determineClassifySubmitStage`: FP-annotated → smoke demotes;
  FP-annotated → still-FP stays; smoke-annotated (flip-flop) stays;
  FP-annotated → unsure stays.
- Backend: PATCH promoting an FP lane returns 200 with stage
  `seq_annotation_done`, deletes the empty detection annotations, stamps
  `auto_annotate_enqueued_at`, and defers the job; a lane with committed
  boxes gets 422; `classify-submit` handles the defer flag the same way.
- `LocalizeAlertPage`: FP rows render `Reclassify`, with the same
  destination/return behavior as smoke rows.

## Files

- `frontend/src/utils/annotation/localizeUtils.ts`
- `frontend/src/pages/ClassifyAlertPage.tsx`
- `frontend/src/pages/LocalizeAlertPage.tsx`
- `frontend/src/components/localize/LocalizeObjectRow.tsx`
- `annotation_api/src/app/api/api_v1/endpoints/sequence_annotations.py`
