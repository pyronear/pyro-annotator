import { describe, it, expect } from 'vitest';
import {
  getClassificationType,
  hasUserAnnotations,
  initializeCleanBbox,
  shouldShowAsAnnotated,
  isAnnotationDataValid,
  getInitialMissedSmokeReview,
  createAnnotationPayload,
  updateBboxSmokeType,
  updateBboxFalsePositiveType,
  clearBboxSelections,
  getKeyForFalsePositiveType,
  formatFalsePositiveLabel,
  calculateAnnotationProgress
} from '@/utils/annotation/sequenceUtils';
import { SequenceBbox, SequenceAnnotation } from '@/types/api';

// Mock data helpers
const createMockBbox = (overrides: Partial<SequenceBbox> = {}): SequenceBbox => ({
  is_smoke: false,
  smoke_type: undefined,
  false_positive_types: [],
  bboxes: [],
  ...overrides
});

const createMockAnnotation = (overrides: Partial<SequenceAnnotation> = {}): SequenceAnnotation => ({
  id: 1,
  sequence_id: 123,
  has_smoke: false,
  has_false_positives: false,
  false_positive_types: "[]",
  smoke_types: [],
  has_missed_smoke: false,
  is_unsure: false,
  annotation: { sequences_bbox: [] },
  processing_stage: 'ready_to_annotate',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: null,
  ...overrides
});

