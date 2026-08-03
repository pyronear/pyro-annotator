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
 * LocalizeAlertPage at `/localize/:sequenceId`, which has no detection
 * segment — any `detectionId` is ignored there. Done provenance still
 * targets the legacy per-lane page at `/localize/done/:sequenceId/:detectionId?`.
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
