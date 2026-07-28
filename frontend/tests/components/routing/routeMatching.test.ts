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
    ['/localize/5', '/localize/:sequenceId/:detectionId?'],
    ['/localize/5/9', '/localize/:sequenceId/:detectionId?'],
    ['/localize/done/5', '/localize/done/:sequenceId/:detectionId?'],
    ['/localize/done/5/9', '/localize/done/:sequenceId/:detectionId?'],
  ])('%s matches %s', (url, expected) => {
    expect(matchedPath(url)).toBe(expected);
  });
});
