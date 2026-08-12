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
 * internal localize *alert* path is accepted — `/localize/<id>` or its done
 * counterpart `/localize/done/<id>`, either optionally carrying an
 * `/object/<laneId>` selection segment and/or a query string. A
 * protocol-relative `//host` or an absolute URL would leave the app, and
 * other internal paths aren't this param's business; anything else yields
 * null and the caller falls back to its default.
 */
export function parseLocalizeReturn(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\/localize\/(done\/)?\d+(\/object\/\d+)?(\?[^#]*)?$/.test(value) ? value : null;
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
 * Route pattern for the cockpit's SELECTED object — the editor route minus
 * its frame segment. Like `localizeObjectRoute` it is declared once and read
 * by both App.tsx's route and LocalizeAlertPage's `useMatch`, and mounted as
 * an absolute CHILD path of the alert page's route so selection changes never
 * remount the page. See
 * docs/specs/2026-08-05-localize-object-selection-routes-design.md.
 */
export function localizeObjectSelectRoute(done = false): string {
  const base = done ? ROUTES.LOCALIZE_DONE : ROUTES.LOCALIZE;
  return `${base}/:sequenceId/object/:laneId`;
}

/**
 * Concrete selection path: this alert with this object active in the cockpit.
 * `done` carries provenance exactly as `localizeDetail` does.
 */
export function localizeObjectSelect(
  sequenceId: number | string,
  laneId: number | string,
  done = false
): string {
  const base = done ? ROUTES.LOCALIZE_DONE : ROUTES.LOCALIZE;
  return `${base}/${sequenceId}/object/${laneId}`;
}

/**
 * Route pattern for the add-object screen. Queue prefix only: adding a missed
 * object to an alert that has already been submitted would change a finished
 * record, so the done page does not offer it — and a pasted
 * `/localize/done/…/add-object` therefore matches nothing and simply leaves
 * the cockpit as it is.
 *
 * Mounted as an absolute CHILD of the alert page's route for the same reason
 * the editor is: a sibling would remount the page on every open and close,
 * losing scroll, crop mode, focus mode and the active object.
 *
 * Only the fact that the screen is OPEN lives in the URL. The range, the box
 * and the smoke type stay local, exactly as the editor keeps its peeked frame
 * and zoom local: they are a gesture in progress, not a place — nothing about
 * a half-drawn box survives being pasted to a colleague.
 */
export function localizeAddObjectRoute(): string {
  return `${ROUTES.LOCALIZE}/:sequenceId/add-object`;
}

/** Concrete add-object path for one alert. */
export function localizeAddObject(sequenceId: number | string): string {
  return `${ROUTES.LOCALIZE}/${sequenceId}/add-object`;
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
