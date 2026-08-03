# Frontend Design Guidelines — Design

**Date:** 2026-08-03
**Status:** Approved

## Problem

The frontend has a coherent visual language — the "fire-lookout" system used by
/dashboard, /users, the sign-in page, and /guide — but it is not written down
anywhere canonical. Design intent lives scattered across 8+ per-feature specs
(`2026-07-28-dashboard-taxonomy-redesign-design.md` being the closest thing to
a source of truth). Meanwhile the rest of the app still runs on the legacy
palette (~680 `gray-*` usages vs ~26 `ember`), three different primary button
styles coexist, `src/index.css` sets a global base that contradicts the new
look, and a dead `.btn-primary`/`.card` component layer sits unused on the old
palette.

## Decision

Codify the fire-lookout system into a canonical guidelines document plus a
minimal token-layer cleanup. Migration of legacy pages is **not** part of this
work — the doc's deprecation rule handles it incrementally as files are
touched.

Deliverables:

1. `frontend/DESIGN.md` — the living guidelines document
2. `frontend/CLAUDE.md` — one pointer line: read DESIGN.md before UI work
3. `tailwind.config.js` — named tokens for the ad-hoc sizes
4. `src/index.css` — flip the global base to the new look, remove dead classes
5. Converted pages adopt the named tokens (mechanical, zero visual change)

## The design language (content of DESIGN.md)

### Palette

Five neutrals, three accents; each accent has a `-soft` tint.

| Role | Token | Hex | Usage rule |
|---|---|---|---|
| App background | `ash` | `#F7F6F3` | Pages sit on ash; cards never do |
| Surface | `paper` | `#FFFFFF` | Cards, tables, modals |
| Borders | `line` | `#E4E2DC` | All borders/dividers — hairlines instead of shadows; no `shadow-*` |
| Ink | `char` | `#20261F` | Primary text, neutral emphasis, button focus rings |
| Muted | `haze` | `#767B72` | Secondary text, icons, placeholders |
| Action | `ember` / `ember-soft` | `#D9581E` / `#FBEFE8` | Primary CTAs everywhere + Classify lane identity |
| Calm accent | `pine` / `pine-soft` | `#166A5D` / `#E9F2F0` | Localize lane identity, active nav, positive states |
| Alert | `signal` / `signal-soft` | `#B3261E` / `#FBEEED` | Errors, destructive, attention **only** — never decorative |

Rules:

- One accent per element; accent color appears only where action or meaning lives.
- `-soft` tints are used only as fills behind their own accent's text
  (`bg-ember-soft text-ember`).
- Hover on solid buttons is `hover:brightness-95`, never a darker shade.
- Focus rings: `char` on buttons, `ember` on text inputs.
- Legacy palettes (`primary-*`, `gray-*`, `blue/green/red/orange-*`) are
  **deprecated: no new usage**. Migrate opportunistically when touching a file.

### Typography

Three families with strict roles (self-hosted via `@fontsource`, imported in
`src/main.tsx`):

- `font-display` (Archivo 600): page titles and card headings only
- `font-body` (IBM Plex Sans 400/500/600): all copy, labels, buttons
- `font-data` (IBM Plex Mono 500/600): every numeral, count, timestamp, stage
  code, eyebrow, and table header — counts always mono

Named type scale (new `fontSize` tokens):

| Token | Size | Use |
|---|---|---|
| `text-title` | 27px | Page h1, with `font-display font-semibold tracking-tight` |
| `text-heading` | 18.5px | Card h2, with `font-display font-semibold` |
| `text-body` | 13.5px | Body copy (buttons use standard `text-sm`, per the recipes below) |
| `text-detail` | 12.5px | Secondary text, usually `text-haze` |
| `text-eyebrow` | 10.5px | Mono eyebrows and table headers |

One-off sizes (e.g. the 38px dashboard numeral) stay as arbitrary values.

Other tokens: `tracking-eyebrow` (0.14em), `rounded-card` (10px).

The signature eyebrow recipe:
`font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze`
(tone color replaces `text-haze` when the eyebrow belongs to an accent
section).

### Component recipes

DESIGN.md documents these as copyable class strings, sourced verbatim from the
converted pages:

