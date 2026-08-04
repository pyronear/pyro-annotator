# Localize object editor route

Date: 2026-08-04
Status: approved, not implemented

## Problem

On the collocated localize screen (`LocalizeAlertPage`, mounted at
`/localize/:sequenceId/:detectionId?`), clicking a cell in the frame grid opens
that frame in `ImageModal` so a box can be drawn or the model's box accepted.
The URL names the frame but never names the **object** being worked on.

The object is instead reverse-engineered at render time: `modalContext`
(`src/pages/LocalizeAlertPage.tsx:361`) walks every lane of the alert looking
for the one whose detections contain `:detectionId`. That works — a detection
belongs to exactly one lane — but it leaves the URL unable to express the thing
the screen is actually about, and it makes an inconsistent URL undetectable:
there is no second fact to disagree with the first.

This spec gives the editor a route that references the object, as the
foundation for later work on the editor screen itself.

## Scope

**In:** the route, the URL builders, how the cockpit opens and closes the
editor, the invalid-URL guards that the new route makes possible, and the
tests for all of it.

**Out:** any change to the editor's layout, tools, keyboard shortcuts, or save
behavior. No `ImageModal` refactor.

> **Amended after #278 landed.** This spec was written when `/localize/done/…`
> and `/localize/lane/…` were served by the legacy per-lane
> `DetectionSequenceAnnotatePage`, and scoped that page out. #278 deleted it:
> `LocalizeAlertPage` now serves the Done list too, via a `mode` prop that
> carries provenance only (the list to return to, and the prefix its own URLs
> are built from), and `/localize/lane` is gone. The editor route therefore
> exists under **both** provenance prefixes rather than the queue one alone.
> Every section below reflects the amended design.

The editor **stays a modal** rendered over the mounted cockpit. Promoting it to
a standalone page was considered and deliberately rejected for now: the modal
keeps the cockpit mounted, so closing the editor preserves scroll position,
crop mode, active object and card size for free.

## Route

```
/localize/:sequenceId                                     cockpit, editor closed
/localize/:sequenceId/object/:laneId/:detectionId         cockpit, editor open
/localize/done/:sequenceId                                same, Done provenance
/localize/done/:sequenceId/object/:laneId/:detectionId    same, Done provenance
```

All four render `LocalizeAlertPage`; the object paths additionally render
`ImageModal` over it. Same component, same mount — navigating between a
cockpit path and its editor path is a param change, not a remount.

The prefix is provenance, exactly as `mode` already means elsewhere on the
page: an editor opened from the Done list keeps the `/localize/done` prefix and
closes back to the list it came from. `localizeObjectRoute(done)` builds the
pattern and `localizeObject(seq, lane, det, done)` builds the URL, mirroring
`localizeDetail`'s existing signature.

`:laneId` is the **lane's sequence id** (`lane.sequence.id`). This is what the
cockpit already keys everything on — `activeLaneId`, `detectionsByLaneId`,
`annotationsByLaneId`, `AlertFrameCell.laneSequenceId`, `objectStatus` — so no
new identifier plumbing is introduced. The human-facing display index
("Object 2") was rejected: it shifts when an object is added or when the
false-positive toggle changes which lanes are listed, so a shared link would
silently point at a different object. The sequence-annotation id was rejected
because a freshly added lane has no annotation row yet.

`:detectionId` is required. There is no frameless
`/localize/:sequenceId/object/:laneId` route — every entry point already knows
which frame it wants, and requiring the frame avoids a resolve-then-redirect
step.

### Declared as a nested route (not a sibling)

The editor path is declared as a **child route** of the cockpit's route, and
`LocalizeAlertPage` reads its params with `useMatch` rather than `useParams`:

```tsx
<Route path="/localize/:sequenceId" element={<RequireLocalize><LocalizeAlertPage /></RequireLocalize>}>
  <Route path={LOCALIZE_OBJECT_ROUTE} element={null} />
</Route>
```

`localizeObjectRoute(done)` returns the full pattern for that provenance — an
absolute child path, which React Router accepts because it starts with the
parent's. Each of the two parent routes declares its own child. The pattern is
built in one place because the route and the page's `useMatch` must read the
same string: if they drifted, `useMatch` would simply return null and the
editor would stop opening, with no error and nothing for a test mounting its
own route table to catch.

This is load-bearing, not stylistic. Two sibling `<Route>` entries rendering
`<LocalizeAlertPage />` occupy two different positions in the element tree, so
React Router unmounts and remounts the page on every open and close — losing
scroll position, crop mode, object-focus mode and the active object. That is
precisely the cost this design avoids by keeping the editor a modal. Today's
single route with an optional `:detectionId?` segment has the same property by
accident; the nested route makes it explicit.

The child route renders `element={null}` — it exists only so the URL matches
and so `useMatch` has a pattern to read. The parent renders no `<Outlet />`.

A test locks this in: entering and leaving the editor must preserve
object-focus mode in the cockpit behind it.

### Route table placement

The queue editor path has five segments and the Done one six, so neither
collides with the two-segment cockpit routes. The literal `done` segment
outranks the dynamic `:sequenceId` (React Router scores static above dynamic),
so `/localize/done/5` is never read as sequence id `done` — locked by
`routeMatching.test.ts`.

### URL builder

`src/utils/routes.ts` gains:

```ts
export function localizeObjectRoute(done?: boolean): string;
export function localizeObject(
  sequenceId: number | string,
  laneId: number | string,
  detectionId: number | string,
  done?: boolean
): string
```

returning `<prefix>/${sequenceId}/object/${laneId}/${detectionId}`. All
navigation to the editor goes through it.

### Relationship to `?frame=`

