# Sign-in Page Restyle — Design

**Date**: 2026-08-03
**Status**: Approved (mockup reviewed via visual companion)

## Goal

Bring `/login` in line with the dashboard's visual system. The page currently
uses a generic blue Tailwind template (blue gradient background, `blue-600`
button, gray text, default font) that reads as a different product from the
dashboard's editorial palette. Also replace the tagline copy.

## Scope

One file: `frontend/src/pages/LoginPage.tsx`. Structure, props, state,
handlers, and accessibility attributes are unchanged — only class names and
the tagline text change.

## Visual changes

Token sources: `frontend/tailwind.config.js` (`ash`, `paper`, `line`, `char`,
`haze`, `ember`, `signal`) and the idioms in
`frontend/src/components/dashboard/PhaseCard.tsx` / `DashboardPage.tsx`.

| Element | Current | New |
| --- | --- | --- |
| Page background | `bg-gradient-to-br from-blue-50 to-blue-100` | flat `bg-ash` |
| Headline | `text-3xl font-bold text-gray-900` | `font-display text-[27px] font-semibold tracking-tight text-char` (dashboard h1 scale) |
| Tagline | "Wildfire detection annotation system", `text-gray-600` | "Classify and localize wildfire smoke from Pyronear cameras.", `font-body text-[13.5px] text-haze` |
| Card | `bg-white rounded-xl shadow-lg border-gray-100` | `rounded-[10px] border border-line bg-paper`, no shadow (flat, border-defined like PhaseCard) |
| Field labels | `text-gray-700` | `font-body font-medium text-char` |
| Inputs | `border-gray-300`, blue focus ring | `border-line`, `focus:ring-ember focus:border-ember`, `font-body` |
| Field icons | `text-gray-400` | `text-haze` |
| Show/hide toggle | `text-gray-400 hover:text-gray-600` | `text-haze hover:text-char` |
| Error box | `bg-red-50 border-red-200`, `text-red-500/700` | `bg-signal-soft` (no border), icon + text `text-signal` |
| Submit button | `bg-blue-600 hover:bg-blue-700`, blue focus ring | `bg-ember font-semibold hover:brightness-95 focus:ring-char focus:ring-offset-2` (dashboard CTA idiom), full width; disabled/spinner behavior unchanged |
| Footer | "Pyronear" `text-xs text-gray-500` | `font-data text-[10.5px] font-medium uppercase tracking-[0.14em] text-haze` (dashboard mono-label motif) |

Logo image is unchanged.

## Verification

- `npm run quality` (type-check + lint + format) and `npm test` pass.
- Before/after screenshot of `/login` (unauthenticated — no JWT stub needed)
  confirms the rendered page matches the approved mockup.