describe('sequenceUtils', () => {
  describe('getClassificationType', () => {
    it('should return smoke when user explicitly chose smoke and bbox data matches', () => {
      const bbox = createMockBbox({ is_smoke: true });
      const primaryClassification = { 0: 'smoke' as const };
      
      expect(getClassificationType(bbox, 0, primaryClassification)).toBe('smoke');
    });

    it('should return false_positive when user explicitly chose false positive', () => {
      const bbox = createMockBbox();
      const primaryClassification = { 0: 'false_positive' as const };
      
      expect(getClassificationType(bbox, 0, primaryClassification)).toBe('false_positive');
    });

    it('should derive from existing data when user choice is unselected', () => {
      const smokeBbox = createMockBbox({ is_smoke: true });
      const fpBbox = createMockBbox({ false_positive_types: ['antenna'] });
      const emptyBbox = createMockBbox();
      
      expect(getClassificationType(smokeBbox, 0, {})).toBe('smoke');
      expect(getClassificationType(fpBbox, 0, {})).toBe('false_positive');
      expect(getClassificationType(emptyBbox, 0, {})).toBe('unselected');
    });

    it('should return unselected when user chose smoke but bbox data does not match', () => {
      const bbox = createMockBbox({ is_smoke: false });
      const primaryClassification = { 0: 'smoke' as const };
      
      expect(getClassificationType(bbox, 0, primaryClassification)).toBe('unselected');
    });
  });

  describe('hasUserAnnotations', () => {
    it('should return true for smoke bbox with smoke type', () => {
      const bbox = createMockBbox({ is_smoke: true, smoke_type: 'wildfire' });
      expect(hasUserAnnotations(bbox)).toBe(true);
    });

    it('should return false for smoke bbox without smoke type', () => {
      const bbox = createMockBbox({ is_smoke: true, smoke_type: undefined });
      expect(hasUserAnnotations(bbox)).toBe(false);
    });

    it('should return true for bbox with false positive types', () => {
      const bbox = createMockBbox({ false_positive_types: ['antenna'] });
      expect(hasUserAnnotations(bbox)).toBe(true);
    });

    it('should return false for bbox without any selections', () => {
      const bbox = createMockBbox();
      expect(hasUserAnnotations(bbox)).toBe(false);
    });
  });

  describe('initializeCleanBbox', () => {
    it('should reset bbox to clean state while preserving structure', () => {
      const originalBbox = createMockBbox({
        is_smoke: true,
        smoke_type: 'wildfire',
        false_positive_types: ['antenna', 'building'],
        bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }]
      });

      const cleanBbox = initializeCleanBbox(originalBbox);

      expect(cleanBbox.is_smoke).toBe(false);
      expect(cleanBbox.smoke_type).toBeUndefined();
      expect(cleanBbox.false_positive_types).toEqual([]);
      expect(cleanBbox.bboxes).toEqual([{ detection_id: 1, xyxyn: [0, 0, 1, 1] }]);
    });
  });

  describe('shouldShowAsAnnotated', () => {
    it('should return true for annotated processing stage regardless of user annotations', () => {
      const bbox = createMockBbox();
      expect(shouldShowAsAnnotated(bbox, 'annotated')).toBe(true);
    });

    it('should return true for ready_to_annotate only if user has made selections', () => {
      const annotatedBbox = createMockBbox({ is_smoke: true, smoke_type: 'wildfire' });
      const unannotatedBbox = createMockBbox();
      
      expect(shouldShowAsAnnotated(annotatedBbox, 'ready_to_annotate')).toBe(true);
      expect(shouldShowAsAnnotated(unannotatedBbox, 'ready_to_annotate')).toBe(false);
    });

    it('should check user annotations for other stages', () => {
      const annotatedBbox = createMockBbox({ is_smoke: true, smoke_type: 'wildfire' });
      const unannotatedBbox = createMockBbox();
      
      expect(shouldShowAsAnnotated(annotatedBbox, 'imported')).toBe(true);
      expect(shouldShowAsAnnotated(unannotatedBbox, 'imported')).toBe(false);
    });
  });

  describe('isAnnotationDataValid', () => {
    it('should return true when annotation matches sequence ID', () => {
      const annotation = createMockAnnotation({ sequence_id: 123 });
      expect(isAnnotationDataValid(annotation, 123)).toBe(true);
    });

    it('should return false when annotation does not match sequence ID', () => {
      const annotation = createMockAnnotation({ sequence_id: 123 });
      expect(isAnnotationDataValid(annotation, 456)).toBe(false);
    });

    it('should return false for null annotation or sequence ID', () => {
      const annotation = createMockAnnotation();
      expect(isAnnotationDataValid(null, 123)).toBe(false);
      expect(isAnnotationDataValid(annotation, null)).toBe(false);
    });
  });

  describe('getInitialMissedSmokeReview', () => {
    it('should return yes/no for annotated processing stage', () => {
      const annotatedWithMissed = createMockAnnotation({
        processing_stage: 'annotated',
        has_missed_smoke: true
      });
      const annotatedWithoutMissed = createMockAnnotation({
        processing_stage: 'annotated',
        has_missed_smoke: false
      });
      
      expect(getInitialMissedSmokeReview(annotatedWithMissed)).toBe('yes');
      expect(getInitialMissedSmokeReview(annotatedWithoutMissed)).toBe('no');
    });

    it('should return yes or null for other processing stages', () => {
      const readyWithMissed = createMockAnnotation({
        processing_stage: 'ready_to_annotate',
        has_missed_smoke: true
      });
      const readyWithoutMissed = createMockAnnotation({
        processing_stage: 'ready_to_annotate',
        has_missed_smoke: false
      });
      
      expect(getInitialMissedSmokeReview(readyWithMissed)).toBe('yes');
      expect(getInitialMissedSmokeReview(readyWithoutMissed)).toBe(null);
    });
  });

  describe('createAnnotationPayload', () => {
    it('should create proper payload for normal annotation', () => {
      const bboxes = [
        createMockBbox({ is_smoke: true, smoke_type: 'wildfire' }),
        createMockBbox({ false_positive_types: ['antenna'] })
      ];
      
      const payload = createAnnotationPayload(bboxes, false, true);
      
      expect(payload.processing_stage).toBe('annotated');
      expect(payload.has_smoke).toBe(true);
      expect(payload.has_false_positives).toBe(true);
      expect(payload.has_missed_smoke).toBe(true);
      expect(payload.is_unsure).toBe(false);
      expect(JSON.parse(payload.false_positive_types!)).toEqual(['antenna']);
    });

    it('should create proper payload for unsure annotation', () => {
      const bboxes = [
        createMockBbox({ is_smoke: true, smoke_type: 'wildfire' }),
        createMockBbox({ false_positive_types: ['antenna'] })
      ];
      
      const payload = createAnnotationPayload(bboxes, true, true);
      
      expect(payload.has_smoke).toBe(false);
      expect(payload.has_false_positives).toBe(false);
      expect(payload.has_missed_smoke).toBe(false);
      expect(payload.is_unsure).toBe(true);
      expect(payload.false_positive_types).toBe("[]");
    });
  });

  describe('updateBboxSmokeType', () => {
    it('should set smoke type and clear false positives', () => {
      const bbox = createMockBbox({ false_positive_types: ['antenna'] });
      const updated = updateBboxSmokeType(bbox, 'wildfire');
      
      expect(updated.is_smoke).toBe(true);
      expect(updated.smoke_type).toBe('wildfire');
      expect(updated.false_positive_types).toEqual([]);
    });
  });

  describe('updateBboxFalsePositiveType', () => {
    it('should add false positive type and clear smoke', () => {
      const bbox = createMockBbox({ is_smoke: true, smoke_type: 'wildfire' });
      const updated = updateBboxFalsePositiveType(bbox, 'antenna', true);
      
      expect(updated.is_smoke).toBe(false);
      expect(updated.smoke_type).toBeUndefined();
      expect(updated.false_positive_types).toEqual(['antenna']);
    });

    it('should remove false positive type when unselected', () => {
      const bbox = createMockBbox({ false_positive_types: ['antenna', 'building'] });
      const updated = updateBboxFalsePositiveType(bbox, 'antenna', false);
      
      expect(updated.false_positive_types).toEqual(['building']);
    });
  });

  describe('clearBboxSelections', () => {
    it('should clear all selections from bbox', () => {
      const bbox = createMockBbox({
        is_smoke: true,
        smoke_type: 'wildfire',
        false_positive_types: ['antenna']
      });
      
      const cleared = clearBboxSelections(bbox);
      
      expect(cleared.is_smoke).toBe(false);
      expect(cleared.smoke_type).toBeUndefined();
      expect(cleared.false_positive_types).toEqual([]);
    });
  });

  describe('getKeyForFalsePositiveType', () => {
    it('should return correct keyboard shortcuts for false positive types', () => {
      expect(getKeyForFalsePositiveType('antenna')).toBe('A');
      expect(getKeyForFalsePositiveType('building')).toBe('B');
      expect(getKeyForFalsePositiveType('water_body')).toBe('W');
      expect(getKeyForFalsePositiveType('unknown_type')).toBe('');
    });
  });

  describe('formatFalsePositiveLabel', () => {
    it('should format false positive types for display', () => {
      expect(formatFalsePositiveLabel('antenna')).toBe('Antenna');
      expect(formatFalsePositiveLabel('water_body')).toBe('Water Body');
      expect(formatFalsePositiveLabel('lens_flare')).toBe('Lens Flare');
    });
  });

  describe('calculateAnnotationProgress', () => {
    it('should calculate progress statistics correctly', () => {
      const bboxes = [
        createMockBbox({ is_smoke: true, smoke_type: 'wildfire' }),
        createMockBbox({ false_positive_types: ['antenna'] }),
        createMockBbox(), // unannotated
        createMockBbox({ is_smoke: true, smoke_type: 'industrial' })
      ];
      
      const progress = calculateAnnotationProgress(bboxes);
      
      expect(progress.totalBboxes).toBe(4);
      expect(progress.annotatedBboxes).toBe(3);
      expect(progress.smokeBboxes).toBe(2);
      expect(progress.falsePositiveBboxes).toBe(1);
      expect(progress.unannotatedBboxes).toBe(1);
      expect(progress.completionPercentage).toBe(75);
      expect(progress.isComplete).toBe(false);
    });

    it('should handle empty bbox array', () => {
      const progress = calculateAnnotationProgress([]);
      
      expect(progress.totalBboxes).toBe(0);
      expect(progress.completionPercentage).toBe(0);
      expect(progress.isComplete).toBe(false);
    });

    it('should mark as complete when all bboxes are annotated', () => {
      const bboxes = [
        createMockBbox({ is_smoke: true, smoke_type: 'wildfire' }),
        createMockBbox({ false_positive_types: ['antenna'] })
      ];
      
      const progress = calculateAnnotationProgress(bboxes);
      
      expect(progress.isComplete).toBe(true);
      expect(progress.completionPercentage).toBe(100);
    });
  });
});