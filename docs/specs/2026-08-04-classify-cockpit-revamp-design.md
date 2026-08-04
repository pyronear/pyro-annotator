# Classify Cockpit Revamp — `/classify/{id}` and `/classify/done/{id}`

**Date:** 2026-08-04
**Status:** Approved
**Scope:** Frontend only — `ClassifyAlertPage` rendering. No API, state-logic, or
submit-semantics changes.

## Problem

The classify detail page stacks one screen-tall card per object (two players +
radio lists + an 18-checkbox false-positive grid each), with the alert-level
missed-smoke review and its own player at the bottom. Reviewing means scrolling
through everything; the alert's overall state (which objects are done, what the
missed-smoke answer is) is never visible at once. The pain points targeted, in
order: too much scrolling, verbose controls, no at-a-glance state. The two
players per object (full-frame + cropped) are valued and stay.

Most alerts have one object, sometimes 2–3. Annotators drive the page with a
mix of keyboard (S/F, 1/2/3, Y/N, Enter) and mouse — every control must remain
a comfortable click target.

## Design: the cockpit

Below the existing pinned header, the page becomes a two-column layout on
desktop (`lg+`): a **media column** (~60%) and a **decision rail** (~40%), each
independently scrollable; the page itself no longer scrolls. Below `lg`, it
degrades to the natural stacked flow (media, then rail content), fully
mouse-operable.

### Pinned header (unchanged structure)

Back link, `org · camera`, timestamp, "N of M objects classified" pill,
workflow prev/next, Submit, keyboard-help button. Submit lives here only — the
header is always visible.

### Media column — always shows the active thing

- **Active object:** full-frame player (`FullImageSequence`: own box solid in
  the object's identity color, sibling boxes dimmed), then the
  `ObjectPresenceStrip` when the alert has ≥2 objects, then the active object's
  cropped loop (`CroppedImageSequence`).
- **Missed-smoke section active:** the media column swaps to the primary
  lane's whole-alert sequence player (`SequencePlayer` with all object
  overlays). The yes/no controls do NOT live here — they are in the rail.

### Decision rail — the whole alert's state at a glance

- One slim row per object: color dot (matching overlay colors) + `Object N` +
  a status chip:
  - `Pending` — ember-soft
  - `Smoke · Wildfire` (etc.) — pine-soft
  - `FP · High cloud +1` — neutral (ash/char)
  - `Unsure` — signal-soft
  - `Type needed` — ember-soft (smoke chosen, no type yet)
- Clicking a row activates it (mouse parity with ↑/↓). The active row carries
  the ember left-bar accent and expands to show:
  - Chip row **Smoke / False positive / Unsure** — `rounded-full px-3 py-1.5`
    toggle buttons with visible kbd hints. Selected fill: pine for Smoke, char
    for False positive.
  - A contextual second chip wrap: the 3 smoke types, or **all 18 FP types as
    an inline chip wrap**, each with its shortcut letter. No "More…" tiering.
- **No emojis anywhere** in classification, smoke-type, FP-type, or status
  chips — plain text; color and fill carry selection state (consistent with
  the emoji-free Alert API annotation work).
- Below the object rows, separated by a hairline: the **Missed smoke?** row
  with Yes/No chips (Y/N kbd hints). Activating the row (↓ past the last
  object, or click) swaps the media column to the whole-alert player.
- Chips are real `<button>`s with `aria-pressed`; the Smoke/FP pair behaves as
  an exclusive group.

### Keyboard

Bindings and handler are unchanged (`createKeyboardHandler`, the existing
position↔cardKey adapter, `navigationUtils` section model). ↑/↓ moves the
active row (and into the missed-smoke section); scroll-into-view now targets
rail rows within the rail's own scroll container.

## Done mode (`/classify/done/{id}`)

Same cockpit, with:

- Every annotated lane is an editable row regardless of stage (existing rule);
  each row additionally shows its processing-stage badge, since lanes can sit
  at different stages. Lanes with no annotation render as a disabled
  "Not imported yet" row.
- Entering from the Done list activates that sequence's row directly (replaces
  today's scroll-to-card).
- Rows edited since load get an ember **changed dot**; the header button reads
  **"Save changes (n)"** (n = changed lanes), disabled until `anyLaneChanged`.
  Diff/PATCH submit logic is untouched. Reset restores the loaded snapshot and
  clears the dots.

In queue mode, locked lanes (`seq_annotation_done` / `annotated`) are read-only
rows: stage badge + summary chip, clickable to view media, chips disabled.

## Component architecture

`ClassifyAlertPage` keeps all state, queries, mutations, keyboard adapters,
and submit semantics. Only the render tree changes:

- `ClassifyMediaPanel` (new) — media column: full-frame player + presence
  strip + cropped loop for the active object; whole-alert `SequencePlayer`
  when the missed-smoke section is active.
- `DecisionRail` (new) — object rows + missed-smoke row.
- `ObjectRow` (new) — slim row; expanded when active; renders
  `ClassificationChips`.
- `ClassificationChips` (new) — Smoke/FP/Unsure group + contextual type chip
  wrap; same `SequenceBbox` mutation semantics as today's `ObjectCard` radios
  (smoke keeps existing type, FP clears `smoke_type`, etc.).
- `ObjectCard` / `SequenceAnnotationGrid` remain untouched (legacy
  `AnnotationInterface` still uses them; its removal is separate cleanup).
- The `sequence-annotation/MissedSmokePanel` wrapper is no longer used by this
  page.

New components live in `src/components/classify/`. All styling uses
fire-lookout tokens per `DESIGN.md`.

## Error handling

Unchanged: submit guard toasts, group-propagation warning banner (renders
above the columns, spanning both), post-submit refetch, sequential done-mode
PATCH abort behavior.

## Testing

- The existing 21 `ClassifyAlertPage` tests stay as behavior specs; selectors
  migrate from radio labels ("This is smoke") to chip buttons ("Smoke").
- New tests: row click activates + swaps media; missed-smoke activation swaps
  the player; done-mode changed dot + "Save changes (n)" count; FP chip wrap
  toggling; locked-row read-only behavior.
- Gate: `npm run quality` and full `npm test` green.

## Out of scope

- Any backend or submit-payload change.
- `AnnotationInterface` / `ObjectCard` cleanup.
- Localize pages.
- Mockups from the brainstorm live in `.superpowers/brainstorm/` (untracked).
