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

/**
 * Route pattern for the per-frame editor, declared once so App.tsx's route
 * and LocalizeAlertPage's `useMatch` can't drift apart. If they did, the
 * failure would be silent — `useMatch` would return null and the editor
 * would simply stop opening — so the two must read the same string.
 *
 * It is mounted as a CHILD of `/localize/:sequenceId` (an absolute child
 * path, which React Router accepts because it starts with the parent's),
 * keeping LocalizeAlertPage mounted when the editor opens and closes.
 */
export const LOCALIZE_OBJECT_ROUTE = `${ROUTES.LOCALIZE}/:sequenceId/object/:laneId/:detectionId`;

/**
 * The collocated alert page's per-frame editor, which names both the object
 * (`laneId` — the lane's own sequence id) and the frame. The lane segment is
 * what makes a shared editor link unambiguous: a detection id alone resolves
 * to whichever lane happens to own it, so a mismatched URL used to be
 * undetectable. The frame is always required — there is no frameless form.
 */
export function localizeObject(
  sequenceId: number | string,
  laneId: number | string,
  detectionId: number | string
): string {
  return `${ROUTES.LOCALIZE}/${sequenceId}/object/${laneId}/${detectionId}`;
}
