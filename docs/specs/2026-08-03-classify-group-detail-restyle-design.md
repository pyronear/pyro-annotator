# Classify Group Detail Restyle — Design

**Date:** 2026-08-03
**Status:** Approved

## Problem

`/classify/groups/:id` (`SequenceGroupAnnotatePage`) still runs entirely on the
legacy palette (`gray-*`, `blue-*`, `green-*`, `orange-*`, `yellow-*`) while
its sibling list page and the rest of the recently converted UI use the
fire-lookout system defined in `frontend/DESIGN.md`. The page also spends a
large vertical slab on the always-visible blue "How to label this group"
callout.

## Decision

Restyle the page in place onto the fire-lookout tokens and compact the layout.
No behavior changes: data fetching, mutations, grid auto-fill, card-size
persistence, and the remove-confirmation flow stay exactly as they are.

### Pinned header

Keeps the fixed-past-sidebar idiom and the root's `pt-20` reservation.

- Bar: `bg-paper/85 backdrop-blur-sm border-b border-line`, no shadow.
- Back link: tertiary recipe — `font-body text-detail text-haze
  hover:text-char`.
- Title: `font-display text-title font-semibold tracking-tight text-char`.
- Badges:
  - `N seq` count → neutral mono pill: `bg-ash text-char font-data`.
  - `smoke · <type>` and `false positive · <type>` → neutral paper pill with
    hairline border (`border-line bg-paper text-char`).
  - `to label` → `bg-ember-soft text-ember`, matching the list page (accent
    only where action is pending).
- Help: an `Info` icon after the badges replaces the removed blue callout.
  Hover shows the three-line Label / Validate / Eject explanation using the
  `bg-char` tooltip-bubble idiom from `SequenceGroupsListPage.headerTip`.
- Prev/next chevrons: secondary-button styling (`border-line bg-paper
  text-haze hover:bg-ash`); disabled state fades to `text-line`.
- `Validate group`: ember primary button recipe (primary CTA in the Classify
  lane; pine buttons are reserved for Localize contexts).
- `Validated` pill: `bg-pine-soft text-pine` + ShieldCheck, matching the list
  page's Reviewed column. `Unvalidate`: secondary button recipe.

### Legend / card-size toolbar

- Row: hairline card — `border border-line bg-paper`; text `font-body
  text-detail text-haze`.
- Legend swatches keep red/fuchsia so they match the overlays.
- S/M/L segmented control mirrors the list page's tab pills: `bg-ash p-0.5`
  track, active `bg-paper border-line text-char`, inactive `text-haze
  hover:text-char`.

### Member cards

- Card: `border border-line bg-paper overflow-hidden` (hairline replaces
  `border-2 border-gray-300`; square corners — no `rounded-card` — so the
  image grid reads as a contact sheet); annotated members keep `opacity-60`.
- Image wells `bg-ash`, center divider `border-line`, spinners `text-haze`,
  card-link hover `hover:bg-ash`.
- Footer: `seq #id` and relative time in `font-data text-detail` (counts and
  timestamps are always mono), time in `text-haze`; annotated check
  `text-pine`; pending clock `text-haze`.
- Eject ✕: paper/hairline at rest; hover is destructive-signal —
  `hover:bg-signal-soft hover:border-signal hover:text-signal`. The
  `window.confirm` flow is unchanged.

### Page states

- Loading: `text-haze` copy with ember spinner tone.
- Error: `text-signal`.
- Empty group: dashed `border-line`, `text-haze`.

### Explicitly unchanged

- Bbox overlay colors: red solid (detected object) and fuchsia dashed (group
  reference region) are functional marker colors on imagery — `signal` is
  reserved for errors and neither palette accent has the needed contrast on
  photos. Legend swatches stay matching.
- Grid auto-fill behavior and `CARD_MIN_WIDTH` steps.
- All queries, mutations, and invalidation keys.

## Verification

- `npm run quality` passes; full vitest suite stays green (686 baseline).
- Before/after screenshot of the page via the playwright recipe to eyeball the
  restyle.
