# Removing an object's box on a frame from the localize object editor

**Date:** 2026-08-11
**Status:** Approved
**Scope:** `frontend/src/utils/annotation/objectBoxCandidates.ts`,
`frontend/src/utils/annotation/objectFilmstrip.ts`,
`frontend/src/components/localize/editor/LocalizeObjectEditor.tsx`,
`frontend/src/components/localize/editor/BoxSourceRail.tsx`,
`frontend/src/components/localize/editor/ObjectFilmstrip.tsx`,
`frontend/src/components/localize/editor/AcceptRemainingPopover.tsx`,
`frontend/src/components/localize/editor/EditorShortcutsModal.tsx`

## Problem

In `/localize/{id}`, with an object's editor open, there is no way to say
"this object has no box on this frame". Two symptoms, one cause.

**A model's proposal cannot be rejected.** On a frame where nothing is
committed, the priority pick ghosts in dashed on the stage. That ghost is
inert: `DetectionAnnotationCanvas.tsx:191` renders the ghost layer
`pointer-events-none` — deliberately, "so they never steal pointer events
away from drawing or from the committed box" — so it cannot be clicked,
selected, or dragged. Meanwhile `Delete` is guarded on there being a
committed box (`LocalizeObjectEditor.tsx:852`), so it is a no-op. The only
available answers are "accept it" (Enter, or the rail row) and "draw over
it". "No, there is nothing here" is unsayable.

**A committed model box that IS deleted appears to come back.** `clear()`
writes an empty annotation, but `boxCandidates()` rebuilds from
`detection.auto_predictions` / `algo_predictions`, which a clear never
touches. So `priorityPick` hands the same box straight back: the dashed
ghost reappears on the stage, the filmstrip re-marks the frame as
pending-with-a-box-available, and the "Accept boxes" count
(`LocalizeObjectEditor.tsx:913`) counts it again. Nothing about the editor
distinguishes "decided: empty" from "not decided yet".

The rest of the app already makes that distinction. PR #311 added
`cleared` to `ObjectFrameStatus` (`alertLocalizeUtils.ts:75`, derived at
`:206`) for exactly this state, counts it as settled in
`objectLocalizeProgress`, and `buildQuickSubmitPlan` skips it. **The editor
is the one surface that never learned the state** — named as known
leftover scope in `2026-08-06-localize-cleared-frame-state-design.md`.

A third consequence falls out of the same gap: a frame where neither model
produced a box (a "hole") can never be settled at all. Nothing exists to
accept and nothing exists to delete, so the frame keeps its lane off the
submit gate permanently.

## Behavior

1. **The editor gains the `cleared` frame state.** A frame is cleared when
   its annotation is committed (`processing_stage === 'annotated'`) and
   holds zero smoke boxes — the same derivation `alertLocalizeUtils.ts:206`
   uses. Per-frame vocabulary becomes:

   | Frame is | Stage draws | Rail | Filmstrip cell | "Accept boxes" |
   | --- | --- | --- | --- | --- |
   | Confirmed | solid box | source row pressed | solid, source colour | skips |
   | **Cleared** | **nothing, plus a "no box on this frame" chip** | **None row pressed** | **neutral solid border, muted thumbnail** | **skips** |
   | Undecided | dashed ghost | nothing pressed | dashed, source colour | fills |
   | Hole | nothing | every row empty | red hatched | cannot fill |

2. **`Delete` / `Backspace` no longer requires a committed box.** On any
   in-range frame the key means "this object is not visible here". Two new
   guards, otherwise the existing `clear()` branch is untouched:
   - Already cleared → do nothing. No pointless write, and no
     un-materializing a frame the annotator already settled.
   - Out of range (a peeked frame) → do nothing, as today.

3. **A fourth rail row, "None — not visible here".** It sits below the
   three source rows, separated by a rule: the sources answer "which box",
   this answers "no box", and that is a real boundary. `aria-pressed`
   when the frame is cleared, and it carries the same `Del` hint the
   sources carry their confidence. Disabled on a peeked frame, like the
   rest of the rail — but enabled on every in-range frame including a
   hole, which is what makes requirement 6 reachable. Clicking it runs the
   same `clear()` the key runs.

4. **Clearing is reversible via the source rows.** A clear leaves
   `detection.auto_predictions` / `algo_predictions` untouched, so on a
   cleared frame the Auto and Engine rows stay enabled, still render their
   crops, still preview on hover, and re-commit on click. `G` still cycles
   to "all" to see every candidate on the stage before choosing. This is
   the only undo path and it must keep working.

5. **A cleared frame suppresses the ghost.** Under the default `pick`
   visibility, a cleared frame draws no box at all — the ghost returning is
   what made the delete look undone. `G` → `all` still shows every
   candidate; that is deliberate, it is how requirement 4 is served.

