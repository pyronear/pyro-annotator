# Alert API Annotation Display — Design

**Date:** 2026-08-03
**Status:** Approved

## Problem

The alert-platform classification (`is_wildfire_alertapi`) is displayed with
emoji pills in the Classify tables (`🔥 Wildfire`, `💨 Other Smoke`, `○ Other`)
and emoji-prefixed options in the FilterPopover dropdown. The emojis clash with
the emoji-free outcome-code style the tables adopted (see
`2026-08-03-outcome-codes-tables-design.md`), and nothing explains to the
annotator what the values mean or where they come from.

## Change

### 1. Tables — `PlatformAnnotationPill.tsx`

Restyle from colored pill backgrounds to the OutcomeCode dot + text pattern:

| Value            | Dot                              | Label         |
| ---------------- | -------------------------------- | ------------- |
| `wildfire_smoke` | filled `signal` (red)            | Wildfire      |
| `other_smoke`    | filled `ember` (orange)          | Other smoke   |
| `other`          | hollow (border only, no fill)    | Other         |
| `null`           | renders nothing (unchanged)      | —             |

Styling matches `OutcomeCode`: `text-detail text-char` text, `h-2 w-2
rounded-full` dot with `aria-hidden`. Each value gets a native `title` tooltip
stating the value and its provenance:

- **Wildfire:** "Wildfire smoke — the alert platform classified this sequence
  as a wildfire"
- **Other smoke:** "Other smoke — the alert platform classified this as smoke,
  but not a wildfire"
- **Other:** "Other — the alert platform classified this as neither wildfire
  nor smoke"

The component name and `value` prop are unchanged, so the two call sites
(`ClassifyQueueTable`, `ClassifyDoneTable`) need no edits.

### 2. Filter — `FilterPopover.tsx`

Drop the emojis from the four "Alert API annotation" `<option>` labels:
"Wildfire smoke", "Other smoke", "Other", "Unclassified". No tooltips — native
`<select>` options can't reliably show them, and the field label carries the
context.

### 3. Tests

New `PlatformAnnotationPill.test.tsx`: for each value, asserts the label text
and `title` tooltip; asserts nothing renders for `null`.

## Out of Scope

- Other emojis in the app (keyboard-shortcut modals, annotation interface,
  model-accuracy filter).
- Backend, routing, or state changes.
