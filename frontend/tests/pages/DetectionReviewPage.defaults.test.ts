import { describe, expect, it } from 'vitest';
import { detectionReviewDefaultState } from '@/pages/DetectionReviewPage';

describe('verification (/localize/done) default filters', () => {
  it('carries only pagination — membership is server-side (localize-done-queue endpoint)', () => {
    const { filters } = detectionReviewDefaultState;
    expect(filters.page).toBe(1);
    expect(filters.size).toBe(50);
    // The old per-sequence gating fields no longer apply: the endpoint
    // already scopes to alerts with a localized, rule-matching lane.
    expect(filters.needs_localization).toBeUndefined();
    expect(filters.processing_stage).toBeUndefined();
    expect(filters.is_unsure).toBeUndefined();
    expect(filters.detection_annotation_completion).toBeUndefined();
    expect(filters.include_detection_stats).toBeUndefined();
  });
});
