import { matchPath } from 'react-router-dom';
import {
  ROUTES,
  classifyDetail,
  classifyDetailWithReturn,
  classifyGroup,
  localizeDetail,
  localizeObject,
  localizeObjectRoute,
  localizeObjectSelect,
  localizeObjectSelectRoute,
  parseLocalizeReturn,
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

  it('builds a classify done path carrying an encoded return target', () => {
    expect(classifyDetailWithReturn(42, '/localize/101')).toBe(
      '/classify/done/42?return=%2Flocalize%2F101'
    );
    expect(classifyDetailWithReturn(42, '/localize/101?frame=1001')).toBe(
      '/classify/done/42?return=%2Flocalize%2F101%3Fframe%3D1001'
    );
  });

  it('accepts only an internal localize alert path as a return target', () => {
    expect(parseLocalizeReturn('/localize/101')).toBe('/localize/101');
    expect(parseLocalizeReturn('/localize/101?frame=1001')).toBe('/localize/101?frame=1001');
    // Both provenances render the alert page, so both are valid origins to
    // return to — a reclassify started from the Done list goes back there.
    expect(parseLocalizeReturn('/localize/done/101')).toBe('/localize/done/101');
    expect(parseLocalizeReturn('/localize/done/101?frame=1001')).toBe(
      '/localize/done/101?frame=1001'
    );
    expect(parseLocalizeReturn(null)).toBeNull();
    expect(parseLocalizeReturn(undefined)).toBeNull();
    expect(parseLocalizeReturn('')).toBeNull();
    // Protocol-relative and absolute URLs must never be navigated to.
    expect(parseLocalizeReturn('//evil.example.com')).toBeNull();
    expect(parseLocalizeReturn('https://evil.example.com/localize/1')).toBeNull();
    // Other internal paths are not this param's business.
    expect(parseLocalizeReturn('/classify/101')).toBeNull();
    expect(parseLocalizeReturn('/localize')).toBeNull();
    expect(parseLocalizeReturn('/localize/bogus/101')).toBeNull();
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

  it('localizeObjectSelectRoute yields the selection child-route pattern per provenance', () => {
    expect(localizeObjectSelectRoute()).toBe('/localize/:sequenceId/object/:laneId');
    expect(localizeObjectSelectRoute(true)).toBe('/localize/done/:sequenceId/object/:laneId');
  });

  it('builds a concrete selection path per provenance', () => {
    expect(localizeObjectSelect(101, 102)).toBe('/localize/101/object/102');
    expect(localizeObjectSelect(101, 102, true)).toBe('/localize/done/101/object/102');
  });

  it('accepts selection URLs as return targets, with or without a query', () => {
    expect(parseLocalizeReturn('/localize/101/object/102')).toBe('/localize/101/object/102');
    expect(parseLocalizeReturn('/localize/done/101/object/102?frame=1001')).toBe(
      '/localize/done/101/object/102?frame=1001'
    );
  });

  it('still rejects editor URLs and malformed object segments as return targets', () => {
    expect(parseLocalizeReturn('/localize/101/object/102/1001')).toBeNull();
    expect(parseLocalizeReturn('/localize/101/object/')).toBeNull();
    expect(parseLocalizeReturn('/localize/101/object/abc')).toBeNull();
    expect(parseLocalizeReturn('//evil.example/localize/101/object/102')).toBeNull();
  });

  it.each([[false], [true]])(
    'keeps the selection route pattern and its builder in agreement (done=%s)',
    done => {
      expect(
        matchPath(localizeObjectSelectRoute(done), localizeObjectSelect(5, 7, done))?.params
      ).toEqual({ sequenceId: '5', laneId: '7' });
    }
  );

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
