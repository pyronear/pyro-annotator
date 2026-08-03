# Design Guidelines — the fire-lookout system

The canonical visual language for the PyroAnnotator frontend. Reference
implementations: `src/pages/DashboardPage.tsx`, `src/pages/UserManagementPage.tsx`,
`src/pages/LoginPage.tsx`, `src/pages/GuidePage.tsx`.

**The rule for new code:** use only the tokens and recipes below. The legacy
palettes (`primary-*`, `gray-*`, `blue/green/red/orange-*`) are **deprecated —
no new usage**. When touching a legacy file, migrate the parts you touch.

## Palette

Five neutrals, three accents. Each accent has a `-soft` tint.

| Role | Token | Hex | Usage rule |
|---|---|---|---|
| App background | `ash` | `#F7F6F3` | Pages sit on ash (set globally on `body`); cards never do |
| Surface | `paper` | `#FFFFFF` | Cards, tables, modals |
| Borders | `line` | `#E4E2DC` | All borders/dividers — hairlines instead of shadows; no `shadow-*` |
| Ink | `char` | `#20261F` | Primary text, neutral emphasis, button focus rings |
| Muted | `haze` | `#767B72` | Secondary text, icons, placeholders |
| Action | `ember` / `ember-soft` | `#D9581E` / `#FBEFE8` | Primary CTAs everywhere + Classify lane identity |
| Calm accent | `pine` / `pine-soft` | `#166A5D` / `#E9F2F0` | Localize lane identity, active nav, positive states |
| Alert | `signal` / `signal-soft` | `#B3261E` / `#FBEEED` | Errors, destructive, attention **only** — never decorative |

Rules:

- One accent per element; accent color appears only where action or meaning lives.
- `-soft` tints are only fills behind their own accent's text: `bg-ember-soft text-ember`.
- Hover on solid buttons is `hover:brightness-95`, never a darker shade.
- Focus rings: `focus:ring-char` on buttons, `focus:ring-ember` on text inputs.

## Typography

Three families with strict roles (self-hosted via `@fontsource`, imported in
`src/main.tsx`):

- `font-display` — Archivo 600. Page titles and card headings **only**.
- `font-body` — IBM Plex Sans 400/500/600. All copy, labels, buttons. Also the
  global default (set on `html`).
- `font-data` — IBM Plex Mono 500/600. Every numeral, count, timestamp, stage
  code, eyebrow, and table header. **Counts always mono.**

Named type scale:

| Token | Size | Use |
|---|---|---|
| `text-title` | 27px | Page h1: `font-display text-title font-semibold tracking-tight text-char` |
| `text-heading` | 18.5px | Card h2: `font-display text-heading font-semibold text-char` |
| `text-body` | 13.5px | Body copy (buttons use standard `text-sm`) |
| `text-detail` | 12.5px | Secondary text, usually `text-haze` |
| `text-eyebrow` | 10.5px | Mono eyebrows and table headers |

Other tokens: `tracking-eyebrow` (0.14em), `rounded-card` (10px). One-off
sizes (e.g. the 38px dashboard numeral, `tracking-[0.12em]` in tight strips)
stay as arbitrary values.

**The signature eyebrow** — small mono uppercase label above headings and in
table headers:

```
font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze
```

Swap `text-haze` for the section's accent (`text-ember`, `text-pine`) when the
eyebrow belongs to an accent-toned block.

## Component recipes

Copy these class strings; don't improvise variants.

**Card** — flat, border-defined, no shadow:

```
rounded-card border border-line bg-paper px-[22px] py-5
```

**Primary button** (tone is `ember` by default; `pine` in Localize contexts):

```
inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2
```

**Secondary button**:

```
inline-flex items-center rounded-lg border border-line bg-paper px-3 py-2 font-body text-sm font-medium text-char hover:bg-ash
```

**Tertiary link** (trailing `→` in the label):

```
font-body text-detail text-haze hover:text-char
```

**Filter chip** (selected / unselected):

```
inline-flex items-center rounded-full px-3 py-1 font-body text-xs font-medium transition-colors
  selected:   bg-pine-soft text-pine   (or ember/signal variants)
  unselected: bg-ash text-haze hover:text-char
```

**Badge / pill**:

```
inline-flex rounded-full px-2 py-1 font-body text-xs font-semibold
  positive:  bg-pine-soft text-pine
  attention: bg-signal-soft text-signal
  action:    bg-ember-soft text-ember
  neutral:   bg-ash text-haze
```

**Table**:

```
container: rounded-card border border-line bg-paper overflow-hidden
table:     min-w-full divide-y divide-line
thead:     bg-ash
th:        px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze
tbody:     bg-paper divide-y divide-line
row hover: hover:bg-ash
cells:     px-6 py-4 whitespace-nowrap; primary cell font-body text-sm font-medium text-char;
           dates/counts font-data text-detail text-haze
```

**Input** (icon well: `absolute inset-y-0 left-0 pl-3` with `h-5 w-5 text-haze`):

```
block w-full px-3 py-3 font-body border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-ember focus:border-ember transition-colors
```

**Error block**:

```
bg-signal-soft rounded-lg p-4    +    font-body text-sm text-signal
```

**Spinner**: `animate-spin rounded-full h-8 w-8 border-b-2 border-ember`

**Skeleton**: `animate-pulse rounded bg-ash`

**Progress bar**: track `h-1 overflow-hidden rounded-sm bg-ash`, fill
`h-full bg-ember` (or `bg-pine`) with inline `style={{ width: pct }}`.

**Left-bar accent** (section markers; nav uses `border-l-[3px]`):

```
border-l-2 pl-3.5 border-ember   (or border-pine / border-char)
```

## Migrating a legacy page

Work class-by-class: `gray-50 → ash`, `white → paper`, `gray-200/300 borders →
line`, `gray-900 → char`, `gray-500/600 → haze`, `primary-600 buttons → the
primary button recipe`, `blue/green/red badges → the badge recipe`, drop all
`shadow-*`. See `docs/specs/2026-08-03-login-page-restyle-design.md` for a
worked before/after mapping table, and
`docs/specs/2026-07-28-dashboard-taxonomy-redesign-design.md` for the original
system rationale.
