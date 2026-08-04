/* eslint-disable react-refresh/only-export-components -- route-element table:
   redirect helpers never need hot refresh */
import { ReactElement } from 'react';
import { Navigate, Route, useParams, useSearchParams } from 'react-router-dom';
import { ROUTES, classifyDetail, classifyGroup, localizeDetail } from '@/utils/routes';

/**
 * Redirects from the pre-#210 entity-named routes to the task-taxonomy routes.
 * Old URLs (bookmarks, external links) keep working indefinitely. The old
 * `?from=` provenance query translates into the path (`/done` segment).
 */

function LegacyClassifyDetailRedirect() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  return <Navigate to={classifyDetail(id!, searchParams.get('from') === 'review')} replace />;
}

function LegacyGroupDetailRedirect() {
  const { id } = useParams();
  return <Navigate to={classifyGroup(id!)} replace />;
}

/**
 * The alert page's own URLs no longer carry a bare detection id — the editor
 * names its object too (`…/object/:laneId/:detectionId`) — and that object
 * can't be resolved here without loading the alert and every lane's
 * detections. So a link that asked for a frame lands on the alert with that
 * frame scrolled into view and highlighted, editor closed: the `?frame=`
 * deep link the alert page already understands.
 */
function frameDeepLink(sequenceId: string, detectionId: string | undefined, done: boolean): string {
  const base = localizeDetail(sequenceId, undefined, done);
  return detectionId === undefined ? base : `${base}?frame=${detectionId}`;
}

function LegacyLocalizeDetailRedirect() {
  const { sequenceId, detectionId } = useParams();
  const [searchParams] = useSearchParams();
  const done = searchParams.get('from') === 'detections-review';
  // Both provenances land on the collocated alert page now that it serves
  // them; a detection id in the old link becomes a `?frame=` deep link.
  return <Navigate to={frameDeepLink(sequenceId!, detectionId, done)} replace />;
}

/**
 * Pre-object-route editor links: `/localize/:sequenceId/:detectionId` and its
 * `/localize/done/…` twin opened the per-frame editor back when the URL named
 * only the frame. Both provenances need this — the Done route produced that
 * shape too, right up until the object segment landed.
 */
function LegacyLocalizeFrameRedirect({ done = false }: { done?: boolean }) {
  const { sequenceId, detectionId } = useParams();
  return <Navigate to={frameDeepLink(sequenceId!, detectionId, done)} replace />;
}

export const legacyRedirectRoutes: ReactElement[] = [
  <Route
    key="/sequences/annotate"
    path="/sequences/annotate"
    element={<Navigate to={ROUTES.CLASSIFY} replace />}
  />,
  <Route
    key="/sequences/review"
    path="/sequences/review"
    element={<Navigate to={ROUTES.CLASSIFY_DONE} replace />}
  />,
  <Route
    key="/sequences/:id/annotate"
    path="/sequences/:id/annotate"
    element={<LegacyClassifyDetailRedirect />}
  />,
  <Route
    key="/sequence-groups"
    path="/sequence-groups"
    element={<Navigate to={ROUTES.CLASSIFY_GROUPS} replace />}
  />,
  <Route
    key="/sequence-groups/:id/annotate"
    path="/sequence-groups/:id/annotate"
    element={<LegacyGroupDetailRedirect />}
  />,
  <Route
    key="/detections/annotate"
    path="/detections/annotate"
    element={<Navigate to={ROUTES.LOCALIZE} replace />}
  />,
  <Route
    key="/detections/review"
    path="/detections/review"
    element={<Navigate to={ROUTES.LOCALIZE_DONE} replace />}
  />,
  <Route
    key="/detections/:sequenceId/annotate/:detectionId?"
    path="/detections/:sequenceId/annotate/:detectionId?"
    element={<LegacyLocalizeDetailRedirect />}
  />,
  <Route
    key="/localize/done/:sequenceId/:detectionId"
    path="/localize/done/:sequenceId/:detectionId"
    element={<LegacyLocalizeFrameRedirect done />}
  />,
  <Route
    key="/localize/:sequenceId/:detectionId"
    path="/localize/:sequenceId/:detectionId"
    element={<LegacyLocalizeFrameRedirect />}
  />,
];
