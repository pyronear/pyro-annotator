/**
 * Locks in React Router's static-over-dynamic segment ranking for the route
 * patterns App.tsx mounts (keep the list in sync with App.tsx). Guards the
 * spec claim that /classify/done, /classify/groups and /localize/done never
 * fall through to the :id / :sequenceId routes.
 */
import { matchRoutes } from 'react-router-dom';

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
  { path: '/localize/:sequenceId/:detectionId?' },
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
    // Bare /localize/:sequenceId is the collocated alert page. It also
    // accepts an optional :detectionId? segment for deep-linked edits.
    ['/localize/5', '/localize/:sequenceId/:detectionId?'],
    ['/localize/done/5', '/localize/done/:sequenceId/:detectionId?'],
    ['/localize/done/5/9', '/localize/done/:sequenceId/:detectionId?'],
  ])('%s matches %s', (url, expected) => {
    expect(matchedPath(url)).toBe(expected);
  });

  it('a 3-segment /localize/:id/:id path (no /done) matches the collocated alert page, not nothing', () => {
    // The alert page's own route carries an optional :detectionId? segment
    // for deep-linked edits, so this resolves rather than being left
    // unmatched.
    expect(matchedPath('/localize/5/9')).toBe('/localize/:sequenceId/:detectionId?');
  });
});
