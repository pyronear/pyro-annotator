# Localize page keyboard shortcuts + help modal

**Date:** 2026-08-06
**Status:** Approved

## Goal

Give the localize cockpit (`/localize/:sequenceId`, `LocalizeAlertPage`) the same
keyboard-shortcuts affordance the classify page has — a lucide `Keyboard` icon
button opening a help modal — and add the page-level bindings it documents:
`S`/`M`/`L` for frame card size, `P` for the cropped-loop (PlayCircle) toggle,
and `?` for the help itself. `Tab`/`Shift+Tab` cycling and `C` already exist and
are only documented, not changed.

## New bindings

One new `window` keydown effect in `LocalizeAlertPage.tsx`, alongside the
existing `C` effect. The `C` and Tab handlers keep their behavior, gaining
only a sheet-open suspension (below):

| Key | Action |
| --- | --- |
| `S` / `M` / `L` | `handleCardSizeChange('sm' \| 'md' \| 'lg')` — same path as clicking the ViewToolbar buttons, so the focus-size override is cleared identically |
| `P` | Toggle `cropExpanded`. No-op when `canShowCrop` is false (no active lane with boxes) — same gate that hides the button |
| `?` | Toggle the shortcuts modal |
| `Escape` | Close the shortcuts modal, only while it is open (mirrors classify's `createKeyboardHandler`) |

### Guards

The handler returns early (keys stay inert) when:

- the per-frame editor is open (`detectionIdNum != null`),
- the add-object picker is open (`addObjectPickerOpen`),
- the missed-smoke confirm dialog is open (`missedSmokeConfirm`),
- `Ctrl`/`Meta`/`Alt` is held (`Shift` stays allowed — `?` requires it),
- the event target is an input, textarea, or contenteditable element.

These are the same suspension conditions as the Tab cycle handler, plus the
typing guard. Matched keys call `preventDefault()`. Letter keys match
case-insensitively (`s` and `S`), like the existing `C` handler.

While the shortcuts modal is open, only `?` and `Escape` act: `S`/`M`/`L`/`P`
are inert, and the pre-existing `C` and Tab handlers are suspended too (the
modal is a surface of its own, like the other overlays — and without the Tab
suspension its close button would be keyboard-unreachable, the trap classify
guards against on its own sheet).

## Help modal

New `frontend/src/components/localize/LocalizeShortcutsModal.tsx`, a
self-contained copy of `ClassifyShortcutsModal`'s structure (`Key` / `Row` /
`Section` primitives and the modal shell), with a header comment noting the
copy — the same pattern `EditorShortcutsModal` already uses. No shared
extraction in this change.

Content (all page-level shortcuts, including pre-existing ones):

- **Navigate**
  - Cycle objects — `Tab`, `Shift + Tab`
  - Open the focused object — `Enter`, `Space`
- **View**
  - Frame card size — `S`, `M`, `L`
  - Crop cells — `C`
  - Cropped view — loop the object's crops — `P`
- **Help**
  - Toggle this help — `?`

Backdrop click, the `X` button, and `Escape` all close it.

## Entry point

A `Keyboard` icon button identical in styling and title
(`"Show keyboard shortcuts (?)"`) to classify's, placed in `LocalizeRail`'s
`headerAction` slot next to the existing False-positives toggle (the slot
receives a fragment containing both, shortcuts button after the toggle).
State is a local `useState` in `LocalizeAlertPage`, as on classify.

## FP toggle relabel + tooltip

To make room in the rail header, the False-positives toggle's visible label
shrinks from "False positives" to "FP" (count badge unchanged). Because "FP"
alone is cryptic:

- the button keeps its full accessible name via `aria-label="False positives"`,
- the native `title` is replaced by the shared `ui/Tooltip` component (already
  used on this page for the submit button), carrying the existing copy:
  the "no false-positive objects" sentence when disabled, the "read-only
  context" explanation otherwise. Placement `below` (the button sits at the
  top of the rail, with the panel below it).

## Testing

Vitest page tests following the existing localize keyboard-test pattern
(await arrival auto-select before pressing keys):

- `S`/`M`/`L` flips `aria-pressed` on the corresponding ViewToolbar button.
- `P` mounts/unmounts the cropped-loop view; inert when no lane has boxes.
- `?` opens the modal (and the rail button opens it too); `Escape` and `?`
  close it.
- New keys are inert while the per-frame editor overlay is open.
- The FP toggle shows "FP", keeps the accessible name "False positives", and
  its tooltip carries the explanatory copy.
