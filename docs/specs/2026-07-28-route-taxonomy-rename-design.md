# Route Taxonomy Rename — Design

**Issue**: [#210](https://github.com/pyronear/pyro-annotator/issues/210)
**Date**: 2026-07-28
**Status**: Approved

## Problem

The dashboard (#208) teaches the pipeline as two passes — **Classify** and
**Localize** — and the sidebar (#211) now uses the same vocabulary. The routes
still name database entities (`/sequences/*`, `/detections/*`,
`/sequence-groups`). Since the unit of both passes is a sequence,
`/detections/annotate` for Pass 02 is doubly misleading. URLs should speak the
taxonomy the app teaches.

Prerequisites #207 (stage retirement, PR #220) and the Smoke Localization
entry point (#212) are merged, so this rename maps the final page set.

## Decisions

1. **Bare pass roots**: the annotate queues live at `/classify` and
   `/localize` — the queue is the pass's home page.
2. **`/done`, not `/review`**: finished-work pages use the word the sidebar
   shows (`Classify → Done`, `Localize → Done`).
3. **Path-based provenance**: the `?from=` query mechanism is deleted.
   Provenance (which queue a detail page was entered from) is encoded in the
   path (`/classify/:id` vs `/classify/done/:id`).
4. **Storage keys renamed, no migration**: annotators lose saved filters once
   and re-pick them on next visit.

## Route Table

| Old | New | Component |
| --- | --- | --- |
| `/sequences/annotate` | `/classify` | `SequencesPage` |
| `/sequences/review` | `/classify/done` | `SequencesPageWrapper` |
| `/sequences/:id/annotate` | `/classify/:id` | `AnnotationInterface` |
| `/sequences/:id/annotate?from=review` | `/classify/done/:id` | `AnnotationInterface` (done mode) |
| `/sequence-groups` | `/classify/groups` | `SequenceGroupsListPage` |
| `/sequence-groups/:id/annotate` | `/classify/groups/:id` | `SequenceGroupAnnotatePage` |
| `/detections/annotate` | `/localize` | `DetectionAnnotatePage` |
| `/detections/review` | `/localize/done` | `DetectionReviewPage` |
| `/detections/:seqId/annotate/:detId?` (`from=localize` or absent) | `/localize/:seqId/:detId?` | `DetectionSequenceAnnotatePage` |
| `/detections/:seqId/annotate/:detId?` (`from=detections-review`) | `/localize/done/:seqId/:detId?` | `DetectionSequenceAnnotatePage` (done mode) |

Unchanged: `/`, `/login`, `/users`, `/guide`.

No matching conflicts: React Router v6 ranks static segments (`done`,
`groups`) above dynamic ones (`:id`).

### Mode as a prop

Detail components are mounted twice, with the mode set on the route element:

```tsx
<Route path="/classify/:id" element={<AnnotationInterface />} />
<Route path="/classify/done/:id" element={<AnnotationInterface mode="done" />} />
```

Components read the prop — they do not re-parse `location.pathname`.

### Localize detail flows

Today the localize detail page has three `from=` flows: `localize`
(lane-submit on save; the only in-app entry from the Smoke queue),
`detections-review` (done mode), and absent (legacy generic auto-advance,
reachable only by hand-typed URLs). After the rename:

- `/localize/:seqId/:detId?` **is** the lane-submit flow.
- `/localize/done/:seqId/:detId?` is the done flow.
- The legacy generic flow is removed.

## Redirects

Every old route redirects (`replace`) to its new location via a small
`LegacyRedirect` route element that interpolates path params and translates
the old `from=` query per the route table above. Redirects stay indefinitely.

Old `from=` values other than the ones tabled (or absent) fall back to the
non-done target.

## Nav Highlighting (`AppLayout`)

`isPathActive` collapses to prefix matching on the current pathname — all
`?from=` special-casing and `location.search` reads are deleted:

- `/classify/groups*` → Groups
- `/classify/done*` → Done (Classify)
- other `/classify*` → Sequences
- `/localize/done*` → Done (Localize)
- other `/localize*` → Smoke

## In-App Link Updates

All link/`navigate` call sites move to the new paths and drop `from=`:

- `SequencesPage` — row links; the `?from=review` suffix logic becomes a
  base-path choice (`/classify/:id` vs `/classify/done/:id`).
- `AnnotationInterface` — back URL becomes a ternary on the mode prop.
- `DetectionAnnotatePage` — entry navigation to `/localize/:seqId`.
- `DetectionReviewPage` — entry navigation to `/localize/done/:seqId`.
- `DetectionSequenceAnnotatePage` — advance/back navigation; source-page and
  filter-key selection derive from the mode prop.
- `SequenceGroupsListPage` / `SequenceGroupAnnotatePage` — group links.
- `DashboardPage` CTAs — `/classify/groups`, `/classify`, `/localize`.
- `HomePage`, `utils/pipeline.ts`, `useAnnotationCounts` — any residual path
  strings.

## Storage Keys

| Old | New |
| --- | --- |
| `filters-sequences-annotate` | `filters-classify` |
| `filters-sequences-review` | `filters-classify-done` |
| `filters-detections-annotate` | `filters-localize` |
| `filters-detections-review` / `filters-detections-review-v2` | `filters-localize-done` |
| `sequences-review-stage` | `classify-done-stage` |

No value migration. `tabbed-filters-active-tab` is taxonomy-neutral and
unchanged.

## Testing

- Update existing route/nav assertions (`AppLayout.test.tsx`, page tests
  using old paths).
- New redirect tests: each old URL — including `from=` variants — lands on
  the mapped new URL.
- Nav-highlight tests for the five prefix rules above.
- Full suite, type-check, lint stay green.

## Docs

- `frontend/CLAUDE.md` routes table.
- Root `CLAUDE.md` if it references old routes.

## Out of Scope

- Backend/API paths (`/api/v1/sequences`, `/api/v1/detections`) — entity
  names are correct for the API.
- Component/file renames (`SequencesPage.tsx` etc.) — a later cleanup if
  wanted; this issue is user-facing URLs and their direct plumbing.
