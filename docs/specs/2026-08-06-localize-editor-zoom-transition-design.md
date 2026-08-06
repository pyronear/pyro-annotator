# Localize editor zoom transition

Date: 2026-08-06
Status: approved, not implemented

## Problem

Clicking a cell on `/localize/:sequenceId` opens `LocalizeObjectEditor`, which
is technically an overlay — a child route the page renders as a
`fixed inset-0` div, with the cockpit staying mounted underneath — but it
appears and disappears with no animation at all. To the annotator it reads as
navigation to a different page, which misstates the model: the editor is the
clicked cell's frame, enlarged, and closing it returns to the same cockpit in
the same state.

This spec adds a grow-from-the-cell open/close transition so the editor
visibly comes out of, and returns into, the grid. Chosen over a plain
fade-and-lift modal and a bottom-sheet treatment in a live mockup comparison
(brainstorm session, 2026-08-06).

## Scope

**In:** the editor's mount/unmount motion, its degraded paths (deep link,
browser back, reduced motion), the page↔editor contract that feeds it, and
tests.

**Out:** any change to routing, URL semantics, editor layout, or cockpit
state. Stepping frames or switching objects while the editor is open animates
nothing — the component stays mounted and only the stage content changes.

## Motion

**Open.** The editor's full-screen root starts as a transform of the clicked
cell's viewport rect — `translate(cell.x, cell.y) scale(cell.w / vw, cell.h /
vh)` with `transform-origin: 0 0` (non-uniform scale, FLIP-style) — and
animates to identity. ~340ms, `cubic-bezier(.2, 0, 0, 1)`, with opacity
ramping ~0.55 → 1 and border-radius rounding off from the cell's radius to 0.

**Close.** The reverse, targeting the **current frame's** cell — not
necessarily the one that opened the editor, since the annotator steps frames
inside it. ~260ms, `cubic-bezier(.4, 0, 1, 1)`. If the target cell is scrolled
out of view, it is scrolled into view instantly (`behavior: 'auto'`,
`block: 'nearest'`) before measuring, so the editor lands where the eye should
continue working.

Durations are the mockup's values; they may be trimmed after use in the real
app without a spec change.

## Degraded paths

Every path that cannot produce an origin/target rect degrades to something
quieter rather than breaking:

- **Deep link** (page loads with the editor already in the URL): no entrance
  animation. Animation happens only when the open came from a click on an
  already-rendered grid; the click handler captures the cell rect, and no
  captured rect means no animation.
- **Browser back/forward**: the route change unmounts the editor before any
  exit animation could run — it closes instantly. Accepted degradation; the
  in-app close controls (✕, Esc) are the common path.
- **`prefers-reduced-motion: reduce`**: no transform animation in either
  direction; a fast opacity fade only.
- **Target cell missing** (defensive; every alert frame has a grid cell keyed
  by `recordedAt`, but if lookup fails): same fade fallback.
- **`element.animate` unavailable** (jsdom, old browsers): no animation,
  behavior identical to today.

## Mechanism

No routing or state changes. The editor stays a child route; `closeModal`
stays URL-driven navigation.

- **`LocalizeAlertPage`** supplies two things:
  - the entrance rect, captured in the existing grid-cell click handler at
    click time (the moment the DOM is guaranteed laid out and visible) and
    consumed once by the editor on mount;
  - a `frameCellRect(recordedAt)` lookup that resolves the grid cell via its
    existing `data-testid="alert-frame-cell-${recordedAt}"`, scrolling it
    into view first when needed, and returns its `DOMRect` (or null).
- **`LocalizeObjectEditor`** owns both animations, via the Web Animations API
  (`element.animate` — no new dependency) on its root div:
  - entrance runs in a mount-only layout effect, from the captured rect;
  - exit intercepts the close controls: play the shrink toward
    `frameCellRect(currentFrame.recordedAt)`, then call `onClose()`, which
    navigates as today. An `isClosing` guard prevents double-close and sets
    `pointer-events: none` during the exit.

The rect→keyframes computation is a pure helper (viewport rect in, keyframe
pair out) so it can be unit-tested without a DOM.

## Testing

jsdom does not implement `element.animate`, so the existence guard doubles as
the test-environment path — existing editor tests keep passing unchanged.

New tests:

- rect→transform keyframe math (pure helper, no DOM);
- no captured entrance rect → no entrance animation (deep-link path);
- close calls `onClose` after the exit animation finishes when `animate`
  exists (mocked, `onfinish` driven), and immediately when it does not;
- `prefers-reduced-motion` (mocked `matchMedia`) uses the fade path — no
  transform keyframes.