- **Card**: `rounded-card border border-line bg-paper` — flat, no shadow
- **Primary button**: `rounded-lg bg-ember px-4 py-2 font-body text-sm
  font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2
  focus:ring-char focus:ring-offset-2` (tone may be `pine` in Localize
  contexts)
- **Secondary button**: `rounded-lg border border-line bg-paper px-3 py-2
  font-body text-sm font-medium text-char hover:bg-ash`
- **Tertiary link**: `font-body text-detail text-haze hover:text-char` with a
  trailing `→`
- **Filter chip**: `rounded-full px-3 py-1 font-body text-xs font-medium`;
  selected `bg-{tone}-soft text-{tone}`, unselected `bg-ash text-haze
  hover:text-char`
- **Badge/pill**: `inline-flex rounded-full px-2 py-1 font-body text-xs
  font-semibold` + soft-tone pairs
- **Table**: container `rounded-card border border-line bg-paper
  overflow-hidden`; `divide-y divide-line`; `thead bg-ash`; `th` uses the
  eyebrow recipe; row hover `hover:bg-ash`; date/count cells `font-data
  text-detail text-haze`
- **Input**: `border border-line rounded-lg font-body focus:outline-none
  focus:ring-2 focus:ring-ember focus:border-ember`; icon well `text-haze`
- **Error block**: `bg-signal-soft rounded-lg p-4` + `text-signal`
- **Spinner**: `animate-spin rounded-full border-b-2 border-ember`
- **Skeleton**: `animate-pulse rounded bg-ash`
- **Progress bar**: track `h-1 rounded-sm bg-ash`, fill `bg-{tone}` with
  inline width
- **Left-bar accent**: `border-l-2 pl-3.5 border-{tone}` (nav uses
  `border-l-[3px]`)

DESIGN.md also includes a short "migrating a page" note pointing at
`docs/specs/2026-08-03-login-page-restyle-design.md` for its before/after
class-mapping table.

## Code changes

### `tailwind.config.js` (additive)

- `fontSize`: `title: '27px'`, `heading: '18.5px'`, `body: '13.5px'`,
  `detail: '12.5px'`, `eyebrow: '10.5px'`
- `letterSpacing`: `eyebrow: '0.14em'`
- `borderRadius`: `card: '10px'`
- Legacy `primary` ramp stays (106 usages) with a
  `// DEPRECATED — do not use in new code` comment

### `src/index.css`

- `html` font-family → `"IBM Plex Sans", system-ui, sans-serif`
- `body` → `@apply bg-ash text-char antialiased` (was `bg-gray-50
  text-gray-900`)
- Delete the dead `.btn-primary` / `.btn-secondary` / `.input-primary` /
  `.card` component layer (zero consumers, verified by grep)
- Keep `.chevron-seg*`, `.sequence-player-image`, `.image-preload`,
  `.animate-pulse-subtle`

The base flip shifts every legacy page's background (`gray-50` → `ash`,
near-identical) and default font (system-ui → IBM Plex Sans, visible) — this
is intentional drift toward the new look. Minor layout shifts in annotation
UIs from font metrics are acceptable.

### Converted pages adopt named tokens

Mechanical rename in `DashboardPage`, `UserManagementPage`, `LoginPage`,
`GuidePage`, and `src/components/dashboard/*`: `text-[27px]` → `text-title`,
`text-[18.5px]` → `text-heading`, `text-[13.5px]` → `text-body`,
`text-[12.5px]` → `text-detail`, `text-[10.5px]` → `text-eyebrow`,
`tracking-[0.14em]` → `tracking-eyebrow`, `rounded-[10px]` → `rounded-card`.
Same pixel values, new names — zero visual change. Sizes outside the scale
(11px, 11.5px, 13px, 38px, `tracking-[0.12em]`) stay arbitrary.

## Verification

- `npm run quality` passes (lint, type-check, tests)
- Screenshot check via the playwright recipe: /dashboard, /users, and login
  render unchanged; one legacy page (e.g. /sequences) eyeballed to confirm the
  base flip is acceptable

## Out of scope

- Migrating legacy pages, modals, or the app chrome (`AppLayout`)
- Shared React components (Button, Card, Badge primitives)
- Dark mode
- `src/utils/processingStage.ts` / `src/utils/modelAccuracy.ts` badge maps
  (legacy-palette consumers; handled during future migration)
