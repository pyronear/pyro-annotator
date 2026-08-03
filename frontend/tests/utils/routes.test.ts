import { ROUTES, classifyDetail, classifyGroup, localizeDetail, localizeLane } from '@/utils/routes';

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
});