6. **Holes are settleable, through the path that already exists.** A hole
   frame is exactly an evidence-free frame (`hasModelEvidence === false`),
   and `clear()` already routes those to `onUnmaterialize` — remove the
   frame from the lane. The server refuses with 409 when the frame does
   have model evidence or is the lane's last one, and
   `LocalizeAlertPage.tsx:686-698` already falls back to a confirmed-empty
   clear. Either outcome settles the frame, so no new branch is needed.
   Consequence to accept knowingly: **a lane whose only outstanding frames
   were holes becomes submittable**, where today it could never be
   finished. On an evidence-free frame the frame usually disappears rather
   than showing a pressed None row; the pressed state is reachable when
   the server 409s.

7. **The accept popover stops calling a cleared frame pending.**
   `AcceptRemainingPopover.tsx:72` maps a cleared entry to `confirmed` —
   settled, and untouched by the sweep, which is what the popover is
   previewing. No new `ObjectStatusStripStatus` vocabulary.

## Implementation

- **`objectBoxCandidates.ts`** — add
  `isCleared(annotation: DetectionAnnotation | null | undefined): boolean`,
  beside `committedBox`: true when `processing_stage === 'annotated'` and
  `committedBox(annotation) === null`. False-positive items are already
  excluded by `smokeItems`, so an FP-only annotation reads as cleared,
  matching `alertLocalizeUtils`.

- **`objectFilmstrip.ts`** — `FilmstripEntry` gains `cleared: boolean`,
  set from `isCleared`. `availableSource` and `xyxyn` keep their current
  values on a cleared frame: the thumbnail still crops to where the object
  was, which is where you look to reverse the decision.

- **`ObjectFilmstrip.tsx`** — `CellState` gains `'cleared'`, tested before
  `committed`. Border `#767B72` (`haze`) solid with the thumbnail muted:
  solid because the frame is decided, neutral because no source won it.
  That reads apart from all three neighbours — the source-coloured states,
  the `#B3261E` hatched hole, and the `#E4E2DC` dashed out-of-range cell,
  which is the only other neutral and is both dashed and faint. Hover
  label: "No box — you marked the object not visible here".

- **`LocalizeObjectEditor.tsx`**
  - `const cleared = isCleared(existingAnnotation)`.
  - `clear()` gains the already-cleared guard; the
    `hasModelEvidence` branch is unchanged.
  - The `Delete`/`Backspace` case drops `!committedRef.current` from its
    guard, keeping `!editable`. Replace `committedRef` with a `clearedRef`
    for the new guard, or read both — the ref pattern stays, so the window
    listener is not re-bound on every save.
  - `ghosts`: return `[]` when `cleared` and visibility is `pick`.
  - Stage chip when cleared — same floated treatment as the
    out-of-range banner (`:1111`), neutral rather than pine, reading
    "No box on this frame".
  - `acceptRemainingCount` and `gapCount` both gain `!e.cleared`. Without
    it on `gapCount`, a cleared frame would be miscounted as a hole in the
    popover's copy.
  - Pass `cleared` and `onClear={clear}` to `BoxSourceRail`.

- **`BoxSourceRail.tsx`** — new props `cleared: boolean` and
  `onClear: () => void`; the None row; the footer copy and the
  "No buttons:" comment at `:205` updated, since the rail now owns the
  removal it used to delegate entirely to the key.

- **`EditorShortcutsModal.tsx`** — the `Del` row's label becomes "Mark the
  object not visible here" (from "Remove the box"), which is what the key
  now means on every frame rather than only on a committed one.

## Out of scope

- The stage's ghosts stay `pointer-events-none`. Making the model's
  proposal directly clickable — select it, drag to correct it — was
  considered and rejected for this change: it would mean a drag starting
  inside a suggestion no longer draws a new box, which is a regression to
  the modeless canvas for a gesture the rail already serves.
- No backend change. `saveDetectionReview` writing `[]` already produces
  this state, and the `unmaterializeFrame` 409 fallback already exists.
- Model predictions are never mutated or deleted server-side.
- `ObjectStatusStrip`'s status vocabulary is unchanged.

## Testing

`objectBoxCandidates.test.ts`
- `isCleared`: annotated + empty → true; annotated + FP-items-only → true;
  annotated + a smoke box → false; `null` annotation → false;
  non-annotated stage → false.

`objectFilmstrip.test.ts`
- An entry for a committed-empty annotation carries `cleared: true` and
  keeps its `availableSource`/`xyxyn`.

`LocalizeObjectEditor.test.tsx`
- `Delete` on an undecided frame offering an auto box calls
  `onCommit(detection, [])`. *(Fails before the change.)*
- After clearing, the stage renders no ghost. *(Fails before the change.)*
- The None row: click commits `[]`; `aria-pressed` reflects `cleared`;
  disabled on a peeked frame.
- **Revert** — on a cleared frame the Auto row is enabled and clicking it
  re-commits the auto box.
- `Delete` on an already-cleared frame writes nothing.
- The existing un-materialize tests (`:999+`) stay green, and `Delete` on
  an evidence-free frame with no committed box still un-materializes
  (requirement 6).
- The "Accept boxes" count excludes cleared frames. *(Fails before the
  change.)*

`BoxSourceRail.test.tsx`
- The None row renders, presses when cleared, and disables with the rail.

`ObjectFilmstrip.test.tsx`
- A cleared entry gets `data-state="cleared"` and its own hover label.
