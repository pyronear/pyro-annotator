# Move Sequence Groups Link Under Sequences — Design

**Date:** 2026-07-28
**Status:** Approved

## Problem

"Sequence groups" sits as a top-level sidebar item, while the rest of the
sequence workflow lives under the collapsible **Sequences** section. The link
belongs with its siblings: `Sequences > Groups`.

(Reported alongside a missing badge pill; that turned out to be a stale
`annotation_api` Docker image missing the `/sequence_groups/stats` route — an
environment fix, no code change.)

## Design

All changes in `frontend/src/components/layout/AppLayout.tsx`:

1. Remove the top-level "Sequence groups" navigation item.
2. Add **Groups** as the *first* child of the Sequences section:
   `Sequences > Groups, Annotate, Review`, with `href: '/sequence-groups'`
   and `badgeCount: groupCount` (sub-item badge rendering already exists).
3. Add optional `badgeTitle` to `NavigationSubItem` and pass it to
   `NotificationBadge`, preserving the "N groups need validation" tooltip.
4. Remove the now-unused `Boxes` icon import.

## Behavior notes

- Active-state highlighting is unchanged: `/sequence-groups/...` paths do not
  collide with the `/sequences/` special-casing in `isPathActive`.
- The Sequences section defaults to expanded, so the pill is visible on load.
  A manually collapsed section hides the count; no aggregated section-header
  badge (YAGNI).

## Verification

- Component test: sidebar renders Groups under Sequences with the badge count.
- `npm run type-check`, `npm run lint`, `npm test`.
- Visual check on the dev server (pill shows the unvalidated count).
