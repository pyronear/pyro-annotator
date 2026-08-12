# Adding a missed object on /localize/:id

**Date**: 2026-08-11
**Status**: Approved
**Base**: `main` @ `6f7cf087`

## Problem

The alert API's detector misses plumes. When an annotator sees one on
`/localize/:id`, the page has nothing to offer: the missed-smoke Yes answer
records `has_missed_smoke` and then points at the Skip alert escape hatch
(`LocalizeMissedSmokeRow.tsx:75-81`), parking the alert for a day when drawing
is supported. This is that day.

`POST /sequences/alert/add-object` and `apiClient.addObject` were deliberately
kept when PR #312 retired the UI, exactly so the feature could return. It comes
back with the drawing flow it was missing, and with the removal path that never
existed.

## Decisions

1. **The frame range defines the lane.** The new lane holds Detection rows only
   for the frames the annotator marked the object visible on — the same
   statement every importer-split lane makes.
2. **One box, copied across the range.** The annotator boxes the first frame of
   the range and every other frame in it gets the same box — a first draft to
   refine per frame in the editor afterwards. *(Amended 2026-08-12: this
   originally specified two anchors with the frames between interpolated by
   elapsed time. Interpolation is deferred — see §3.3.)*
3. **The entry point is the missed-smoke section.** Yes unlocks the work
   instead of pointing at the exit.
4. **One atomic POST.** The request carries the complete per-frame box list;
   `add_object` writes lane, detections, sequence annotation and every
   detection annotation in the transaction it already opens.
5. **Manual lanes are marked and deletable.** A new `Sequence.is_manual` column
   gates a hard delete; imported lanes are refused.

## 1. Data model

One new column on `Sequence` (`models.py:201-258`), one migration:

```python
# True only for lanes a human added via POST /sequences/alert/add-object.
# Gates DELETE /sequences/{id}: an imported lane can never be removed.
is_manual: bool = Field(default=False)
```

It cannot be inferred. `add_object` assigns
`ALERT_ID_BASE + platform_alert_id * 1000 + next_index` (`sequences.py:790`) —
the identical formula the importer uses when it object-splits a sequence — so a
delete gated on "object index ≥ 1" would destroy real imported objects. The
weak signatures (empty `algo_predictions`, `auto_annotated_at` stamped at
creation, a one-track annotation with `bboxes: []`) are heuristics, not
guarantees.

The column earns its keep twice: it also resolves the submit nag in §5.

It must be **plumbed through explicitly** — `SequenceRead`
(`schemas/sequence.py:144-167`) enumerates its fields rather than deriving them
from the model, so `is_manual: bool` is added there, and to the frontend
`Sequence` interface (`types/api.ts:8-30`). `AlertLane` wraps `SequenceRead`,
so the localize page reads it as `lane.sequence.is_manual` with no further
wiring.

## 2. Backend

### 2.1 `POST /sequences/alert/add-object`

`AddObjectRequest` (`schemas/sequence.py:303-310`) gains the frame list. **The
frame list is the range** — there is no separate range field:

```python
class AddObjectFrame(BaseModel):
    recorded_at: datetime
    xyxyn: tuple[float, float, float, float]

class AddObjectRequest(BaseModel):
    source_api: SourceApi
    platform_alert_id: int
    smoke_type: SmokeType
    frames: list[AddObjectFrame] = Field(..., min_length=1)
```

Changes inside `add_object` (`sequences.py:754-...`), all within its existing
single transaction:

- `is_manual=True` on the new `Sequence`.
- Clone detections for **only** the requested `recorded_at` values, instead of
  every detection of the richest lane (`sequences.py:806-851`). Keep the
  richest-lane selection as the source; a requested timestamp no sibling lane
  has is a 422, mirroring `materialize_frame`'s own guard
  (`sequences.py:975-979`).
- Fill the per-frame `DetectionAnnotation` rows. These already exist: today
  `add_object` seeds one per cloned detection with `{"annotation": []}` at
  `BBOX_ANNOTATION` ("the annotator draws each one"). Now the box arrives with
  the request, so the row is born committed at `ANNOTATED` instead — and it
  must be, because this lane has empty `algo_predictions` by construction, so
  nothing could ever fill a pending row:

  ```python
  DetectionAnnotation(
      detection_id=det.id,
      annotation={"annotation": [
          {"xyxyn": frame.xyxyn, "class_name": "smoke", "smoke_type": payload.smoke_type}
      ]},
      processing_stage=DetectionAnnotationProcessingStage.ANNOTATED,
  )
  ```

  This is the same row `saveDetectionReview` produces per frame
  (`laneAnnotationSave.ts:42-46`), written server-side so a 19-frame object is
  one request rather than 19 sequential ones with a half-boxed failure mode.

