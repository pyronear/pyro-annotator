import { describe, it, expect } from 'vitest';
import {
  ALL_CLASSIFIED_STAGES,
  stageFilterIncludes,
  getStageFilterLabel,
} from '@/utils/processingStage';

describe('ALL_CLASSIFIED_STAGES', () => {
  it('covers both classify exits and the review stage, excluding needs_manual', () => {
    expect(ALL_CLASSIFIED_STAGES).toEqual(['seq_annotation_done', 'in_review', 'annotated']);
  });
});

describe('stageFilterIncludes', () => {
  it('matches a single-stage filter by equality', () => {
    expect(stageFilterIncludes('annotated', 'annotated')).toBe(true);
    expect(stageFilterIncludes('seq_annotation_done', 'annotated')).toBe(false);
  });

  it('matches an array filter by membership', () => {
    expect(stageFilterIncludes(ALL_CLASSIFIED_STAGES, 'annotated')).toBe(true);
    expect(stageFilterIncludes(ALL_CLASSIFIED_STAGES, 'needs_manual')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(stageFilterIncludes(undefined, 'annotated')).toBe(false);
  });
});

describe('getStageFilterLabel', () => {
  it('labels array filters as All classified', () => {
    expect(getStageFilterLabel(ALL_CLASSIFIED_STAGES)).toBe('All classified');
  });

  it('falls back to the single-stage label', () => {
    expect(getStageFilterLabel('seq_annotation_done')).toBe('Seq annotation done');
  });
});
