/**
 * Unit tests for progress utilities.
 * These tests verify annotation progress calculations and validation.
 */

import { describe, it, expect } from 'vitest';
import {
  getAnnotationProgress,
  calculateCompletionPercentage,
  formatRemainingMessage,
  isAnnotationComplete,
  getAnnotationValidationErrors,
  formatProgressDisplay,
  getProgressColor,
  AnnotationProgress
} from '@/utils/annotation/progressUtils';
import { SequenceBbox, SmokeType, FalsePositiveType } from '@/types/api';

// Mock SequenceBbox data for testing
const createMockBbox = (isSmoke: boolean, smokeType?: SmokeType, falsePositiveTypes: FalsePositiveType[] = []): SequenceBbox => ({
  id: Math.random(),
  xyxyn: [0.1, 0.2, 0.8, 0.9],
  is_smoke: isSmoke,
  smoke_type: smokeType,
  false_positive_types: falsePositiveTypes,
  bboxes: []
});

describe('progressUtils', () => {
  describe('getAnnotationProgress', () => {
    it('should calculate progress for empty bbox array', () => {
      const progress = getAnnotationProgress([]);
      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(0);
      expect(progress.percentage).toBe(100);
      expect(progress.remaining).toBe(0);
      expect(progress.isComplete).toBe(false);
      // Legacy interface
      expect(progress.totalBboxes).toBe(0);
      expect(progress.annotatedBboxes).toBe(0);
      expect(progress.smokeBboxes).toBe(0);
      expect(progress.falsePositiveBboxes).toBe(0);
      expect(progress.unannotatedBboxes).toBe(0);
      expect(progress.completionPercentage).toBe(100);
    });

    it('should calculate progress for all annotated bboxes', () => {
      const bboxes = [
        createMockBbox(true, 'wildfire'),
        createMockBbox(false, undefined, ['building']),
        createMockBbox(true, 'industrial')
      ];
      
      const progress = getAnnotationProgress(bboxes);
      expect(progress.completed).toBe(3);
      expect(progress.total).toBe(3);
      expect(progress.percentage).toBe(100);
      expect(progress.remaining).toBe(0);
      expect(progress.isComplete).toBe(true);
      // Legacy interface
      expect(progress.totalBboxes).toBe(3);
      expect(progress.annotatedBboxes).toBe(3);
      expect(progress.smokeBboxes).toBe(2);
      expect(progress.falsePositiveBboxes).toBe(1);
      expect(progress.unannotatedBboxes).toBe(0);
    });

    it('should calculate progress for partially annotated bboxes', () => {
      const bboxes = [
        createMockBbox(true, 'wildfire'), // annotated
        createMockBbox(false, undefined, []), // not annotated
        createMockBbox(true, 'industrial'), // annotated
        createMockBbox(false, undefined, []) // not annotated
      ];
      
      const progress = getAnnotationProgress(bboxes);
      expect(progress.completed).toBe(2);
      expect(progress.total).toBe(4);
      expect(progress.percentage).toBe(50);
      expect(progress.remaining).toBe(2);
      expect(progress.isComplete).toBe(false);
      expect(progress.smokeBboxes).toBe(2);
      expect(progress.falsePositiveBboxes).toBe(0);
    });

    it('should handle smoke without smoke_type as incomplete', () => {
      const bboxes = [
        createMockBbox(true, undefined), // smoke but no type - incomplete
        createMockBbox(true, 'wildfire') // complete
      ];
      
      const progress = getAnnotationProgress(bboxes);
      expect(progress.completed).toBe(1);
      expect(progress.total).toBe(2);
      expect(progress.percentage).toBe(50);
      expect(progress.remaining).toBe(1);
      expect(progress.isComplete).toBe(false);
      expect(progress.smokeBboxes).toBe(2);
      expect(progress.falsePositiveBboxes).toBe(0);
    });
  });

  describe('calculateCompletionPercentage', () => {
    it('should calculate correct percentage', () => {
      expect(calculateCompletionPercentage(3, 5)).toBe(60);
      expect(calculateCompletionPercentage(1, 4)).toBe(25);
      expect(calculateCompletionPercentage(4, 4)).toBe(100);
    });

    it('should return 100% for zero total', () => {
      expect(calculateCompletionPercentage(0, 0)).toBe(100);
    });

    it('should handle zero completed', () => {
      expect(calculateCompletionPercentage(0, 5)).toBe(0);
    });

    it('should round to nearest integer', () => {
      expect(calculateCompletionPercentage(1, 3)).toBe(33); // 33.33... rounded
      expect(calculateCompletionPercentage(2, 3)).toBe(67); // 66.67... rounded
    });
  });

  describe('formatRemainingMessage', () => {
    it('should format message for single detection', () => {
      const message = formatRemainingMessage(1, false);
      expect(message).toBe('1 detection still needs annotation');
    });

    it('should format message for multiple detections', () => {
      const message = formatRemainingMessage(3, false);
      expect(message).toBe('3 detections still need annotation');
    });

    it('should include missed smoke review requirement', () => {
      const message = formatRemainingMessage(2, true);
      expect(message).toBe('2 detections still need annotation and missed smoke review is required');
    });

    it('should handle zero remaining', () => {
      const message = formatRemainingMessage(0, false);
      expect(message).toBe('0 detections still need annotation');
    });
  });

  describe('isAnnotationComplete', () => {
    it('should return true when all bboxes annotated and missed smoke reviewed', () => {
      const bboxes = [
        createMockBbox(true, 'wildfire'),
        createMockBbox(false, undefined, ['building'])
      ];
      
      const isComplete = isAnnotationComplete(bboxes, 'yes');
      expect(isComplete).toBe(true);
    });

    it('should return false when bboxes not all annotated', () => {
      const bboxes = [
        createMockBbox(true, 'wildfire'),
        createMockBbox(false, undefined, []) // not annotated
      ];
      
      const isComplete = isAnnotationComplete(bboxes, 'yes');
      expect(isComplete).toBe(false);
    });

    it('should return false when missed smoke not reviewed', () => {
      const bboxes = [
        createMockBbox(true, 'wildfire'),
        createMockBbox(false, undefined, ['building'])
      ];
      
      const isComplete = isAnnotationComplete(bboxes, null);
      expect(isComplete).toBe(false);
    });

    it('should return true for empty array with missed smoke reviewed', () => {
      const isComplete = isAnnotationComplete([], 'no');
      expect(isComplete).toBe(true);
    });
  });

  describe('getAnnotationValidationErrors', () => {
    it('should return no errors for complete annotation', () => {
      const bboxes = [
        createMockBbox(true, 'wildfire'),
        createMockBbox(false, undefined, ['building'])
      ];
      
      const errors = getAnnotationValidationErrors(bboxes, 'yes');
      expect(errors).toEqual([]);
    });

    it('should return error for incomplete bboxes and missed smoke', () => {
      const bboxes = [
        createMockBbox(true, 'wildfire'),
        createMockBbox(false, undefined, []) // not annotated
      ];
      
      const errors = getAnnotationValidationErrors(bboxes, null);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('1 detection still needs annotation and missed smoke review is required');
    });

    it('should return error for incomplete bboxes only', () => {
      const bboxes = [
        createMockBbox(true, 'wildfire'),
        createMockBbox(false, undefined, []) // not annotated
      ];
      
      const errors = getAnnotationValidationErrors(bboxes, 'no');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('1 detection still needs annotation');
      expect(errors[0]).not.toContain('missed smoke review');
    });

    it('should return error for missed smoke review only', () => {
      const bboxes = [
        createMockBbox(true, 'wildfire'),
        createMockBbox(false, undefined, ['building'])
      ];
      
      const errors = getAnnotationValidationErrors(bboxes, null);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe('Cannot save: Please complete the missed smoke review');
    });
  });

  describe('formatProgressDisplay', () => {
    const mockProgress: AnnotationProgress = {
      completed: 3,
      total: 5,
      percentage: 60,
      remaining: 2,
      isComplete: false
    };

    it('should format display with done review status', () => {
      const display = formatProgressDisplay(mockProgress, 'yes');
      expect(display).toBe('Done • 3 of 5 detections • 60% complete');
    });

    it('should format display with pending review status', () => {
      const display = formatProgressDisplay(mockProgress, null);
      expect(display).toBe('Pending • 3 of 5 detections • 60% complete');
    });

    it('should format display with no review status', () => {
      const display = formatProgressDisplay(mockProgress, 'no');
      expect(display).toBe('Done • 3 of 5 detections • 60% complete');
    });
  });


  describe('getProgressColor', () => {
    const completeProgress: AnnotationProgress = {
      completed: 5,
      total: 5,
      percentage: 100,
      remaining: 0,
      isComplete: true
    };

    const incompleteProgress: AnnotationProgress = {
      completed: 3,
      total: 5,
      percentage: 60,
      remaining: 2,
      isComplete: false
    };

    it('should return green for annotated complete progress', () => {
      const color = getProgressColor(completeProgress, 'annotated');
      expect(color).toBe('bg-green-600');
    });

    it('should return amber for complete but not annotated', () => {
      const color = getProgressColor(completeProgress, 'ready_to_annotate');
      expect(color).toBe('bg-amber-600');
    });

    it('should return primary for incomplete progress', () => {
      const color = getProgressColor(incompleteProgress, 'annotated');
      expect(color).toBe('bg-primary-600');
    });

    it('should return primary for incomplete without processing stage', () => {
      const color = getProgressColor(incompleteProgress);
      expect(color).toBe('bg-primary-600');
    });

    it('should handle complete progress without processing stage', () => {
      const color = getProgressColor(completeProgress);
      expect(color).toBe('bg-amber-600');
    });
  });
});