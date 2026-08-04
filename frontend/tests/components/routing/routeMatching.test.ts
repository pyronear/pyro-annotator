/**
 * Locks in React Router's static-over-dynamic segment ranking for the route
 * patterns App.tsx mounts (keep the list in sync with App.tsx). Guards the
 * spec claim that /classify/done, /classify/groups, /localize/done and
 * /localize/lane never fall through to the :id / :sequenceId routes.
 */
import { matchRoutes } from 'react-router-dom';
import { LOCALIZE_OBJECT_ROUTE } from '@/utils/routes';

const routes = [
  { path: '/classify' },
  { path: '/classify/done' },
  { path: '/classify/groups' },
  { path: '/classify/groups/:id' },
  { path: '/classify/done/:id' },
  { path: '/classify/:id' },
  { path: '/localize' },
  { path: '/localize/done' },
  { path: '/localize/done/:sequenceId/:detectionId?' },
  { path: '/localize/lane/:sequenceId/:detectionId?' },
  // The editor is an absolute-path CHILD of the alert page's route, exactly
  // as App.tsx declares it (both read LOCALIZE_OBJECT_ROUTE).
  { path: '/localize/:sequenceId', children: [{ path: LOCALIZE_OBJECT_ROUTE }] },
  { path: '/localize/:sequenceId/:detectionId' },
];

const matchedPath = (url: string): string | undefined => {
  const matches = matchRoutes(routes, url);
  return matches?.[matches.length - 1]?.route.path;
};

describe('taxonomy route matching precedence', () => {
  it.each([
    ['/classify', '/classify'],
    ['/classify/done', '/classify/done'],
    ['/classify/42', '/classify/:id'],
    ['/classify/done/42', '/classify/done/:id'],
    ['/classify/groups', '/classify/groups'],
    ['/classify/groups/7', '/classify/groups/:id'],
    ['/localize', '/localize'],
    ['/localize/done', '/localize/done'],
    // Bare /localize/:sequenceId is the collocated alert page.
    ['/localize/5', '/localize/:sequenceId'],
    // The per-frame editor names the object (lane sequence id) as well as the
    // frame, and is a CHILD of the alert page's route so the page stays
    // mounted when it opens and closes.
    ['/localize/5/object/7/9', LOCALIZE_OBJECT_ROUTE],
    // The legacy per-lane box-drawing page lives under the literal /lane
    // segment now, not directly under /localize/:sequenceId.
    ['/localize/lane/5', '/localize/lane/:sequenceId/:detectionId?'],
    ['/localize/lane/5/9', '/localize/lane/:sequenceId/:detectionId?'],
    ['/localize/done/5', '/localize/done/:sequenceId/:detectionId?'],
    ['/localize/done/5/9', '/localize/done/:sequenceId/:detectionId?'],
  ])('%s matches %s', (url, expected) => {
    expect(matchedPath(url)).toBe(expected);
  });

  it('the editor path resolves as a child of the alert page route, keeping the page mounted', () => {
    // Load-bearing: two SIBLING routes rendering LocalizeAlertPage would sit
    // at different positions in the element tree, so React Router would
    // remount the page on every editor open/close — losing scroll, crop mode,
    // focus mode and the active object.
    const matches = matchRoutes(routes, '/localize/5/object/7/9');
    expect(matches).toHaveLength(2);
    expect(matches?.[0].route.path).toBe('/localize/:sequenceId');
    expect(matches?.[1].route.path).toBe(LOCALIZE_OBJECT_ROUTE);
    expect(matches?.[1].params).toMatchObject({ sequenceId: '5', laneId: '7', detectionId: '9' });
  });

  it('the pre-object-route /localize/:seq/:det shape still matches its redirect route', () => {
    // Not shadowed by /localize/lane/... (which needs the literal "lane"
    // segment) and not left unmatched — it redirects to a ?frame= deep link.
    expect(matchedPath('/localize/5/9')).toBe('/localize/:sequenceId/:detectionId');
  });
});
