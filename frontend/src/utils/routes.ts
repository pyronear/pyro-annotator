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

/**
 * Route pattern for the per-frame editor, under whichever provenance prefix
 * the page was entered from. Declared once so App.tsx's route and
 * LocalizeAlertPage's `useMatch` can't drift apart: if they did, the failure
 * would be silent — `useMatch` would return null and the editor would simply
 * stop opening — so the two must read the same string.
 *
 * It is mounted as a CHILD of the alert page's own route (an absolute child
 * path, which React Router accepts because it starts with the parent's),
 * keeping LocalizeAlertPage mounted when the editor opens and closes. A
 * sibling route would sit elsewhere in the element tree and remount the page,
 * losing scroll position, crop mode, focus mode and the active object.
 */
export function localizeObjectRoute(done = false): string {
  const base = done ? ROUTES.LOCALIZE_DONE : ROUTES.LOCALIZE;
  return `${base}/:sequenceId/object/:laneId/:detectionId`;
}

/**
 * The collocated alert page's per-frame editor, which names both the object
 * (`laneId` — the lane's own sequence id) and the frame. The lane segment is
 * what makes a shared editor link unambiguous: a detection id alone resolves
 * to whichever lane happens to own it, so a mismatched URL used to be
 * undetectable. The frame is always required — there is no frameless form.
 *
 * `done` carries the same provenance as `localizeDetail`, so an editor opened
 * from the Done list keeps its `/localize/done` prefix and closes back to the
 * list it came from.
 */
export function localizeObject(
  sequenceId: number | string,
  laneId: number | string,
  detectionId: number | string,
  done = false
): string {
  const base = done ? ROUTES.LOCALIZE_DONE : ROUTES.LOCALIZE;
  return `${base}/${sequenceId}/object/${laneId}/${detectionId}`;
}
