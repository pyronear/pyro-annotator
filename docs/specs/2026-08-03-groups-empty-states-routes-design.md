# Sequence Groups: Filter Routes + Empty States

**Date:** 2026-08-03
**Page:** `/classify/groups` (`SequenceGroupsListPage`)
**Companions:** `docs/specs/2026-08-03-localize-empty-states-design.md` (#242),
`docs/specs/2026-08-03-classify-empty-states-design.md` (#244),
`frontend/DESIGN.md` (fire-lookout system, #243).

## Problem

The To label / Labeled / All selector is component state (`useState`), so the
selected tab is not shareable, not bookmarkable, and resets on every visit.
The empty state is a bare `<td>` inside the table — sortable headers float
above zero rows — with legacy gray styling and no differentiation between
"everything is labeled" (success) and "no groups exist".

## Design

### Filter routes

Three routes in `App.tsx`, all rendering `SequenceGroupsListPage` with a
`filter` prop:

| Path | Filter | Selector label |
|---|---|---|
| `/classify/groups` | `unlabeled` | To label (default, canonical bare URL) |
| `/classify/groups/labeled` | `labeled` | Labeled |
| `/classify/groups/all` | `all` | All |

- Static segments take precedence over the numeric `/classify/groups/:id`
  detail route in React Router v6; declare them before it regardless.
- `routes.ts`: add a `classifyGroups(filter)` builder returning the paths
  above (bare path for `unlabeled`); keep `ROUTES.CLASSIFY_GROUPS` as-is.
- The page drops its `filter` state. Selector buttons become `<Link>`s with
  `aria-current="page"` on the active tab. A `useEffect` on the `filter`
  prop resets `page` to 1 on tab switch. Sort state intentionally survives
  tab switches (matches current behavior).
- Legacy `/sequence-groups*` redirects are unaffected.

### Selector restyle (fire-lookout)

Same segmented shape, migrated tokens per DESIGN.md's touch-it-migrate-it
rule:

- Container: `inline-flex rounded-lg border border-line bg-ash p-0.5 gap-0.5 text-sm`
- Tab (active): `bg-paper text-char font-semibold border border-line rounded-md px-3.5 py-1.5`
  — hairline border, no shadow
- Tab (inactive): `text-haze hover:text-char font-medium rounded-md px-3.5 py-1.5`
- Counts: `font-data text-xs` — `text-ember` on the active tab, `text-haze`
  otherwise (counts always mono; no pill background)

### Empty states

When the active tab has zero rows, the table card and pagination are not
rendered at all — the centered branded stage replaces them (header and
selector stay visible). Pattern identical to #242/#244: 56px `aria-hidden`
icon badge, `<h2>` headline (`mt-4 font-display text-base font-semibold
text-char`), body (`mt-1.5 font-body text-sm leading-relaxed text-haze`),
one action; stage is `flex items-center justify-center min-h-96` with a
`text-center max-w-md` inner container.

1. **To label empty** (all groups labeled — success)
   - Icon: `Check` in `pine` on `pine-soft`
   - Headline: "All groups labeled"
   - Body: "Nice work — every group is labeled. New groups form
     automatically a few minutes after each import."
   - CTA: "Start classifying" → `ROUTES.CLASSIFY`, solid `ember` button
     (primary-CTA tone per DESIGN.md; classify-lane context)

2. **Labeled empty** (nothing labeled yet — work to do)
   - Icon: `Layers` in `ember` on `ember-soft`
   - Headline: "No labeled groups yet"
   - Body: "Groups you label land here."
   - CTA: "Label groups" → `/classify/groups` (the To label tab), solid
     `ember` button

3. **All empty** (no groups exist — informational)
   - Icon: `Layers` in `haze` on `paper` with `line` border
   - Headline: "No groups yet"
   - Body: "Groups form automatically after imports — only groups of 3 or
     more sequences appear here."
   - No action.

Button recipe (matches #242/#244 CTAs): solid —
`mt-5 inline-block rounded-lg bg-ember px-7 py-2.5 font-body text-[13.5px]
font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2
focus:ring-char focus:ring-offset-2`.

The "what is a sequence group" education stays in the existing Info popover
next to the page title; empty-state bodies stay short.

## Implementation notes

- `Check` and `Layers` from `lucide-react` (no new dependencies).
- Loading and error states untouched. Table markup untouched apart from
  removing the in-`<tbody>` empty branch. The rest of the page's legacy
  styling (title, table, pills, pagination) is out of scope.
- The three empty variants key off the `filter` prop, not the fetched data
  shape: `unlabeled` → state 1, `labeled` → state 2, `all` → state 3.

## Testing

New `frontend/tests/pages/SequenceGroupsListPage.test.tsx` (none exists
today), mocking `apiClient.getSequenceGroups` / `getSequenceGroupStats`,
rendering through `MemoryRouter` + `Routes` so route→filter mapping is real:

1. `/classify/groups` renders the To label empty state with "Start
   classifying" linking to `/classify`; table absent.
2. `/classify/groups/labeled` renders "No labeled groups yet" with "Label
   groups" linking to `/classify/groups`.
3. `/classify/groups/all` renders "No groups yet" with no action button.
4. Selector links point at the three paths; active tab carries
   `aria-current="page"`.
5. With non-empty data, the table renders and the empty stage is absent
   (guards the happy path).

Full suite passes; `type-check`, ESLint (touched files), Prettier clean.
