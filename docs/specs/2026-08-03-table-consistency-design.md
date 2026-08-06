# Table consistency across the five list pages

Date: 2026-08-03
Status: approved

## Problem

The five list tables — `/localize` (LocalizeQueueTable), `/localize/done`
(LocalizeDoneTable), `/classify` (ClassifyQueueTable), `/classify/done`
(ClassifyDoneTable), and `/classify/groups` (inline table in
SequenceGroupsListPage) — have drifted apart in font size, colors, hover
styles, paddings, pill usage, column order, card chrome, and pagination.
PR #247 migrated the two Done tables to the fire-lookout DESIGN.md table
recipe; the two queue tables are still on the deprecated `gray-*` palette,
and the groups table is fully bespoke (`px-3 py-2.5`, `hover:bg-blue-50`,
`shadow-sm`, its own tooltip/sort headers, pill and pagination styles).

## Goal

Converge all five tables on one recipe: the structure of `/localize`
(header tooltips, plain text cells, uniform hover, thumbnail) rendered in
fire-lookout tokens — i.e. exactly what the Done tables already look like.
Also make column order consistent and remove decorative pills.

## 1. One visual recipe

- **Card**: `rounded-card border border-line bg-paper overflow-hidden`.
  Replaces `/localize`'s `bg-white shadow rounded-lg`, groups'
  `shadow-sm`, and the `bg-white rounded-lg border border-gray-200` cards.
  No shadows anywhere.
- **Table**: `min-w-full divide-y divide-line`; thead `bg-ash`; tbody
  `bg-paper divide-y divide-line`.
- **Headers**: every column uses the shared `ColumnHeader`
  (`px-4 py-3 text-left font-data text-eyebrow font-medium uppercase
  tracking-eyebrow text-haze` + CSS hover tooltip). `/classify` and
  `/classify/done` gain tooltips; the groups page's inline duplicate
  (`headerTip` / `SortableHeader` / `PlainHeader`) is removed.
- **Cells**: `px-4 py-2 whitespace-nowrap`.
  - Camera (primary): `font-body text-sm font-medium text-char`.
  - Other text: `font-body text-sm text-haze`.
  - Dates / counts / azimuth: `font-data text-detail text-haze`
    (counts always mono).
- **Rows**: `cursor-pointer hover:bg-ash` (replaces groups' blue hover).
- Density stays at the house `px-4 py-3` (th) / `px-4 py-2` (td) used by
  the freshly migrated Done tables, not DESIGN.md's `px-6` — the Done
  tables are the de-facto recipe.

## 2. Canonical column order

Shared identity prefix, then phase-specific columns, Result last:

| Page | Order |
|---|---|
| `/localize` | Thumb · Camera · Organisation · Recorded · Source · Azimuth · Smoke types · Objects · Frames · Result |
| `/localize/done` | Thumb · Camera · Organisation · Recorded · Source · Azimuth · Smoke types · Frames · Result |
| `/classify` | Thumb · Camera · Organisation · Recorded · Source · Azimuth · Alert API annotation |
| `/classify/done` | Thumb · Camera · Organisation · Recorded · Source · Azimuth · Alert API annotation · Result |
| `/classify/groups` | Camera · Organisation · Created · Azimuth · Sightings · Label · Annotators · › |

The classify tables move "Alert API annotation" from between Recorded and
Source to after Azimuth. Groups reorders its overlapping columns to match
the prefix (Created takes the Recorded slot).

## 3. De-pill

- **Both classify tables**: Source and Alert API annotation become plain
  text cells (`font-body text-sm text-haze`). The annotation keeps its
  emoji label text (🔥 Wildfire / 💨 Other Smoke / ○ Other).
  `PlatformAnnotationPill` is kept as the component that owns the label
  mapping but renders a plain span instead of a pill (and is renamed
  accordingly, e.g. `PlatformAnnotationLabel`).
- **Groups**: member count becomes a plain mono number
  (`font-data text-detail text-haze`); label becomes plain text
  ("smoke · trail", "false positive · antenna"). Only the **"to label"**
  state keeps a badge — `bg-ember-soft text-ember` per the badge recipe —
  since it flags pending work. "validated" goes `text-green-700` →
  `text-pine`; the em-dash placeholder and row chevron go `text-haze`.

## 4. Groups table specifics

- Sorting is kept: `ColumnHeader` gains optional sort props (column key,
  current order, direction, onSort) and absorbs the local
  `SortableHeader`. Active sort arrow: `text-ember`.
- Camera stays a real `<Link>`: `font-body text-sm font-medium text-char
  hover:underline`; the row-level click handler is unchanged.
- The relative-time Created cell keeps its full-date `title` attribute.

## 5. Shared primitives

- `src/components/sequences/tableStyles.ts` exports the header/cell/row
  class constants, removing the four copy-pasted `HEADER_CLASSES` /
  `CELL_CLASSES` pairs.
- One **`TablePagination`** component replaces `SequencesPagination`,
  `DetectionReviewPagination`, and the inline paginations on `/localize`
  and groups:
  - Label: `font-body text-sm text-haze`, "Page X of Y · N items" when a
    total is known, otherwise "Page X of Y".
  - Buttons: `inline-flex items-center rounded-lg border border-line
    bg-paper px-3 py-1.5 font-body text-sm font-medium text-char
    hover:bg-ash disabled:opacity-50` with lucide ChevronLeft /
    ChevronRight icons.
  - Placement: inside the card as a `border-t border-line px-4 py-3`
    footer on all five pages (moves `/localize`'s and groups' pagination
    into the card).
  - The count line renders whenever a total is known — single-page lists
    show "N items" with no buttons; the Previous/Next buttons appear only
    when there is more than one page.
- The classify pages' in-card count/page-size strip
  (`SequencesTableHeader`) is removed: the count was redundant with the
  footer's "Page X of Y · N sequences", and the page-size select moves up
  into the page header next to Filters — matching `/localize/done`. The
  conditional "(filtered from N total)" note folds into the footer label.
  The page-size select on `/localize/done` is restyled to tokens
  (`border-line`, `font-body`, `text-haze` label).

## 6. Out of scope

- Empty states (already tokenized) and page titles are untouched.
- The `/localize` loading spinner is migrated to the token recipe
  (`border-b-2 border-pine`) since the file is touched anyway.
- Known dead code (`DetectionAnnotateTableHeader` + test, exported only
  from `index.ts`) is noted but not removed here.
- The groups page's info popover and filter tab bar are unchanged.

## 7. Verification

- Update existing table component tests (LocalizeQueueTable,
  LocalizeDoneTable, ClassifyDoneTable, groups page, pagination tests) for
  the new column orders and markup.
- `npm run quality` and `npm test` pass.
- Screenshot the five pages (playwright recipe) for a visual
  before/after consistency check.
