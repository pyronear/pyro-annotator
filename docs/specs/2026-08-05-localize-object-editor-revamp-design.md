# Localize object editor revamp

Date: 2026-08-05
Status: approved, not implemented

## Problem

`/localize/:sequenceId/object/:laneId/:detectionId` opens `ImageModal` over the
localize cockpit. The route already names the object
(`docs/specs/2026-08-04-localize-object-editor-route-design.md`), but the
screen behind it does not think in objects. It thinks in *layers*: a
`showPredictions` master checkbox, an exclusive engine/auto toggle, an
unbounded array of drawn rectangles, and a per-model-box review vocabulary
(`rejectedBoxes`, `adjustedBoxes`, `selectedModelBox`) built for a frame that
might hold any number of boxes belonging to nobody in particular.

The task the screen actually serves is narrower: **look at what the models
think this one object is on this one frame, and if it is wrong, fix it.** Under
the object concept that is a choice between at most three candidate boxes —
manual, auto, engine — of which exactly one is committed.

This spec rebuilds the editor around that. It also gives the object's frames a
visualization, and lets the annotator look at frames outside the object's own
detected range, where the detector may have missed fainter smoke.

## Scope

**In:** the editor's layout, its box model, the filmstrip, frame navigation,
keyboard shortcuts, save semantics, and the tests for all of it.

