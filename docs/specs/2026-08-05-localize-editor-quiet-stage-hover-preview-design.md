# Localize object editor: quiet stage + hover-to-preview rail

**Date:** 2026-08-05
**Status:** Approved

## Motivation

On an undecided frame (e.g. `/localize/78/object/78/1583`) the editor's stage
ghosts in **every** candidate box by default. The engine and auto boxes sit
almost concentrically on the same plume — two dashed strokes plus their dark
halos — and at the default 3x object zoom the stack reads as clutter exactly
where the annotator is trying to look. With a manual box committed and `G`
pressed, all three sources pile up the same way.

The rail beside the image already carries the auto-vs-engine comparison: three
rows, each cropping the same region with that source's box drawn on it. The
stage does not need to repeat the stacked comparison; it needs to show **one
box at a time**, well.

## Design

### Undecided frame: one ghost, the priority pick

With nothing committed, the stage draws exactly one ghost: the **priority
pick** (`manual > auto > engine` — in practice auto when present, else
engine), dashed in its source colour, with the existing halo. This is the box
`Enter` would commit, so the idle stage always answers "is the default right?"
The losing candidate no longer draws by default.

### Rail hover / focus: solo preview

Hovering a rail row — or focusing it with the keyboard, same handler — makes
the stage show **only that row's candidate** as a dashed ghost for the
duration. Whatever was shown (the default pick, or the committed box on a
decided frame) hides while the preview is active. Leaving the row restores the
idle state.

Moving the pointer between rows therefore blink-compares candidates in place:
the stage always holds exactly one box, and differences pop by alternation
rather than by stacking.

- A preview is purely visual: no handles, no drag, no pointer events.
- Rows with no candidate (e.g. the manual row before anything is drawn)
  preview nothing.
- Hovering the committed row is a no-op — its box is already on stage.
- During an active draw or box move/resize, hover previews are ignored.
- Clicking a row is unchanged: commit that candidate.

### Committed frame: unchanged idle state

The committed box alone, solid, in its source colour, selectable and editable
as today. Only the hover preview is new.

### `G` becomes a three-state cycle

With the default now "one box", `G` cycles the idle stage through:

1. **pick-only** (default) — the committed box, or the priority-pick ghost.
2. **all** — every candidate at once: today's stacked view, on demand.
3. **none** — no boxes at all, for seeing the bare plume.

The cycle resets to pick-only on frame change, as the current override does.
A hover preview overrides whichever cycle state is active, and releases back
to it. The shortcuts modal copy updates to describe the cycle.

## Non-changes

`O` (other objects), `Z`/`R` (zoom), drawing, box move/resize, click-to-commit,
`Enter`/`Delete`, the rail's layout and crops, and the source colour/weight
identity (`sourceIdentity.ts`) all stay exactly as they are.

## Implementation shape

- `LocalizeObjectEditor` gains `previewedCandidate: BoxCandidate | null`
  state, set by new `onPreview(candidate | null)` callbacks from
  `BoxSourceRail` rows (mouseenter/mouseleave + focus/blur on the row
  **wrapper**, not the button — browsers do not fire mouse events on disabled
  `<button>`s).
- The existing `ghostsOverridden: boolean` becomes the three-state cycle
  (`'pick' | 'all' | 'none'`), still reset on `detection.id` change.
- The committed/ghosts props passed to `DetectionAnnotationCanvas` are derived
  from (cycle state, preview, committed, candidates); the canvas component
  itself needs no new rendering path — a preview renders through the existing
  ghost layer.

## Testing

Component tests on the editor:

- Undecided frame renders exactly one ghost — the priority pick.
- Hovering (and focusing) the engine row shows only the engine ghost.
- On a committed frame, hovering a losing row hides the committed box and
  shows that ghost; leaving restores it.
- Rows without a candidate trigger no preview.
- `G` cycles pick-only → all → none → pick-only, and resets on frame change.
