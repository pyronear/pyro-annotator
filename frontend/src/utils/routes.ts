/**
 * Frontend route paths for the task taxonomy (Classify / Localize).
 * Detail pages encode provenance in the path: /classify/:id was entered from
 * the queue, /classify/done/:id from the Done list (same component, done mode).
 */
export const ROUTES = {
  CLASSIFY: '/classify',
  CLASSIFY_DONE: '/classify/done',
  CLASSIFY_GROUPS: '/classify/groups',
  LOCALIZE: '/localize',
  LOCALIZE_DONE: '/localize/done',
  // The legacy per-lane box-drawing page (formerly at /localize/:sequenceId
  // itself) — /localize/:sequenceId now renders the collocated
  // LocalizeAlertPage instead.
  LOCALIZE_LANE: '/localize/lane',
} as const;

export function classifyDetail(id: number | string, done = false): string {
  return done ? `${ROUTES.CLASSIFY_DONE}/${id}` : `${ROUTES.CLASSIFY}/${id}`;
}

/**
 * `/classify/done/:id` plus a `return` param naming where to come back to.
 * Used by the Localize screen's per-object Reclassify action, so the trip out
 * to classify returns to the localize page it started from — see
 * docs/specs/2026-08-04-localize-reclassify-object-design.md.
 */
export function classifyDetailWithReturn(id: number | string, returnTo: string): string {
  return `${classifyDetail(id, true)}?return=${encodeURIComponent(returnTo)}`;
}

/**
 * Validates a `return` param before anything navigates to it. Only an
 * internal localize *alert* path (`/localize/<id>`, optionally with a query
 * string) is accepted: a protocol-relative `//host` or an absolute URL would
 * leave the app, and other internal paths aren't this param's business.
 * Anything else yields null, and the caller falls back to its default.
 */
export function parseLocalizeReturn(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\/localize\/\d+(\?[^#]*)?$/.test(value) ? value : null;
}

export function classifyGroup(id: number | string): string {
  return `${ROUTES.CLASSIFY_GROUPS}/${id}`;
}

export type SequenceGroupsFilter = 'unlabeled' | 'labeled' | 'all';

// Bare path is the To-label default; other filters are path segments.
export function classifyGroups(filter: SequenceGroupsFilter): string {
  return filter === 'unlabeled' ? ROUTES.CLASSIFY_GROUPS : `${ROUTES.CLASSIFY_GROUPS}/${filter}`;
}

/**
 * Queue provenance (`done = false`) always lands on the collocated
 * LocalizeAlertPage, whose route accepts an optional `:detectionId?` segment
 * for deep-linked edits — this builder omits it because no queue caller
 * passes one. Done provenance still targets the legacy per-lane page at
 * `/localize/done/:sequenceId/:detectionId?`.
 */
export function localizeDetail(
  sequenceId: number | string,
  detectionId?: number | string,
  done = false
): string {
  if (!done) return `${ROUTES.LOCALIZE}/${sequenceId}`;
  const detSegment = detectionId !== undefined ? `/${detectionId}` : '';
  return `${ROUTES.LOCALIZE_DONE}/${sequenceId}${detSegment}`;
}

/** The legacy per-lane box-drawing page, entered from within the alert page or the done list's internal navigation. */
export function localizeLane(sequenceId: number | string, detectionId?: number | string): string {
  const detSegment = detectionId !== undefined ? `/${detectionId}` : '';
  return `${ROUTES.LOCALIZE_LANE}/${sequenceId}${detSegment}`;
}
