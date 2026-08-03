import { describe, expect, it } from 'vitest';
import { detectionReviewDefaultState } from '@/pages/DetectionReviewPage';

describe('verification (/localize/done) default filters', () => {
  it('uses the localization rule, not has_smoke', () => {
    const { filters } = detectionReviewDefaultState;
    expect(filters.needs_localization).toBe(true);
    expect('has_smoke' in filters && filters.has_smoke).toBeFalsy();
  });
});