Unchanged: `auto_annotate_enqueued_at`/`auto_annotated_at` stay stamped at
creation so the sweep never GPU-processes the lane; the `SequenceAnnotation` is
still born at `seq_annotation_done` with
`sequences_bbox: [{is_smoke: true, smoke_type, false_positive_types: [], bboxes: []}]`.

**`bboxes` stays empty.** Checked, since for the first time we *have* boxes at
creation: `export.py` reads `sequences_bbox[].bboxes` only through
`_fp_lane_bboxes_by_detection`, and only for false-positive lanes
(`export.py:106-117, 341`). A manual lane is a smoke lane, so nothing reads it.
Populating it would make manual lanes shaped unlike every other smoke lane for
no consumer's benefit.

### 2.2 `DELETE /sequences/{sequence_id}`

`delete_sequence` (`sequences.py:1862-1868`) gains one guard:

```python
if not sequence.is_manual:
    raise HTTPException(409, detail=(
        "Only manually added objects can be removed. "
        "To retire an imported object, reclassify it as a false positive."
    ))
```

The existing delete path is already correct for this and needs no other change:

- `SequenceCRUD.delete` → `BaseCRUD.delete` (`crud/base.py:207-212`) is a plain
  SQL `DELETE`. `SequenceCRUD` (`crud_sequence.py:15-17`) adds no override.
- **No S3 call anywhere in the path.** This matters: a manual lane's detections
  share `bucket_key` with the sibling they were cloned from, so purging the
  bucket would take the sibling lanes' photos with it. The only endpoint that
  deletes from the bucket is `DELETE /detections/{id}`
  (`detections.py:350-351`), which this flow never calls.
- `Detection.sequence_id` is `ondelete="CASCADE"` (`models.py:403-405`) and
  `DetectionAnnotation.detection_id` cascades off that (`models.py:429-431`),
  so the rows go cleanly.

Everything reachable from an `is_manual` lane was created by the add-object
flow itself: cloned Detection rows (duplicates of a sibling's, with
`algo_predictions: {"predictions": []}` — no model output exists to lose), the
lane's own `SequenceAnnotation`, and the boxes the annotator drew. Nothing
imported and nothing belonging to another lane is reachable. That is why a hard
delete is acceptable here and a soft delete (which would mean auditing 22
`Sequence` query sites across 8 files) is not worth its cost.

Retiring an **imported** object is a different operation with an existing
answer: reclassify it as a false positive. `buildAlertFrameModel` computes
`workable = !falsePositive && stage === 'seq_annotation_done'`
(`alertLocalizeUtils.ts:161`) and drops false-positive lanes from the model
entirely unless the FP toggle is on, where they render read-only and never
enter the submit gate. The Reclassify action in the CTA bar already routes
there.

## 3. Frontend — the flow

### 3.1 Entry point

`LocalizeMissedSmokeRow` regains the `onAddObject` slot the skip-nudge spec
deleted. When `hasMissedSmoke` and the page is in queue mode, the nudge copy is
replaced by a primary **+ Add object** button; `N` is the shortcut. `showSkipNudge`
goes away.