Unchanged and independent. The `?frame=<detectionId>` query param drives the
cockpit's scroll-and-highlight on a shared or reloaded link and never opens the
editor. It coexists with the path params exactly as it does today: every
path-only navigation within the page appends the current query string.

## Changes in `LocalizeAlertPage`

### Reading the params

`sequenceId` still comes from `useParams` (it belongs to the page's own
route). `laneId` and `detectionId` belong to the child route, so they come from
`useMatch('/localize/:sequenceId/object/:laneId/:detectionId')` — a parent's
`useParams` cannot see a child route's params.

### `modalContext`

Stops scanning every lane. It becomes a direct lookup:

1. Find the lane in `alertDetail.lanes` whose `sequence.id` matches `:laneId`.
   Not found → `null`.
2. Reject the lane if it has no annotation, or if `laneNeedsLocalization`
   returns false for it (false-positive and unsure lanes are never editable
   here — the existing rule at line 371).
3. Find `:detectionId` in **that lane's** detections. Not found → `null`.
4. Return `{ laneId, detection, existingAnnotation, smokeType }` as today.

`modalContext === null` means the editor stays closed and the cockpit renders
normally. Nothing else about the returned shape changes, so `handleModalSubmit`,
`objectOverlays`, `laneDetectionsSorted` and the smoke-type seeding effect are
unaffected.

### Opening

`handleCellClick(recordedAt, laneSequenceId, detId)` already receives the lane
from `AlertFrameGrid` and currently drops it when building the URL. It now
passes it to `localizeObject`. It keeps calling `setActiveLaneId` as it does
today.

### Closing and stepping

`closeModal` navigates to `/localize/:sequenceId` plus the current search
string, unchanged. `navigateModal` builds its target with `localizeObject`,
carrying the same lane. Prev/next still steps chronologically within the open
object's own lane — `laneDetectionsSorted` is unchanged.

### Activating the object from the URL

Arriving at an editor URL directly — paste, refresh, back button — sets
`activeLaneId` to `:laneId` if it is not already that value.

This is a deliberate behavior change. Today the lane is activated only by the
click that produced the URL, so a pasted editor URL opens the editor over a
cockpit that has no object selected. Now that the URL names the object, the
screen behind it should agree.

The effect is keyed on the resolved lane, and must not fight the existing
`useEffect` that clears `activeLaneId` when `sequenceIdNum` changes: the reset
runs on alert change, and this effect re-activates from the URL afterwards.

## Invalid URLs

The route asserts two facts that can now disagree, so the guards get stricter.
In every case below the editor stays closed and the cockpit renders normally —
no redirect, no error screen. The user sees the alert they asked for, without
an editor over it.

| URL condition | Behavior |
|---|---|
| `:laneId` is not a lane of this alert | Editor closed |
| The lane does not need localization (false positive / unsure) | Editor closed |
| `:detectionId` does not belong to the named lane | Editor closed |
| Data still loading | Editor closed until resolved, then opens |

The third row is the case that is impossible to detect today. Under the current
single-param route any valid detection id resolves to *some* lane, so a
mismatched URL silently edits whichever object owns the detection.

The first two rows preserve today's behavior for their equivalent situations.

## Legacy bare-frame URLs

`/localize/:sequenceId/:detectionId` and its `/localize/done/…` twin both
redirect to `<prefix>/:sequenceId?frame=:detectionId`: the user lands on the
alert with that frame scrolled into view and ring-highlighted, editor closed.

Both provenances need this. Before this change the page built its editor URLs
as `${basePath}/${detectionId}`, so **both** shapes were live and either could
be sitting in a bookmark or an open tab.

The same reasoning covers `LegacyLocalizeDetailRedirect`, which forwards
pre-#210 `/detections/:seq/annotate/:det` links: it used to hand the detection
id straight to `localizeDetail`, producing a URL that is now a dead end. It
emits the `?frame=` form instead, so those links resolve in one hop rather than
bouncing through a second redirect.

Resolving any of these all the way back to an open editor would require loading
the alert and every lane's detections before deciding where to redirect — the
object simply isn't derivable from the URL. Not worth it to reopen an editor
the user can reopen with one click on the highlighted frame.

Both redirects are declared alongside the other entries in
`src/components/routing/legacyRedirects.tsx`.

## Testing

Updated in `tests/pages/LocalizeAlertPage.test.tsx` — the existing tests that
assert on the editor URL or on opening behavior (cell click with and without an
active object, save-then-close, the `?frame=` deep link that must *not* open the
editor, and the false-positive read-only test) move to the new URL shape. Their
assertions are otherwise unchanged; this is a parity change.

New tests:

- Clicking a cell navigates to `/localize/:seq/object/:lane/:det` carrying the
  lane the grid reported.
- A direct editor URL opens the editor **and** makes that object active in the
  cockpit behind it.
- A URL whose `:detectionId` belongs to a different lane than `:laneId` leaves
  the editor closed.
- A URL naming a lane that is not in the alert leaves the editor closed.
- A URL naming a false-positive lane leaves the editor closed (moved to the new
  shape from the existing read-only test).
- Prev/next preserves the lane segment in the URL.
- Entering and leaving the editor preserves object-focus mode in the cockpit —
  the regression lock on the child-route (no-remount) decision.
- `/localize/:seq/:det` redirects to `/localize/:seq?frame=:det`, and the
  `/localize/done/…` twin to its own prefix.
- Under Done provenance: a cell click opens
  `/localize/done/:seq/object/:lane/:det`, and prev/next keeps that prefix.
- The route pattern and the URL builder agree, for both provenances — a drift
  fails silently in the app, so it is pinned in `routes.test.ts`.

Success criteria: `npm run quality` clean, and the full suite green, with no
test deleted rather than migrated.
