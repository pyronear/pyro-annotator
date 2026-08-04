import {
  ROUTES,
  classifyDetail,
  classifyDetailWithReturn,
  classifyGroup,
  localizeDetail,
  localizeLane,
  parseLocalizeReturn,
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
    expect(parseLocalizeReturn(null)).toBeNull();
    expect(parseLocalizeReturn(undefined)).toBeNull();
    expect(parseLocalizeReturn('')).toBeNull();
    // Protocol-relative and absolute URLs must never be navigated to.
    expect(parseLocalizeReturn('//evil.example.com')).toBeNull();
    expect(parseLocalizeReturn('https://evil.example.com/localize/1')).toBeNull();
    // Other internal paths are not this param's business.
    expect(parseLocalizeReturn('/classify/101')).toBeNull();
    expect(parseLocalizeReturn('/localize/done/101')).toBeNull();
    expect(parseLocalizeReturn('/localize/lane/101')).toBeNull();
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
});
