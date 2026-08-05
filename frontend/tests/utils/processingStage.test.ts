import { describe, it, expect } from 'vitest';
import {
  ALL_CLASSIFIED_STAGES,
  stageFilterIncludes,
  getStageFilterLabel,
  getProcessingStageLabel,
} from '@/utils/processingStage';

describe('ALL_CLASSIFIED_STAGES', () => {
  it('covers both classify exits', () => {
    expect(ALL_CLASSIFIED_STAGES).toEqual(['seq_annotation_done', 'annotated']);
  });
});

describe('stageFilterIncludes', () => {
  it('matches a single-stage filter by equality', () => {
    expect(stageFilterIncludes('annotated', 'annotated')).toBe(true);
    expect(stageFilterIncludes('seq_annotation_done', 'annotated')).toBe(false);
  });

  it('matches an array filter by membership', () => {
    expect(stageFilterIncludes(ALL_CLASSIFIED_STAGES, 'annotated')).toBe(true);
    expect(stageFilterIncludes(ALL_CLASSIFIED_STAGES, 'ready_to_annotate')).toBe(false);
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
    expect(getStageFilterLabel('seq_annotation_done')).toBe('Awaiting localization');
  });
});

describe('getProcessingStageLabel', () => {
  it('labels a parked lane as awaiting localization', () => {
    expect(getProcessingStageLabel('seq_annotation_done')).toBe('Awaiting localization');
  });

  it('labels an unsure parked lane as awaiting a decision', () => {
    expect(getProcessingStageLabel('seq_annotation_done', true)).toBe('Awaiting decision');
  });

  it('ignores the unsure flag on other stages', () => {
    expect(getProcessingStageLabel('annotated', true)).toBe('Fully annotated');
  });
});
