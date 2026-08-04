import {
  ROUTES,
  classifyDetail,
  classifyDetailWithReturn,
  classifyGroup,
  localizeDetail,
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
});
