# Framed Pyronear Logo (#105)

**Issue**: https://github.com/pyronear/pyro-annotator/issues/105

## Goal

Replace the annotator's generic clip-art flame logo with one built from the
official Pyronear mark (flame-with-eye), framed with corner brackets like the
current annotator logo, so the tool's branding is consistent with Pyronear's.

Color-tone theming of the app is out of scope (deferred to a separate issue,
per the issue text).

## Current state

- `frontend/src/assets/logo.png` — generic flame in a dark bracket frame.
- Used in three components, all importing `@/assets/logo.png`:
  - `frontend/src/pages/LoginPage.tsx` (80×80 CSS px)
  - `frontend/src/pages/DashboardPage.tsx` (64×64 CSS px)
  - `frontend/src/components/layout/AppLayout.tsx` (32×32 CSS px)
- Favicon: `index.html` links `/vite.svg`, which does not exist
  (`frontend/public/` is absent) — the tab icon is broken/default.

## Source asset

The official flame-only Pyronear mark exists only as a 200×200 PNG
(dark flame outline with an eye, orange pupil):
`pyronear/new-pyro-platform` → `src/assets/small-logo.png`
(same file as `pyronear/pyronear.github.io` → `img/logo.png`).
No vector version of the mark is published in the Pyronear org.

## Design

### Asset creation (composite PNG)

Generate a new `frontend/src/assets/logo.png` with a one-off Python/PIL
script (script not committed; only the resulting images are):

- 256×256 transparent canvas.
- Official flame-with-eye mark downscaled to ~170 px (downscaling preserves
  sharpness of the 200 px source) and centered.
- Four dark rounded corner brackets drawn around it, matching the current
  logo's frame style and near-black stroke color (sampled from the current
  asset).

### Favicon

- Create `frontend/public/` (Vite default `publicDir`, no config change
  needed) containing `favicon.png`, a 64×64 rendition of the same composite.
- Update `frontend/index.html`: replace the `/vite.svg` icon link with
  `<link rel="icon" type="image/png" href="/favicon.png">`.

### Integration

No component changes — the three `<img>` usages keep importing
`@/assets/logo.png` and pick up the new artwork automatically.

## Files touched

| File | Change |
|------|--------|
| `frontend/src/assets/logo.png` | Replaced with new composite |
| `frontend/public/favicon.png` | New |
| `frontend/index.html` | Icon link: `/vite.svg` → `/favicon.png` |

## Verification

- `npm run build` and `npm test` pass in `frontend/`.
- Visual check of the generated PNGs (flame centered, frame proportions
  match the old logo, transparency preserved).
- Login page screenshot in the dev server shows the new logo; browser tab
  shows the new favicon.