Skip alert survives unchanged as the escape hatch for what drawing cannot fix
(unusable frames, an alert that can't be judged), but **loses its ember glow**
(`LocalizeAlertPage.tsx:1941`) — it existed to steer a Yes answer toward the
exit, and would now steer people away from the work. The `animate-skip-glow`
keyframes stay in `tailwind.config.js`, unused.

### 3.2 The overlay: one screen, two phases

A new page-level overlay, opened from the rail and closed on Escape. It
composes the editor's canvas with a new range strip. Like every other overlay
on this page, it must suspend `LocalizeAlertPage`'s Tab-cycle and shortcut
keyboard guards while open.

**Phase 1 — set the range.** The strip shows every alert frame. Click the first
frame the object appears on, then the last; `←`/`→` step and `Enter` sets a
boundary. The stage above shows whichever frame is focused, full size, **with
the other objects' boxes drawn on it** — that is how the annotator answers both
"has the plume started yet?" and "is this already Object 1?".

The stage is the large preview, which is why there is no hover popover. Note
the rail rows carried one and it was deliberately removed
(`LocalizeAlertPage.tsx:38-41`); a popover also occludes the neighbouring
frames, which are exactly what a boundary decision compares against.

**Phase 2 — box both ends.** The annotator boxes the first frame of the range,
then the last, on the editor's own canvas. While placing the second, the first
box renders **ghosted** for reference. Every in-range strip thumbnail shows its
interpolated box live, so the strip *is* the propagation preview. Stepping back
to either anchor and redrawing recomputes the tween.

A footer carries the smoke type chips (`wildfire` / `industrial` / `other` —
`models.py:89-95`) and **Create object**, enabled once both anchors are boxed.
There is no separate confirm step.

On success the overlay closes and the page navigates to the new lane's editor
so per-frame refinement can start immediately.

### 3.3 The per-frame boxes

Computed **on the client**, so the strip preview and the stored data are
identical by construction with no second implementation on the server to drift
from.

`src/utils/annotation/objectRangeBoxes.ts`:

```ts
export function fillRangeBoxes(
  recordedAts: string[],                        // in range, chronological
  box: [number, number, number, number]         // drawn on the first frame
): { recordedAt: string; xyxyn: [number, number, number, number] }[]
```

**Interpolation is deferred** *(amended 2026-08-12)*. The original design had
the annotator box both ends of the range and tweened the frames between,
**weighted by elapsed time rather than frame index** — alert frames are not
evenly spaced, and `ObjectFilmstrip`'s own docs note cells "can sit anywhere
from two seconds to two minutes apart", so index weighting misplaces the middle
boxes. That was built, tested and then removed in favour of the simpler
one-box flow.

The reasoning that motivated it still holds: one box copied across a long range
is too small at the end and too big at the start, because smoke grows. The
mitigation is that the copy is explicitly a first draft and per-frame
refinement in the editor is the second half of the job. If interpolation
returns, only `objectRangeBoxes` and the overlay's draw phase change —
everything downstream (the strip, the request, `add_object`) already takes an
explicit per-frame box list, which is exactly why that shape was chosen.

### 3.4 The range strip

A **new sibling component**, not a mode on `ObjectFilmstrip`. That component's
entire encoding answers "where did this box come from, and has it been
accepted?" — solid = committed from that source, dashed = that source offers a
box, hatched = no source found anything, plus chevron stepping and a position
readout. A brand-new object has no manual/auto/engine sources and nothing
committed, so nearly every state it can draw is unreachable here, and a range
mode would mean a prop that switches off most of a component the editor depends
on. `ObjectFilmstrip` is left untouched — no regression risk to the editor.

`src/components/localize/add-object/ObjectRangeStrip.tsx` — states: out of
range, in range, the two anchors (heavier border), the focused frame (scaled).
Once anchors are boxed, in-range thumbnails crop to their interpolated box.
`FilmstripThumbnail` is the shared atom: it already crops a frame to an
`xyxyn`.

Entries are built by a small sibling of `buildFilmstripEntries` — the existing
builder derives runs from a lane's detected span, and there is no lane yet.
`FilmstripEntry` itself needs no change: it already handles a frame the object
is not on by borrowing a sibling's `detectionId` for the photograph
(`objectFilmstrip.ts:64-73`).

### 3.5 Deleting an object

`LocalizeObjectActions` gains a **Remove object** action, rendered only for
lanes with `is_manual` (surfaced on `SequenceRead`) and only in queue mode. It
confirms before firing — the boxes are the annotator's own work — and on
success invalidates the alert detail and selects a neighbouring object.

Imported lanes get no such control; their Reclassify button is already the
answer, and the API refuses them regardless.

## 4. Adjusting the range afterwards

No new code. Both directions already work on a manual lane, and the semantics
fall out correctly on their own:

- **Extend** — open the object editor and click a frame outside the object's
  span in its filmstrip. That *peeks* rather than navigating (local state, the
  URL does not move — `LocalizeObjectEditor.tsx:393-405`); drawing there fires
  `onCommitGapFrame` → `POST /sequences/{id}/frames`, which clones the
  sibling's `bucket_key` with no S3 traffic.
- **Trim** — `Delete`/`Backspace` on a boxed frame. `clear()`
  (`LocalizeObjectEditor.tsx:377-383`) unmaterializes rather than committing
  empty whenever the frame has no model evidence, and `add_object` writes
  `algo_predictions: {"predictions": []}` while stamping `auto_annotated_at` so
  `auto_predictions` never arrives — so `hasModelEvidence`
  (`objectBoxCandidates.ts:112-117`) is false on **every** frame of a manual
  lane, and Delete always trims the range.

Out-of-range cells in the alert grid stay read-only
(`AlertFrameGrid.tsx:199-210`). Adjusting the range is an editor operation.

## 5. Knock-ons

**`has_missed_smoke` is not cleared when an object is added.** It records that
*the detector* missed a plume — the false-negative signal worth keeping, and
what makes these alerts findable later. It is not a to-do item.

**The submit soft-confirm must therefore stop firing.**
`softConfirmNeeded = anyLaneFlagged && !softConfirmResolved`
(`LocalizeAlertPage.tsx:450`) would otherwise nag at submit on every alert where
the annotator did exactly the right thing. It becomes:

```ts
const alertHasManualObject = alertDetail?.lanes.some(l => l.sequence.is_manual) ?? false;
const softConfirmNeeded = anyLaneFlagged && !alertHasManualObject && !softConfirmResolved;
```

When it does still fire (flag set, nothing added), its copy no longer says
adding isn't supported; the primary action stays Skip alert.

**`GuidePage`** describes skipping the alert in the localize section — reword to
describe adding the missed object.

## 6. Scope

Deliberately excluded:

- **Non-contiguous ranges.** One start, one end. An object that vanishes and
  returns is handled afterwards in the editor.
- **More than two anchors during creation.** Refining individual frames is what
  the existing editor is for; the new object opens in it right after Create.
- **Skipping the second anchor.** Create stays disabled until both are boxed —
  copying one box across the range reintroduces exactly the too-small-at-the-end
  problem interpolation exists to fix.
- **Changing the range after drawing** re-asks the anchors rather than
  re-anchoring boxes onto frames that may have left the range.
- **Adding false-positive objects.** Only missed smoke is ever added; if it
  turns out not to be smoke, Reclassify handles it.
- **Adding from `/localize/done/:id`.** Queue mode only. Issue #313's
  annotated-but-flagged backlog is a follow-up: a lane added to a done alert
  re-queues it, which needs its own thinking.
- **Soft delete.** §2.2.

## 7. Testing

Backend (`annotation_api/src/tests/endpoints/`):

- `test_add_object.py` — existing cases stay green (the new field is required,
  so they gain a minimal `frames` list). New: only the requested frames are
  cloned; one `DetectionAnnotation` per frame with the sent box and
  `processing_stage=annotated`; `is_manual` is set; a `recorded_at` no sibling
  lane has is a 422; the whole thing rolls back as one transaction.
- New `test_delete_sequence_guard.py` — deleting an `is_manual` lane succeeds
  and cascades to its detections and annotations; deleting an imported lane is
  409; **the sibling lane's detections and their `bucket_key`s survive**.

Frontend (`frontend/tests/` — never run prettier on `tests/**`):

- `objectRangeInterpolation.test.ts` — time-weighted, not index-weighted (the
  discriminating case is unevenly spaced frames); one-frame and two-frame
  ranges; identical-timestamp fallback.
- `LocalizeAlertPage.test.tsx` — Yes shows the Add object button, not the skip
  nudge; the Skip button has no glow; the overlay suspends the keyboard guards;
  soft-confirm does not fire when a manual object exists but does when the flag
  is set alone; Remove object appears only on `is_manual` lanes.
- Overlay component tests — range selection produces the expected frame list;
  Create is disabled until both anchors are boxed; the request body carries one
  entry per in-range frame.

## 8. Follow-ups

- Issue #313: annotated-but-flagged alerts (`ANNOTATED && has_missed_smoke`) —
  the backlog this feature was waiting on. Adding a lane to a done alert
  re-queues it naturally, but the flow needs its own design.
- `is_manual` retro-marking: lanes added by the pre-#312 UI are indistinguishable
  from imported ones and will default to `false`, so they can never be deleted.
  Accepted — the count is small and the failure is safe.
