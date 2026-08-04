import { matchPath } from 'react-router-dom';
import {
  LOCALIZE_OBJECT_ROUTE,
  ROUTES,
  classifyDetail,
  classifyGroup,
  localizeDetail,
  localizeLane,
  localizeObject,
} from '@/utils/routes';

describe('routes', () => {
  it('exposes the taxonomy path constants', () => {
    expect(ROUTES.CLASSIFY).toBe('/classify');
    expect(ROUTES.CLASSIFY_DONE).toBe('/classify/done');
    expect(ROUTES.CLASSIFY_GROUPS).toBe('/classify/groups');
    expect(ROUTES.LOCALIZE).toBe('/localize');
    expect(ROUTES.LOCALIZE_DONE).toBe('/localize/done');
    expect(ROUTES.LOCALIZE_LANE).toBe('/localize/lane');
  });

  it('builds classify detail paths for queue and done provenance', () => {
    expect(classifyDetail(42)).toBe('/classify/42');
    expect(classifyDetail(42, true)).toBe('/classify/done/42');
  });

  it('builds classify group paths', () => {
    expect(classifyGroup(7)).toBe('/classify/groups/7');
  });

  it('builds localize detail paths: queue provenance always targets the alert page (no detection segment), done provenance keeps the legacy per-lane path', () => {
    expect(localizeDetail(5)).toBe('/localize/5');
    expect(localizeDetail(5, 9)).toBe('/localize/5');
    expect(localizeDetail(5, undefined, true)).toBe('/localize/done/5');
    expect(localizeDetail(5, 9, true)).toBe('/localize/done/5/9');
  });

  it('builds legacy lane paths with an optional detection id', () => {
    expect(localizeLane(5)).toBe('/localize/lane/5');
    expect(localizeLane(5, 9)).toBe('/localize/lane/5/9');
  });

  it('builds the per-frame editor path naming both the object and the frame', () => {
    expect(localizeObject(5, 7, 9)).toBe('/localize/5/object/7/9');
    expect(localizeObject('5', '7', '9')).toBe('/localize/5/object/7/9');
  });

  it('keeps the editor route pattern and its builder in agreement', () => {
    // App.tsx's route and LocalizeAlertPage's useMatch both read the pattern;
    // the builder produces the URLs that have to match it. A drift between
    // them fails silently in the app (useMatch just returns null), so pin it.
    expect(LOCALIZE_OBJECT_ROUTE).toBe('/localize/:sequenceId/object/:laneId/:detectionId');
    expect(matchPath(LOCALIZE_OBJECT_ROUTE, localizeObject(5, 7, 9))?.params).toEqual({
      sequenceId: '5',
      laneId: '7',
      detectionId: '9',
    });
  });
});
