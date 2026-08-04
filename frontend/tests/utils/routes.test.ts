import { matchPath } from 'react-router-dom';
import {
  ROUTES,
  classifyDetail,
  classifyGroup,
  localizeDetail,
  localizeObject,
  localizeObjectRoute,
} from '@/utils/routes';

describe('routes', () => {
  it('exposes the taxonomy path constants', () => {
    expect(ROUTES.CLASSIFY).toBe('/classify');
    expect(ROUTES.CLASSIFY_DONE).toBe('/classify/done');
    expect(ROUTES.CLASSIFY_GROUPS).toBe('/classify/groups');
    expect(ROUTES.LOCALIZE).toBe('/localize');
    expect(ROUTES.LOCALIZE_DONE).toBe('/localize/done');
  });

  it('builds classify detail paths for queue and done provenance', () => {
    expect(classifyDetail(42)).toBe('/classify/42');
    expect(classifyDetail(42, true)).toBe('/classify/done/42');
  });

  it('builds classify group paths', () => {
    expect(classifyGroup(7)).toBe('/classify/groups/7');
  });

  // Both provenances land on the collocated alert page, and both carry the
  // optional detection segment that deep-links into that frame's editor.
  it('builds localize detail paths for queue and done provenance, with an optional detection id', () => {
    expect(localizeDetail(5)).toBe('/localize/5');
    expect(localizeDetail(5, 9)).toBe('/localize/5/9');
    expect(localizeDetail(5, undefined, true)).toBe('/localize/done/5');
    expect(localizeDetail(5, 9, true)).toBe('/localize/done/5/9');
  });

  it('builds the per-frame editor path naming both the object and the frame', () => {
    expect(localizeObject(5, 7, 9)).toBe('/localize/5/object/7/9');
    expect(localizeObject('5', '7', '9')).toBe('/localize/5/object/7/9');
  });

  it('keeps the editor under the Done prefix when that is where it was entered from', () => {
    expect(localizeObject(5, 7, 9, true)).toBe('/localize/done/5/object/7/9');
    expect(localizeObjectRoute(true)).toBe('/localize/done/:sequenceId/object/:laneId/:detectionId');
  });

  it.each([[false], [true]])(
    'keeps the editor route pattern and its builder in agreement (done=%s)',
    done => {
      // App.tsx's route and LocalizeAlertPage's useMatch both read the
      // pattern; the builder produces the URLs that have to match it. A drift
      // between them fails silently in the app (useMatch just returns null,
      // so the editor stops opening with no error), so pin it.
      expect(matchPath(localizeObjectRoute(done), localizeObject(5, 7, 9, done))?.params).toEqual({
        sequenceId: '5',
        laneId: '7',
        detectionId: '9',
      });
    }
  );
});
