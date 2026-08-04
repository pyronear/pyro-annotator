/**
 * Locks in React Router's static-over-dynamic segment ranking for the route
 * patterns App.tsx mounts (keep the list in sync with App.tsx). Guards the
 * spec claim that /classify/done, /classify/groups and /localize/done never
 * fall through to the :id / :sequenceId routes.
 */
import { matchRoutes } from 'react-router-dom';
import { localizeObjectRoute } from '@/utils/routes';

const routes = [
  { path: '/classify' },
  { path: '/classify/done' },
  { path: '/classify/groups' },
  { path: '/classify/groups/:id' },
  { path: '/classify/done/:id' },
  { path: '/classify/:id' },
  { path: '/localize' },
  { path: '/localize/done' },
  // Both provenances render the alert page, and each carries the per-frame
  // editor as an absolute-path CHILD, exactly as App.tsx declares it (both
  // read localizeObjectRoute).
  { path: '/localize/done/:sequenceId', children: [{ path: localizeObjectRoute(true) }] },
  { path: '/localize/:sequenceId', children: [{ path: localizeObjectRoute() }] },
  // Pre-object-route editor shapes, now redirects to a ?frame= deep link.
  { path: '/localize/done/:sequenceId/:detectionId' },
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
    // Bare /localize/:sequenceId is the collocated alert page; the literal
    // "done" segment outranks it rather than being read as a sequence id.
    ['/localize/5', '/localize/:sequenceId'],
    ['/localize/done/5', '/localize/done/:sequenceId'],
    // The per-frame editor names the object (lane sequence id) as well as the
    // frame, under whichever provenance prefix it was entered from.
    ['/localize/5/object/7/9', localizeObjectRoute()],
    ['/localize/done/5/object/7/9', localizeObjectRoute(true)],
    // The pre-object-route shapes still resolve — to their redirect routes.
    ['/localize/5/9', '/localize/:sequenceId/:detectionId'],
    ['/localize/done/5/9', '/localize/done/:sequenceId/:detectionId'],
  ])('%s matches %s', (url, expected) => {
    expect(matchedPath(url)).toBe(expected);
  });

  it.each([
    ['queue', '/localize/5/object/7/9', '/localize/:sequenceId', false],
    ['done', '/localize/done/5/object/7/9', '/localize/done/:sequenceId', true],
  ])(
    'the %s editor path resolves as a child of the alert page route, keeping the page mounted',
    (_label, url, parentPath, done) => {
      // Load-bearing: two SIBLING routes rendering LocalizeAlertPage would sit
      // at different positions in the element tree, so React Router would
      // remount the page on every editor open/close — losing scroll, crop
      // mode, focus mode and the active object.
      const matches = matchRoutes(routes, url);
      expect(matches).toHaveLength(2);
      expect(matches?.[0].route.path).toBe(parentPath);
      expect(matches?.[1].route.path).toBe(localizeObjectRoute(done as boolean));
      expect(matches?.[1].params).toMatchObject({ sequenceId: '5', laneId: '7', detectionId: '9' });
    }
  );
});
