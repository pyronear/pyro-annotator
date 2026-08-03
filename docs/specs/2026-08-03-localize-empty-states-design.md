# Localize Empty States Redesign

**Date:** 2026-08-03
**Pages:** `/localize` (`DetectionAnnotatePage`), `/localize/done` (`DetectionReviewPage`)

## Problem

Both localize pages render bare-text empty states in generic Tailwind grays,
disconnected from the branded design system (Archivo display font, char/haze
text, ember/pine accents) used on the dashboard. The `/localize/done` filtered
state uses a 🔍 emoji. Copy leaks engineering vocabulary ("the auto reference
layer is computed") and offers no next action.

## Design

All three empty states share one visual pattern, consistent with the dashboard:
a 56px circular icon badge, an Archivo (`font-display`) semibold headline in
`char`, body copy in `haze`, and one action button. Layout stays centered in
the existing `min-h-96` stage. Loading and error states are untouched.

### 1. `/localize` — queue empty

An empty queue means the annotator is done: frame it as success.

- **Icon:** `Check` (lucide) in `pine` on a `pine-soft` circle
- **Headline:** "Localization queue is clear"
- **Body:** "Nice work — nothing to box right now. Classifying more alerts is
  what fills this queue."
- **CTA:** "Start classifying" → `ROUTES.CLASSIFY`. Solid `pine` button styled
  like the dashboard `PhaseCard` CTA (white text, rounded-lg,
  hover:brightness-95, focus ring).

### 2. `/localize/done` — no filters, nothing localized yet

A review list with nothing reviewed is a "work to do" state, not a success —
ember accent.

- **Icon:** `BoxSelect` (lucide, dashed rectangle) in `ember` on an
  `ember-soft` circle
- **Headline:** "No localized alerts yet"
- **Body:** "Finished localizations show up here for review. Head to the queue
  to box your first alert."
- **CTA:** "Start localizing" → `ROUTES.LOCALIZE`. Solid `ember` button, same
  button treatment as above.

### 3. `/localize/done` — filters active, no matches

Neutral, replaces the emoji; the action actually clears filters instead of
telling the user to adjust them.

- **Icon:** `Search` (lucide) in `haze` on a white circle with `line` border
- **Headline:** "No matching alerts"
- **Body:** "Nothing localized matches your current filters. Loosen or clear
  them to see more."
- **Action:** "Clear filters" ghost button (white bg, `line` border, `char`
  text) wired to the page's existing `resetFilters`.

## Implementation notes

- Icons come from `lucide-react` (already a dependency); no new packages.
- CTAs are React Router `<Link>`s; "Clear filters" is a `<button>` calling
  `resetFilters`.
- The three states are small enough to inline in their pages, matching how the
  current empty states are written. No shared component unless a third page
  needs the pattern later.
- Filter detection on `/localize/done` keeps using the existing
  `hasActiveUserFilters` logic; only the rendered markup changes.

## Testing

- Update `tests/components/dashboard/DetectionAnnotatePage.test.tsx` (asserts
  the old "No alerts ready for localization" text) to the new headline, and
  assert the CTA links to `/classify`.
- Add coverage for the `/localize/done` states if a rendering test exists for
  that page; `DetectionReviewPage.defaults.test.ts` is logic-only, so a new
  test is optional — at minimum verify "Clear filters" calls `resetFilters`
  if a page-level test harness is practical.
- `npm run quality` passes.