**Out:** the route, the URL builders, and the cockpit's own behavior — all
unchanged. Drawing on a frame outside the object's range, missed-smoke-as-a-new-object,
and backend enforcement of the one-box invariant are each deferred; see
[Deferred work](#deferred-work).

The editor **stays an overlay** over the mounted cockpit, for the reason the
route spec gives: closing it preserves the cockpit's scroll position, crop
mode, active object and card size for free.

## The one-box invariant

**An object has at most one box per frame.** Whatever the source.

This is already true of the data and enforced by nothing. Measured against the
development database (10,047 detections, 191 detection annotations):

| | 0 boxes | 1 box | >1 box |
|---|---|---|---|
| engine (`algo_predictions`) | 48 | 9,999 | 0 |
| auto (`auto_predictions`) | — | 275 | 0 |
| committed smoke boxes | — | — | 0 |

Nothing in the pipeline guarantees it. `object_split.py:208` writes
`own_by_frame[key]`, a list — an IoU cluster can absorb two boxes on one frame.
`worker.py:109` keeps every sensitive-model box overlapping the lane's anchor.
`ImageModal`'s `drawnRectangles` is an unbounded array.

A plume that visually forks into two strands and rejoins is still one fire's
smoke, and is boxed as one box enclosing both strands. Modelling the fork as
1→2→1 boxes would make the object's per-frame status stop being binary, and
every consumer — the filmstrip badge, "does this object have a box here", the
YOLO export — would grow a multi-box case for a transient visual artifact. A
*persistent* split is a second fire, which is a second object; "+ Add object"
already handles that.

**This spec enforces the invariant in the editor only.** Backend schema
enforcement is deferred (see below) — the data already complies, so a validator
buys correctness against future writers rather than fixing anything today.

The editor never *assumes* the invariant of its inputs, though. It models
candidates as a list, so a layer that returns two boxes renders as two
candidate rows rather than reaching an unhandled branch.

## Box model

One new pure module, `src/utils/annotation/objectBoxCandidates.ts`:

```ts
export type BoxSource = 'manual' | 'auto' | 'engine';

export interface BoxCandidate {
  source: BoxSource;
  /** Position within its source layer; 0 unless a layer returned several. */
  index: number;
  xyxyn: [number, number, number, number];
  confidence?: number;
}

/** Every box on offer for this object on this frame, in priority order. */
export function boxCandidates(
  detection: Detection,
  annotation: DetectionAnnotation | null
): BoxCandidate[];

/** The box currently written to the DB, or null. Its `source` comes from the
 *  committed item's `origin`. */
export function committedBox(annotation: DetectionAnnotation | null): BoxCandidate | null;

/** What would be committed if the annotator just says "yes": manual > auto >
 *  engine. Null when the frame has no candidate at all. */
export function priorityPick(candidates: BoxCandidate[]): BoxCandidate | null;
```

Sources:

- **manual** — the committed annotation's smoke box when its `origin` is
  `'human'`. A manual box exists only once drawn, because drawing saves
  immediately.
- **auto** — `detection.auto_predictions.predictions`.
- **engine** — `detection.algo_predictions.predictions`.

`boxCandidates` returns them sorted manual → auto → engine, so `priorityPick`
is `candidates[0]` and the rail renders in priority order for free.

False-positive annotation items (`smoke_type == null`) are not candidates and
are preserved on save, exactly as `saveDetectionReview` already does.

## Layout

The overlay is a header, an image stage with a source rail beside it, and a
filmstrip along the bottom.

```
┌──────────────────────────────────────────────────────────────┐
│ ◆ Object 2  wildfire        frame 18 / 30    2026-07-30  ✕   │
├───────────────────────────────────────┬──────────────────────┤
│                                       │ BOX FOR THIS FRAME   │
│         ┌┄┄┄┄┄┄┄┄┄┄┄┄┐  engine ghost  │  ▫ ● Manual  —       │
│         ┄  ┏━━━━━━┓  ┄                │  ▮ ● Auto ✓  .87     │
│         ┄  ┃ ▓▓▓▓ ┃  ┄  auto ✓        │  ▫ ● Engine          │
│         ┄  ┗━━━━━━┛  ┄                │                      │
│         └┄┄┄┄┄┄┄┄┄┄┄┄┘                │  [✏ Draw] [⌫ Clear]  │
├───────────────────────────────────────┴──────────────────────┤
│ FRAMES · alert 56231 · 30 total · object present on 12       │
│  before object      object 2                    after        │
│  ░ ░ ░ ░ ░ │ █ █ █ █ █ █ ▨ █ █ █ █ █ │ ░ ░ ░                 │
│  · · · · · │ A A E M A a — a a a a a │ · · ·                 │
└──────────────────────────────────────────────────────────────┘
```

### Source rail

One row per candidate, in priority order, each carrying a **crop of this
frame's image around the object's region with that candidate's box drawn on
it**. Same region across all rows, so "auto is tight, engine is baggy" reads
without moving your eyes to the photo. The crop region is the union of all
candidates plus padding, computed once per frame — it must not vary per row, or
the comparison is meaningless. A frame with no candidates has no region; its
rows are all disabled and render no crop.

The committed row is outlined and tagged ✓. Clicking any other row commits that
candidate. A source with no box renders as a disabled row (so the rail's shape
is stable across frames) reading `—`.

### Image stage

The committed box renders solid. Every other candidate renders as a dimmed
dashed **ghost**, labelled with its source, toggleable with `G`. Ghosts are how
you see *how* the models disagree, in context — the rail crops tell you which
is tighter, the stage tells you whether either is even on the right plume.

The committed box carries drag and resize handles at all times. Moving or
resizing it rewrites its `origin` to `'human'` and saves — that is the whole of
the old ✎ adjust flow, without a separate mode.

Zoom/pan (wheel, `+`, `-`, `R` to reset) is unchanged from `ImageModal`.

**Default view is the full frame**, with `Z` toggling to an object-crop view
built on `computeCellCrop(boxes) → { scale, originX, originY }`
(`gridCropUtils.ts:44`, already used by the cockpit's crop-mode grid cells).
Its output maps directly onto the canvas's existing `zoomLevel` and
`transformOrigin` props, so the toggle is a state change, not a second
rendering path. The choice of default is deliberately unresolved:
full-frame preserves the context that catches "the box grabbed the wrong
plume", object-crop makes tightness judgements immediate. `Z` persists as a
preference so the default can be changed later from use rather than from
argument. When no candidate exists, `Z` is a no-op — there is nothing to crop
to.

### Filmstrip

Spans the **alert's** full frame range, not the object's. Entries come from the
existing `frameModel.frames` (already keyed by `recordedAt` across every lane),
so no new data loading.

Each entry is a thumbnail cropped to the object's region, plus a badge:

| badge | meaning |
|---|---|
| `A` `E` `M` bold | a box is committed, from auto / engine / manual |
| `a` `e` lowercase, dimmed | that source has a box available, nothing committed yet |
| `—` | the object is on this frame but no source offers a box |
| `·` dimmed, desaturated thumb | the object is not on this frame at all |

Frames group into three runs — *before object*, *object N*, *after* — labelled
above the strip. On 92.6% of lanes the outer runs are empty and the strip is
just the object's own frames. Clicking an entry navigates to it.

## Frames outside the object's range

A lane holds Detection rows only for the frames where its object was detected
(`object_split.py:198` builds each object's records from `own_by_frame`). In
the development database, 35 of 475 lanes (7.4%) cover fewer frames than their
alert, missing 12.6 frames on average. Alert 56231 has lanes of 30, 4 and 30
frames over the same 14 minutes.

Those are exactly the frames worth checking: a plume the detector first picked
up on frame 27 was probably faintly visible on frame 3. Today the editor cannot
reach them — prev/next steps `laneDetectionsSorted`, the object's own
detections.

**This spec makes them viewable, not editable.** The image is sourced from the
alert's sibling lane detection at the same `recordedAt` (the same photo). All
three rail rows are empty, Draw is disabled with the reason stated, and a
banner marks the frame as outside the object. Drawing there requires a
Detection row in this lane, which requires a backend endpoint — deferred.

### Out-of-range frames stay out of the URL

`:detectionId` must belong to `:laneId`; refusing a mismatch is the entire
point of the route spec's third invalid-URL row. A gap frame has no detection
in this lane, so it cannot be named without weakening that guard.

Viewing one is therefore **local component state**. The URL continues to name
the last in-object frame, and stepping back into range resumes updating it. A
shareable link to a frame nobody can act on is not worth the guard.

Consequence to accept: reloading while peeking at a gap frame lands on the last
in-object frame. Correct — the reloaded screen is one the user can work on.

## Interaction

### Save semantics

Every commit action writes immediately through the existing
`saveDetectionReview`. Stepping frames never writes. There is no Submit button;
`SubmissionControls` is removed from this screen. Nothing is ever pending, so
closing needs no confirmation and no dirty-state tracking.

Bulk accept and alert submit stay where they are — on the cockpit's rail. The
editor is for fixing individual frames, not for sweeping.

Save failure surfaces through the existing toast (`Failed to save frame — try
again`) and the rail reverts to the previously committed state.

### Three affordances replace the review vocabulary

`rejectedBoxes`, `adjustedBoxes` and `selectedModelBox` are removed. No
capability goes with them:

| removed | replacement |
|---|---|
| ✗ reject a model box | **Clear** — the frame ends with no committed box |
| ✎ adjust (hide original, seed an editable copy) | the committed box always has drag/resize handles; editing flips its origin to `human` |
| draw a rectangle | **Draw** — one box, replacing whatever was committed |

### Keyboard

| key | action |
|---|---|
| `←` `→` | step one frame, across the full strip including out-of-range frames |
| `Enter` | commit the priority pick and advance (in-object frames only; no-op when there is no candidate) |
| `D` | draw |
| `G` | toggle ghost candidate boxes |
| `Z` | toggle full-frame ↔ object-crop |
| `Esc` | close (or cancel an in-progress drawing first, as today) |
| wheel `+` `-` `R` | zoom, unchanged |

`Enter` is what makes stepping fast: sweep with `→`, hit `Enter` on the frames
that look right, `D` on the ones that don't.

Bindings are added to `src/utils/annotation/keyboardUtils.ts`. `G` and `Z` must
be checked against the existing map before implementation; if either clashes,
pick a free key rather than rebinding an established one.

### Per-box smoke type is removed

`AnnotationToolbar`'s smoke-type selector and the `1`/`2`/`3` per-box retype
shortcuts go. Under the object concept smoke type belongs to the *object* —
classify sets it, and the cockpit rail's **Reclassify** action changes it. A
per-frame override could only produce an object whose frames disagree about
what it is.

The object's smoke type renders read-only in the editor header.
`selectedSmokeType` is still seeded from `sequenceSmokeType(lane.annotation)`
and still stamped onto every box the editor commits — only the *control* goes.

## Components

New, under `src/components/localize/editor/`:

- **`LocalizeObjectEditor.tsx`** — the overlay shell. Owns frame navigation,
  the peeked-frame state, and the commit handlers. Takes explicit props (lane,
  detections, annotations, alert frames, callbacks) rather than reading routes
  or queries, so the follow-up missed-smoke session can mount it against a
  different data source without a rewrite.
- **`BoxSourceRail.tsx`** — the candidate list and its crops. Pure
  presentation over `BoxCandidate[]` plus the committed source.
- **`ObjectFilmstrip.tsx`** — the full-alert-span strip, its three runs, and
  its badges.

Reused as-is: `computeSquareCrop` (`squareCropUtils.ts:45` — the canvas
source-rect crop `CroppedImageSequence` already uses, for the rail crops and
the filmstrip thumbnails), `computeCellCrop` (the CSS-transform crop, for the
`Z` stage view), `saveDetectionReview` (writes), `getObjectColor` (identity
color), `formatDateTime`.

Changed: **`DetectionAnnotationCanvas`** simplifies to a single committed box
plus ghosts, dropping the per-model-box review props
(`rejectedBoxes`/`hiddenBoxes`/`selectedModelBox`/`onRejectModelBox`/`onAdjustModelBox`)
and the multi-rectangle array. Its zoom/pan/draw/coordinate plumbing is
retained unchanged — that part is sound and non-trivial.

Removed once migrated, with their tests: `ImageModal.tsx`,
`AnnotationToolbar.tsx`, `SubmissionControls.tsx`. Each is used only by
`ImageModal`, which is used only by `LocalizeAlertPage`, so the subsystem is
closed and removal ripples nowhere.

`materializeReviewAnnotation`, `buildQuickSubmitPlan` and
`getWinningModelLayer` stay — the cockpit's bulk-accept path depends on them.
The editor simply stops being one of their callers.

## Changes in `LocalizeAlertPage`

`modalContext`, `closeModal`, `navigateModal`, `saveDetection` and the
smoke-type seeding effect are unchanged. The page swaps `<ImageModal>` for
`<LocalizeObjectEditor>` and passes it the alert frame model it already builds,
so the filmstrip can span the alert.

`objectOverlays` — the other objects' boxes on this frame — is retained and
still rendered, so an annotator can tell "that plume is already someone else's"
before drawing.

Two things do change:

- **`handleModalSubmit` loses its `currentDrawMode` parameter and its
  `setPersistentDrawMode` call**, along with the `persistentDrawMode` /
  `isAutoAdvance` props. Draw mode is per-frame under the new model: `D` arms a
  single box and committing it disarms, so there is nothing left to persist
  across frames. Its signature becomes
  `(detection, items, options?: { autoSave?: boolean })`. Since every editor
  action now autosaves, the non-`autoSave` branch — toast plus `closeModal` —
  no longer has a caller and goes with it; saves are silent on success and
  toast only on failure.
- **Frame navigation splits in two.** In-range frames still route through
  `navigateModal` so the URL tracks them. Out-of-range frames are held in the
  editor's own state, so `LocalizeObjectEditor` takes both an
  `onNavigateToDetection(detectionId)` callback and the alert's frame list, and
  decides which mechanism a given step uses.

## Testing

New, in `tests/components/localize/editor/` and
`tests/utils/objectBoxCandidates.test.ts`:

- `boxCandidates` orders manual → auto → engine, omits absent sources, and
  returns two rows when a layer holds two boxes.
- `committedBox` reads the committed item's `origin`; returns null for an
  annotation holding only false-positive items.
- `priorityPick` returns manual over auto over engine, and null on an empty
  frame.
- Clicking a non-committed rail row saves that candidate's box with its own
  `origin`.
- Drawing replaces the committed box and saves exactly one item with
  `origin: 'human'`.
- Dragging the committed auto box flips its saved `origin` to `'human'`.
- Clear saves an annotation with no smoke box, preserving false-positive items.
- `Enter` commits the priority pick and advances; on a frame with no candidate
  it neither saves nor advances.
- Stepping frames with `←`/`→` issues no save.
- The filmstrip renders the alert's full frame count, badges committed vs
  available vs absent, and marks out-of-range frames.
- Stepping into an out-of-range frame disables Draw, empties the rail, and
  leaves the URL naming the last in-object frame.
- Stepping back into range resumes updating the URL.
- A lane covering the alert's full span renders no out-of-range runs.

Migrated from `tests/components/detection-sequence/ImageModal.test.tsx` and
`tests/pages/LocalizeAlertPage.test.tsx`: every assertion about opening,
closing, prev/next, URL shape and the false-positive read-only case. These move
to the new component; none is deleted rather than migrated.

Success criteria: `npm run quality` clean, full suite green.

## Deferred work

Each is out of scope here and tracked separately.

| | needs backend |
|---|---|
| Draw missed smoke as a new object | No — `add_object` (`sequences.py:766`) already copies the richest sibling's full frame set into the new lane, so a fresh object arrives drawable. Frontend-only follow-up. |
| Draw on a frame outside an object's range (#287) | Yes — one additive endpoint (below). |
| Enforce ≤1 smoke box per detection annotation (#286) | Yes — a validator in `annotation_validation.py`. All 191 existing rows already comply. |

The gap-frame endpoint, sketched so the follow-up starts from a known shape:

```
POST /api/v1/sequences/{lane_id}/frames   { recorded_at }

  → find the alert sibling's detection at that recorded_at
  → INSERT Detection(sequence_id=lane_id, recorded_at,
                     bucket_key=sibling.bucket_key,
                     alert_api_id=sibling.alert_api_id,
                     algo_predictions={"predictions": []})
  → return the new Detection
```

The insert is the easy part; it mirrors what `add_object` already does. The
work is in the consequences: the localize **submit gate** requires every frame
of a workable object to carry a box, so materializing a frame creates an
obligation — the drawn box must be saved in the same flow or the object becomes
un-submittable. `buildAlertFrameModel` and the cockpit grid also gain a cell
that was not there, and an added-then-emptied frame needs a defined fate.

## Amendments from use

Everything above is the design as approved. The following changed while the
screen was being used, and the shipped behaviour is what this section says.

**The canvas is modeless.** Drawing was a mode entered with `D`, a button, or
the Manual row. A drag on the image now draws a box; space+drag or a
middle-drag pans; a press that never moves is a click, which deselects.
Two-click drawing is gone — always armed, it would let a stray click begin a
box with nothing on screen to say so. `D` and the Draw button went with it, and
the Manual row stopped being a control ("drag on the image").

**The stage opens framed on the object**, at `targetFill` 0.32 and at most 3×,
rather than on the full frame. The spec left this to use; use answered it.
`computeCellCrop` takes the framing as options, so the grid keeps its own
tighter defaults.

**Box colour encodes the source, not the smoke type** — an object has one smoke
type across every frame, so that colour never varied. High-chroma hues
(magenta / cyan / amber) with a dark halo, chosen because they do not occur in
a wildfire frame; the manual > auto > engine hierarchy rides on stroke weight,
which survives a photograph where a lightness ramp does not. Strokes divide by
the zoom so they hold their on-screen weight.

**Selection is real.** The committed box renders unselected with no handles;
clicking selects it, Escape or a click away deselects, and a frame change drops
it. It had been permanently "selected" purely to carry its handles.

**The losing candidates hide once a box is committed** — the committed box
speaks for the object, and the rail's crops carry the comparison — and ghost in
when nothing is, where the frame would otherwise be blank. `G` flips either
state. The alert's other objects are off by default, behind `O`.

**Accepting the model on the rest of the object is offered here**, not only on
the cockpit rail, through the same mutation. Its confirmation is a popover
carrying the object's projected track (`collectLaneBoxes` returns exactly the
post-accept boxes) and a warning naming the frames no model found smoke on,
which never blocks — those are precisely what keep the alert off the submit
gate. **Reclassify** sits beside it.

**The filmstrip owns frame position and stepping.** Its cells encode state in
their border — solid source colour for accepted, dashed for on offer, hatched
signal for a hole, faint for out-of-object — with no letters, since the rail
names every colour. The current frame is marked by size and shows its clock
time.

**Shortcuts moved behind a Keyboard button** (or `?`), matching the classify
cockpit's sheet, and `Delete` removes the frame's box.

The screen is on DESIGN.md's tokens throughout; it had been the app's only dark
surface, inherited from `ImageModal` rather than chosen.
