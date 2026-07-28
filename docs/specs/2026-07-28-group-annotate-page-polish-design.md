# Sequence Group Review Page — Polish & Consistency

**Date:** 2026-07-28
**Status:** Approved
**Scope:** `frontend` only — `src/pages/SequenceGroupAnnotatePage.tsx`. No backend changes: the camera name already arrives with each group member.

## Problem

The group review page (`/sequence-groups/:id/annotate`) predates the list-page
redesign (PR #206) and no longer matches it:

- The header shows the numeric camera id ("camera 97") and leads with the
  group number, which the list page no longer surfaces.
- Title size/weight and page layout differ from the other pages
  (`max-w-7xl` container vs. the app-wide `space-y-6` + layout padding).
- The workflow explanation is a dense gray paragraph mixing overlay legend,
  interaction hints, and propagation semantics.
- The member grid is fixed at 2 cards per row regardless of screen width.

## Design

Approved via mockup review (visual companion). Polish only — no workflow
changes, no new labeling capability.

### Header & layout

- Root container becomes `space-y-6`, relying on the app layout's `p-6`
  (drop `max-w-7xl mx-auto px-4 py-6`) — same as the list page.
- The "← Back" history button becomes a breadcrumb `<Link>` "← Sequence
  groups" to `/sequence-groups`.
- Title: `{cameraName} · {azimuth}°` in `text-2xl font-bold text-gray-900`,
  where `cameraName = group.members[0]?.camera_name`, falling back to
  `camera #{group.camera_id}` for a memberless group. The group id appears
  nowhere on the page (it lives in the URL).
- Subtitle row of pills matching the list page: blue count pill
  "N sequence(s)", and a label pill — orange `smoke · {type}`, gray
  `false positive · {type}` (underscores replaced by spaces), or yellow
  `to label` when unlabeled.
- Validate/Unvalidate controls keep their position and behavior, restyled
  to the list page's idiom (rounded-lg buttons, same greens).

### Explainer

The gray legend box is replaced by the list page's blue info box
(`Info` icon), with this copy:

> **How to label this group**
> - **Label** — open any sequence below and label it.
> - **Validate** — "Validate group" confirms every sequence shows the same
>   object; once validated, one label propagates to all unannotated members.
> - **Eject** — use ✕ on a card to remove a sequence that doesn't belong.
>   Do this before validating.

Always visible. The old conditional "group is validated…" sentence is
covered by this copy and is dropped. The Validate/Unvalidate buttons also
carry `title` tooltips restating the propagation semantics.

### Legend strip

One slim line between the explainer and the grid (`text-xs`, gray
background bar): red swatch "detected object", dashed fuchsia swatch
"group reference region", then "left: full frame · right: zoom".

### Grid density & card-size control

The grid uses `repeat(auto-fill, minmax(min(<minWidth>px, 100%), 1fr))`
so the column count derives from a minimum card width and reflows
automatically at any viewport size. A "Card size" S/M/L segmented control
on the right of the legend strip switches the minimum width
(S = 340 px, M = 460 px default, L = 640 px); the choice persists in
localStorage via the existing `usePersistedTabState` hook
(key `groupAnnotateCardSize`).

### Card meta

The card timestamp switches from `toLocaleString()` to the shared
`formatRelativeTime` helper (added in PR #206), with the exact timestamp in
the `title` tooltip — consistent with the list page. Everything else on the
cards (bbox overlays, zoom crop, remove button with its confirm dialog,
annotated check/clock icons, link to the per-sequence page) is unchanged.

## Out of scope

- Labeling directly from this page (bulk-annotate UI).
- Progress indicators / guided-workflow changes.
- Any backend or API change.

## Verification

- `npm run quality` (tsc, ESLint, Prettier) and `npm test` — clean on
  touched files (repo-wide runs have known pre-existing failures on main:
  two `no-console` warnings in `DetectionSequenceAnnotatePage.tsx`).
- Visual check via a Vite dev server against the running local stack,
  comparing against the approved mockups.
