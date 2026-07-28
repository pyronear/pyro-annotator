# Nav Pill Tones & Full-Width States — Design

**Date:** 2026-07-28
**Status:** Approved

## Problem

The left sidebar nav links still use the legacy red `primary-*` palette
(`bg-primary-50`, `border-r-4 border-primary-600`, `text-primary-700`) and
gray hover states (`hover:bg-gray-50`), while the dashboard runs on the newer
warm token set — **ember** (`#D9581E`) for Classify, **pine** (`#166A5D`) for
Localize. Additionally, the nav container's `px-2` insets the pills 8px on
each side, so hover/active backgrounds never reach the sidebar edges.

## Design

Single file touched: `frontend/src/components/layout/AppLayout.tsx`.

### 1. Full-width pills

- Remove `px-2` from the `<nav>` container so links span the full 256px rail.
- Drop `rounded-l-md` and the right-side `border-r-4`; the active accent
  becomes a **left** bar (`border-l-[3px]`), matching the dashboard's
  `AttentionBanner` left-bar treatment.
- Inactive and hover states carry `border-l-[3px] border-transparent` so text
  never shifts when a link becomes active.
- Section eyebrow labels get `px-4` to keep their current 16px indent after
  the container padding is removed.

### 2. Single ember accent

All nav items use the same colors regardless of section (per user decision —
no per-section tones):

- **Active:** `bg-ember-soft text-ember border-ember`
- **Hover (inactive):** `hover:bg-ash hover:text-char`
- **Base:** `text-haze`, with `transition-colors` added (mirrors the
  dashboard's haze→char link hover)

No changes to the nav data structure are needed.

### Out of scope

Section eyebrow labels (recently styled deliberately), the user-menu footer,
`NotificationBadge`, and the legacy `primary-*` palette elsewhere.

## Verification

- Existing frontend tests pass (`npm run test`) — baseline: 667 tests, 38 files.
- `npm run quality` (ESLint + type-check) passes.
- Visual check in the dev server: pills span edge-to-edge, active items
  render in ember, hover fills full width in ash, no text shift on activation.
