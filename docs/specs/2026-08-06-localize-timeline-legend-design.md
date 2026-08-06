# Localize rail: shared timeline legend

**Date**: 2026-08-06
**Status**: Approved

## Problem

The localize cockpit's object rows (`LocalizeObjectRow`) each carry an inline
per-frame timeline whose segments encode four states: `confirmed` (solid fill
in the object's color), `pending` (40%-faded fill), `empty` (outline only) and
`absent` (neutral track). Nothing on the page explains this encoding. The only
legend lives inside the editor's `AcceptRemainingPopover`, which an annotator
may never open — and which explains a different strip on a different screen.

## Decision

One shared legend for the whole rail, not a per-row legend. Every row uses the
same vocabulary (only the hue changes per object), so repeating the same
three-or-four words under every row would make the rail taller and noisier for
no information gain.

## Design

### Placement

At the bottom of the Objects rail on `LocalizeAlertPage`: below the object
rows, above the missed-smoke divider. The legend is a footnote to the strips
above it — reference material, not reading order.

`LocalizeRail` gains an optional `legend` slot rendered immediately after
`children`, following the rail's existing pattern (slots; the page owns the
wiring).

### Component

A new presentational component `LocalizeTimelineLegend` in
`src/components/localize/`. It renders one horizontal, wrap-capable line of
chips: a small pill swatch (`h-1.5 w-4 rounded-full`) plus a label in
`font-data text-detail text-haze` — the same visual language as the
`AcceptRemainingPopover` legend.

### Chips

Three possible chips, using the popover's exact vocabulary so both surfaces
teach the same words:

| Status      | Label                 | Swatch treatment      |
| ----------- | --------------------- | --------------------- |
| `confirmed` | committed             | solid fill            |
| `pending`   | model box to accept   | 40%-opacity fill      |
| `empty`     | no box                | inset 1px outline     |

`absent` is never listed — it is the neutral track showing through, and
explaining the background is noise (the popover legend skips it too).

Because hue varies per object, swatches are drawn in a single teal (`pine`):
the legend explains the *treatment* (solid vs faded vs outline), not the
color.

### Filtering

Chips are filtered to the union of statuses actually present across all rows'
`statusByTimestamp` maps — the popover's established pattern, applied
rail-wide. A fully-localized alert shows only "committed"; "no box" appears
only when some row actually has an outlined gap. If the union is empty (no
rows), no legend renders.

### Data flow

`LocalizeAlertPage` already builds `statusByTimestamp` per row. A small pure
helper in `src/utils/annotation/alertLocalizeUtils.ts` takes those maps and
returns the present-status union (excluding `absent`). The page passes the
result to `LocalizeTimelineLegend` via the rail's `legend` slot.

## Testing

- Unit tests for the helper: union across maps, `absent` excluded, empty
  input → empty union.
- Page-level tests on `LocalizeAlertPage`: an alert with committed, pending
  and gap frames shows all three chips; a fully-localized alert shows only
  "committed"; chips carry the right swatch treatment.

## Out of scope

- Any change to the per-segment encodings themselves.
- Explaining `absent`.
- The editor page and its popover legend stay as they are.
