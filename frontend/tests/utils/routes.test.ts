import { ROUTES, classifyDetail, classifyGroup, localizeDetail } from '@/utils/routes';

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

  it('builds localize detail paths with optional detection id and provenance', () => {
    expect(localizeDetail(5)).toBe('/localize/5');
    expect(localizeDetail(5, 9)).toBe('/localize/5/9');
    expect(localizeDetail(5, undefined, true)).toBe('/localize/done/5');
    expect(localizeDetail(5, 9, true)).toBe('/localize/done/5/9');
  });
});
