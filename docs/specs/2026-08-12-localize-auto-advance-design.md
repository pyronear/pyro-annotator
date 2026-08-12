# Auto-advance to the next queue alert after a Localize submit

**Date**: 2026-08-12
**Status**: Approved
**Base**: `main` (classify's own post-submit auto-advance #264, the alert-skip
escape hatch #297, and the collocated localize cockpit #274/#278 all merged).
**Scope**: frontend only. No API or schema change.

## Problem

`/classify/:id` flows continuously: submit an alert and the page pulls the next
one straight from the classify queue, so an annotator works a session without
ever returning to the table (`ClassifyAlertPage.tsx:857-917`).

`/localize/:sequenceId` does not. Both of its queue-mode exits dump the
annotator back on the list:

- Submit — `setTimeout(() => navigate(listPath), 1000)` (`LocalizeAlertPage.tsx:1216`)
- Skip alert — `navigate(listPath)` (`:1256`)

Every alert therefore costs a round trip through `/localize`: find your place
in the table again, click the next row. Localize is the slower of the two
passes, so the tax is paid on the more expensive work.

A second, smaller problem rides along: that `setTimeout` has no cleanup. Leave
the page inside its 1 s window and the timer still fires, navigating a user who
already went somewhere else.

## Decision

After a successful Submit (and after a Skip) in **queue mode**, fetch the
localize queue fresh and open the next alert, exactly as classify does.
"Next" is read from the queue listing the annotator was actually working — the
queue view travels from `/localize` into the detail URL as query params.

Done mode (`/localize/done/:sequenceId`) and the revert action are untouched:
they keep returning to their list.

## Design

### 1. The URL carries the queue view you came from

`DetectionAnnotatePage` holds its sort in component-local state
(`DetectionAnnotatePage.tsx:25-26`, default `temporal_model_score` / `desc`)
and its Skipped toggle likewise (`:21`). None of it survives the navigation
into the detail page today.

`handleAlertClick` appends that view to the target URL:

```
/localize/1234?order_by=recorded_at&order_direction=asc
/localize/1234?order_by=temporal_model_score&order_direction=desc&skipped=1
```

- `order_by` / `order_direction` are always emitted, even at the defaults: one
  code path, and the URL says what it is doing.
- `skipped=1` only in the Skipped backlog view.
- `page` is deliberately **not** carried — see §3.

`LocalizeAlertPage` already threads `location.search` through every internal
navigation (object selection `:1474`, editor `:1567`, back-out `:651`,
add-object `:636`), so the params survive object and editor navigation without
new plumbing.

Reading them back: parse against the `QueueOrderBy` union, and treat anything
missing or unrecognised as the queue page's own defaults
(`temporal_model_score` / `desc`, `skipped=false`). A deep link, a dashboard
link, or a hand-edited URL therefore behaves like a default-sorted queue entry
rather than sending a junk `order_by` to the API.

Framing: the params describe *which listing you were working*, and the advance
re-runs that same listing. Working the Skipped backlog keeps you in the
backlog.

### 2. The advance

One helper on `LocalizeAlertPage`, shared by both exits. Queue mode only —
`mode === 'done'` returns to `listPath` as today.

1. `apiClient.getLocalizationQueue({ page: 1, size: 5, skipped, order_by, order_direction })`
   — a direct call, not a cache read, so it reflects what other annotators have
   finished in the meantime.
2. Take the first item that is **not** the current alert and that yields a
   lane. Identity is `(source_api, platform_alert_id)`: `LocalizationQueueItem`
   has no `primary_sequence_id` (`types/api.ts:58-68`), unlike the classify
   queue item. The lane comes from `pickNextLocalizeLane(item.lanes, -1)`,
   the same picker the table's own row click uses
   (`DetectionAnnotatePage.tsx:83`).
3. `navigate(localizeDetail(laneSequenceId) + <queue params>)`. Only the queue
   params are carried; alert-scoped ones — `frame` (`LocalizeAlertPage.tsx:501`)
   above all — are dropped, since they mean nothing in the next alert.
4. No usable item, or the fetch throws → `navigate(listPath)`, exactly today's
   behaviour. The list's branded "Localization queue is clear" empty state is
   the end-of-queue message, so no extra toast is invented for it.

`size: 5` rather than classify's `2`: the exclusion is by alert identity, and
an item could in principle yield no workable lane, so the page gives itself a
few candidates instead of one.

**Submit** keeps the existing `Objects submitted` success toast and the 1 s
delay before navigating (the delay exists because navigating unmounts the page
and with it the `NotificationSystem` that owns the toast — see the comment at
`:1285-1287`), then advances with a `Moving to the next alert in the queue`
info toast, matching classify's wording (`ClassifyAlertPage.tsx:900`).

**Skip** advances immediately, no delay and no extra toast — matching
classify's skip path (`ClassifyAlertPage.tsx:949-969`).

### 3. What is deliberately not preserved

The advance always reads page 1 of the fresh listing. An annotator on page 4 of
the queue lands on the current top alert of their sort, not on row 5 of page 4.
Under the default score ordering that is the most valuable next alert anyway,
and pinning a page number would hand out stale rows as the queue drains. The
sort is the part of the view worth preserving; the offset is not.

### 4. Guards

Mirror classify's bookkeeping (`ClassifyAlertPage.tsx:206-218, 276-278`):

- `advanceTimerRef` — the pending submit timer, cleared on unmount and on
  `sequenceIdNum` change. This is the latent-bug fix: today's bare `setTimeout`
  at `:1216` and `:1288` has no cleanup at all.
- `advancingRef` — set when the advance starts, re-checked after the async
  queue fetch resolves, so a user who navigated away mid-flight is not yanked
  into an unrelated alert.

Classify additionally guards `advancingRef` against a second Enter re-submitting
inside the window (`ClassifyAlertPage.tsx:982`). Localize needs no such guard:
submit has no keyboard shortcut here — the only call sites are the rail button
(`LocalizeAlertPage.tsx:2091`) and the soft-confirm dialog's two buttons — and
`handleSubmitClick` already returns early while the mutation is pending
(`:1306`).

## Testing

A new `post-submit auto-advance` describe inside the existing
`tests/pages/LocalizeAlertPage.test.tsx`, not a separate file. Classify needed
its own `ClassifyAlertPage.autoAdvance.test.tsx` because its main suite mocks
`useNavigate`; this one already renders through a real `MemoryRouter` with an
unmocked `useNavigate` and real landing routes (`:212-262`), and owns the
fixtures a submit test needs (`mockAllFramesAccepted`, `renderAndSettle`).
Cases:

1. Successful submit navigates to the next queue alert's object route.
2. The queue call receives the URL's `order_by` / `order_direction` / `skipped`
   — asserted on the mocked `getLocalizationQueue` arguments, not inferred from
   the destination.
3. Missing or invalid params fall back to `temporal_model_score` / `desc`.
4. Empty queue (and a rejected queue fetch) → `/localize`.
5. Skip advances immediately.
6. Unmounting inside the 1 s window navigates nowhere.

Changed existing tests:

- `tests/pages/LocalizeAlertPage.test.tsx` mocks `getLocalizationQueue` with an
  empty page in its top-level `beforeEach`, so every pre-existing submit and
  skip test — `:1303` ("navigates back to the queue"), `:1524` (Done list),
  `:3549` (skip confirm) — keeps asserting the fallback rather than
  accidentally exercising the advance.
- `tests/components/dashboard/DetectionAnnotatePage.test.tsx:165` (row click)
  now expects the queue params on the URL, and gains cases for a re-sorted
  queue and for the Skipped backlog.

## Out of scope

- Done mode and the revert action — both keep returning to their list.
- Any table-position "workflow" store for localize (classify's
  `annotationWorkflow`). The fresh fetch replaces it.
- Backend changes: `GET /sequences/localization-queue` already takes
  `order_by` / `order_direction` / `skipped`.
