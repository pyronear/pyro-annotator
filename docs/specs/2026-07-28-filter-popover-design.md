# Filter Popover Design

**Date**: 2026-07-28
**Status**: Approved
**Scope**: frontend only

## Context

Classify > Sequences (`/classify`), Classify > Done (`/classify/done`), and Localize > Done (`/localize/done`) all render the shared `TabbedFilters` component (`frontend/src/components/filters/TabbedFilters.tsx`): a full-width white card with Simple/Advanced tabs that sits between the page title and the results table on every visit, even when no filters are applied. The card is visually heavy for a control most users touch rarely.

Localize > Smoke (`/localize`) has no filters and is explicitly **out of scope** — it stays as-is.

## Goal

Hide the filter controls behind a "Filters" button that opens a floating popover, while keeping applied filters glanceable and individually clearable from the page. Filter *behavior* (immediate apply, localStorage persistence, TanStack Query refetch) is unchanged.

## Design

### Trigger row

- The filter card is removed. A **Filters button** (lucide `SlidersHorizontal` icon + "Filters" label) sits right-aligned in the page title row.
- On Classify > Done it sits alongside the existing Stage selector, which stays where it is (rendered by `SequencesPageWrapper`, outside the filter component).
- No count badge on the button — applied-filter pills carry that information.

### Applied-filter pills

- Each active filter renders as a removable pill beside the button, red-tinted (`bg-primary-50 border-primary-100 text-primary-700` family), with an `✕` that clears **only that filter**.
- Pill labels:
  - Single-value selects show the value: `Camera: marguerite-29`, `Org: Pyronear FR`, `Source: alert_api`, `Wildfire: Smoke`, `Accuracy: High`, `Unsure only`.
  - Date range shows the preset name when one is active (`Last 7 days`), otherwise `From 2026-07-01` / `2026-07-01 – 2026-07-15` as applicable.
  - Multi-selects show the value when one is selected, a count when more: `FP type: Antenna`, `FP types (3)`, `Smoke types (2)`.
- Pills wrap onto additional lines if needed; when no filters are active, only the button shows.
- Rationale: filters persist in localStorage across sessions, so the pills are what tells a returning user why their list is filtered.

### Popover

- Headless UI `Popover` + `Transition` (`@headlessui/react` is already a dependency, currently unused).
- Anchored under the button, right-aligned, ~340px wide (`w-[340px]` or `w-80`/`w-96` equivalent), `max-h` capped with internal scroll.
- Closes on outside click, Esc, or re-clicking the button. No "Done"/"Apply" button — filters apply immediately on change, exactly as today.
- Footer: a single "Reset all" action, rendered only when at least one filter is active (reuses the existing `hasActiveFilters()` logic).

### Interior — progressive disclosure, no more tabs

- The Simple/Advanced tab concept is **removed entirely**.
- Always visible, in order: **Camera**, **Organization**, **Date Range** (single-column stack).
- Below them, a **"More filters (N)"** divider expands in place to reveal the remaining, page-flag-gated widgets: Source API, Wildfire Classification, Model Accuracy (`showModelAccuracy`), Certainty (`showUnsureFilter`), False Positive Types (`showFalsePositiveTypes`), Smoke Types (`showSmokeTypes`). `N` = number of those widgets active for the page.
- Expanded/collapsed state persists in localStorage under a new key (`filter-popover-more-expanded`, a persisted boolean following the same pattern as `usePersistedTabState`). The old global `tabbed-filters-active-tab` key is retired.
- Side benefit: the camera/org selects currently copy-pasted between the Simple and Advanced renderers collapse into a single renderer.

## Component changes

| File | Change |
|---|---|
| `src/components/filters/FilterPopover.tsx` | New — replaces `TabbedFilters`. Props identical to `TabbedFiltersProps` minus `defaultTab`, `simpleTabLabel`, `advancedTabLabel`. |
| `src/components/filters/TabbedFilters.tsx` | Deleted once call sites migrate. |
| `src/pages/SequencesPage.tsx` | Swap component at both call sites (empty-state branch and normal branch); move trigger into the title row. |
| `src/pages/DetectionReviewPage.tsx` | Same swap at both call sites. |
| `src/components/filters/*` widgets | Unchanged (`FalsePositiveFilter`, `SmokeTypeFilter`, `DateRangeFilter`, `ModelAccuracyFilter`). |
| `src/hooks/usePersistedFilters.ts` | Unchanged. |

Unused-after-this: the `tabbed-filters-active-tab` persisted key (left to expire in users' localStorage; no migration code).

## Not changing

- Filter state management (`usePersistedFilters`, per-page storage keys).
- TanStack Query wiring and immediate-apply behavior.
- Stage selector on Classify > Done.
- Localize > Smoke page.
- Backend/API.

## Testing

Vitest component tests for `FilterPopover`:

1. Popover opens on button click, closes on Esc/outside click.
2. Active filters render as pills; `✕` on a pill clears exactly that filter (asserts `onFiltersChange` payload).
3. Pill label formats: single value, date preset, multi-select count.
4. "More filters" expander reveals only the flag-gated widgets the page enables.
5. "Reset all" appears only with active filters and calls `onResetFilters`.
6. Existing `TabbedFilters` tests migrate to the new component or are retired with it.
