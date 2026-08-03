# Classify Empty States Redesign

**Date:** 2026-08-03
**Pages:** `/classify` and `/classify/done` — both rendered by
`SequencesPage` (`/classify/done` via `SequencesPageWrapper`, which passes
`isReviewPage` and a stage selector).
**Companion:** `docs/specs/2026-08-03-localize-empty-states-design.md`
(PR #242) — this applies the same design system to the Classify pages.

## Problem

`SequencesPage` renders three bare empty variants in generic Tailwind grays:
a 🔍 emoji for filtered no-matches (shared by both routes), a 🎉 emoji
"All caught up!" for the empty queue, and plain stage-scoped text on the
review page. None match the branded design system now used on the dashboard
and the Localize pages, and none offer an action.

## Design

All variants use the pattern established in PR #242: a 56px circular icon
badge (`aria-hidden`), an `<h2>` headline in `font-display` semibold `char`,
body copy in `haze`, and one action. Centered in the existing `min-h-96`
stage, inside a `max-w-md` container. Loading and error states untouched.
Button classes mirror the dashboard `PhaseCard` CTA
(`frontend/src/components/dashboard/PhaseCard.tsx:79`).

### 1. `/classify` queue empty, no filters (replaces 🎉)

- **Icon:** `Check` (lucide) in `pine` on a `pine-soft` circle
- **Headline:** "Classification queue is clear"
- **Body:** "Nice work — every imported sequence has been classified. New
  ones appear here as imports come in."
- **CTA:** "Start localizing" → `ROUTES.LOCALIZE`. Solid `pine` button.
  (Rationale: the queue refills from alert-API imports, not annotator
  action, so the CTA keeps the annotator moving down the pipeline.)

### 2. Filtered, no matches — shared by both routes (replaces 🔍)

- **Icon:** `Search` (lucide) in `haze` on a white circle with `line` border
- **Headline:** "No matching sequences"
- **Body:** "Nothing here matches your current filters. Loosen or clear
  them to see more."
- **Action:** "Clear filters" ghost button (white bg, `line` border, `char`
  text, `hover:bg-ash`) wired to the page's existing `resetFilters`.
- One shared block: the component's filtered branch already serves both
  routes and the copy holds for both.

### 3. `/classify/done`, no filters, stage-aware (replaces plain text)

- **Icon:** `ListChecks` (lucide) in `ember` on an `ember-soft` circle
- **Headline:** stage-aware —
  - "All classified" selected (`defaultProcessingStage` is an array, i.e.
    `ALL_CLASSIFIED_STAGES`): "No classified sequences yet"
  - specific stage selected: `No sequences in "<label>"` using the existing
    `getStageFilterLabel(defaultProcessingStage)`
- **Body:** "Sequences you classify land here for review."
- **CTA:** "Start classifying" → `ROUTES.CLASSIFY`. Solid `ember` button.

## Implementation notes

- All changes inline in `SequencesPage.tsx`'s existing empty-state ternary
  (`hasFilters` / `isReviewPage` / queue); the branch structure stays.
- Icons from `lucide-react` (verified present in the installed version); no
  new dependencies.
- CTAs are React Router `<Link>`s; "Clear filters" is a `<button>` calling
  `resetFilters`.
- "All classified" detection: `Array.isArray(defaultProcessingStage)` —
  matches how `getStageFilterLabel` distinguishes the pseudo-stage.
- Filter detection keeps using the existing `hasActiveUserFilters` call
  (its known `source_api` blind spot is a separate follow-up).

## Testing

- Extend the existing `SequencesPage` test coverage (or add a focused
  empty-state test file following
  `frontend/tests/pages/DetectionReviewPage.empty.test.tsx`) with the four
  states:
  1. queue empty, no filters → new headline + "Start localizing" href
     `/localize`, 🎉 gone
  2. filtered (queue) → "No matching sequences" + "Clear filters" calls
     `resetFilters`, 🔍 gone
  3. done, "All classified", no filters → "No classified sequences yet" +
     "Start classifying" href `/classify`
  4. done, specific stage, no filters → `No sequences in "<label>"`
- Full suite passes; `type-check`, lint, and Prettier clean on touched
  files. (Repo-wide lint has a pre-existing `console.debug` failure in
  `DetectionSequenceAnnotatePage.tsx`, out of scope.)
