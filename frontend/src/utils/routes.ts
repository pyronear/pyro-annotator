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
 * Both provenances land on the collocated LocalizeAlertPage — queue at
 * `/localize/:sequenceId`, Done list at `/localize/done/:sequenceId` — and
 * both routes accept the optional `:detectionId?` segment that deep-links
 * straight into that frame's editor.
 */
export function localizeDetail(
  sequenceId: number | string,
  detectionId?: number | string,
  done = false
): string {
  const base = done ? ROUTES.LOCALIZE_DONE : ROUTES.LOCALIZE;
  const detSegment = detectionId !== undefined ? `/${detectionId}` : '';
  return `${base}/${sequenceId}${detSegment}`;
}
