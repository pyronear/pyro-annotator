/**
 * Unit tests for workflow utilities.
 * These tests verify annotation workflow logic and progress calculations.
 */

import { describe, it, expect } from 'vitest';
import {
  getWorkflowStep,
  calculateWorkflowProgress,
  getNextDetectionIndex,
  getPreviousDetectionIndex,
  isWorkflowComplete,
  validateAnnotationData,
  formatWorkflowStatus,
  calculateRemainingItems,
  WorkflowState
} from '@/utils/annotation/workflowUtils';
import { DrawnRectangle } from '@/utils/annotation/drawingUtils';
import { Detection, DetectionAnnotation } from '@/types/api';

describe('workflowUtils', () => {
  describe('getWorkflowStep', () => {
    it('should return complete when workflow is complete', () => {
      const step = getWorkflowStep(true, false, true);
      expect(step).toBe('complete');
    });

    it('should return review when in review mode', () => {
      const step = getWorkflowStep(true, true, false);
      expect(step).toBe('review');
    });

    it('should return classification when has annotations but not reviewing', () => {
      const step = getWorkflowStep(true, false, false);
      expect(step).toBe('classification');
    });

    it('should return detection when no annotations', () => {
      const step = getWorkflowStep(false, false, false);
      expect(step).toBe('detection');
    });
  });

  describe('calculateWorkflowProgress', () => {
    it('should calculate progress correctly', () => {
      const progress = calculateWorkflowProgress(3, 10);
      
      expect(progress.percentage).toBe(30);
      expect(progress.current).toBe(3);
      expect(progress.total).toBe(10);
      expect(progress.isComplete).toBe(false);
      expect(progress.message).toBe('3 of 10');
    });

    it('should handle complete workflow', () => {
      const progress = calculateWorkflowProgress(10, 10);
      
      expect(progress.percentage).toBe(100);
      expect(progress.isComplete).toBe(true);
      expect(progress.message).toBe('All items completed');
    });

    it('should handle zero total items', () => {
      const progress = calculateWorkflowProgress(0, 0);
      
      expect(progress.percentage).toBe(0);
      expect(progress.isComplete).toBe(false);
      expect(progress.message).toBe('No items to process');
    });

    it('should handle current > total', () => {
      const progress = calculateWorkflowProgress(15, 10);
      
      expect(progress.percentage).toBe(150);
      expect(progress.isComplete).toBe(true);
    });

    it('should round percentages correctly', () => {
      const progress = calculateWorkflowProgress(1, 3);
      expect(progress.percentage).toBe(33); // Math.round(33.333...)
    });
  });

  describe('getNextDetectionIndex', () => {
    it('should return next index when available', () => {
      const nextIndex = getNextDetectionIndex(2, 5, false);
      expect(nextIndex).toBe(3);
    });

    it('should return null when at end without looping', () => {
      const nextIndex = getNextDetectionIndex(4, 5, false);
      expect(nextIndex).toBe(null);
    });

    it('should loop back to start when at end with looping', () => {
      const nextIndex = getNextDetectionIndex(4, 5, true);
      expect(nextIndex).toBe(0);
    });

    it('should return null for empty collection', () => {
      const nextIndex = getNextDetectionIndex(0, 0, false);
      expect(nextIndex).toBe(null);
    });

    it('should handle single item with looping', () => {
      const nextIndex = getNextDetectionIndex(0, 1, true);
      expect(nextIndex).toBe(0);
    });
  });

  describe('getPreviousDetectionIndex', () => {
    it('should return previous index when available', () => {
      const prevIndex = getPreviousDetectionIndex(3, 5, false);
      expect(prevIndex).toBe(2);
    });

    it('should return null when at start without looping', () => {
      const prevIndex = getPreviousDetectionIndex(0, 5, false);
      expect(prevIndex).toBe(null);
    });

    it('should loop back to end when at start with looping', () => {
      const prevIndex = getPreviousDetectionIndex(0, 5, true);
      expect(prevIndex).toBe(4);
    });

    it('should return null for empty collection', () => {
      const prevIndex = getPreviousDetectionIndex(0, 0, false);
      expect(prevIndex).toBe(null);
    });

    it('should handle single item with looping', () => {
      const prevIndex = getPreviousDetectionIndex(0, 1, true);
      expect(prevIndex).toBe(0);
    });
  });

  describe('isWorkflowComplete', () => {
    const createDetection = (id: number): Detection => ({
      id,
      sequence_id: 1,
      bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
      confidence: 0.95,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      algo_predictions: null
    });

    const createAnnotation = (id: number, detectionId: number, complete: boolean = true): DetectionAnnotation => ({
      id,
      detection_id: detectionId,
      annotation: { annotation: [] },
      processing_stage: complete ? 'annotated' : 'in_progress',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    it('should return true when all detections are annotated', () => {
      const detections = [createDetection(1), createDetection(2)];
      const annotations = new Map([
        [1, createAnnotation(1, 1, true)],
        [2, createAnnotation(2, 2, true)]
      ]);

      const isComplete = isWorkflowComplete(detections, annotations);
      expect(isComplete).toBe(true);
    });

    it('should return false when some detections are not annotated', () => {
      const detections = [createDetection(1), createDetection(2)];
      const annotations = new Map([
        [1, createAnnotation(1, 1, true)]
        // Missing annotation for detection 2
      ]);

      const isComplete = isWorkflowComplete(detections, annotations);
      expect(isComplete).toBe(false);
    });

    it('should return false when annotations are not in annotated stage', () => {
      const detections = [createDetection(1)];
      const annotations = new Map([
        [1, createAnnotation(1, 1, false)] // in_progress stage
      ]);

      const isComplete = isWorkflowComplete(detections, annotations);
      expect(isComplete).toBe(false);
    });

    it('should return true for empty detections list', () => {
      const detections: Detection[] = [];
      const annotations = new Map();

      const isComplete = isWorkflowComplete(detections, annotations);
      expect(isComplete).toBe(true);
    });
  });

  describe('validateAnnotationData', () => {
    const createRectangle = (smokeType: string, coordinates: [number, number, number, number] = [0.1, 0.2, 0.8, 0.9]): DrawnRectangle => ({
      id: '1',
      xyxyn: coordinates,
      smokeType: smokeType as 'wildfire'
    });

    it('should validate correct annotation data', () => {
      const rectangles = [
        createRectangle('wildfire'),
        createRectangle('industrial')
      ];

      const validation = validateAnnotationData(rectangles, 1);
      expect(validation.isValid).toBe(true);
      expect(validation.message).toBe('Ready to submit');
    });

    it('should fail when minimum rectangles not met', () => {
      const rectangles: DrawnRectangle[] = [];

      const validation = validateAnnotationData(rectangles, 2);
      expect(validation.isValid).toBe(false);
      expect(validation.message).toBe('At least 2 annotations required');
    });

    it('should fail for invalid smoke types', () => {
      const rectangles = [createRectangle('invalid_type')];

      const validation = validateAnnotationData(rectangles, 0);
      expect(validation.isValid).toBe(false);
      expect(validation.message).toBe('All annotations must have a valid smoke type');
    });

    it('should fail for invalid coordinates', () => {
      const rectangles = [
        createRectangle('wildfire', [0.8, 0.9, 0.1, 0.2]) // x1 > x2, y1 > y2
      ];

      const validation = validateAnnotationData(rectangles, 0);
      expect(validation.isValid).toBe(false);
      expect(validation.message).toBe('Some annotations have invalid coordinates');
    });

    it('should fail for coordinates outside 0-1 range', () => {
      const rectangles = [
        createRectangle('wildfire', [-0.1, 0.2, 1.5, 0.9]) // Outside 0-1 range
      ];

      const validation = validateAnnotationData(rectangles, 0);
      expect(validation.isValid).toBe(false);
      expect(validation.message).toBe('Some annotations have invalid coordinates');
    });

    it('should handle zero minimum requirements', () => {
      const rectangles: DrawnRectangle[] = [];

      const validation = validateAnnotationData(rectangles, 0);
      expect(validation.isValid).toBe(true);
      expect(validation.message).toBe('Ready to submit');
    });
  });

  describe('formatWorkflowStatus', () => {
    it('should format detection step status', () => {
      const state: WorkflowState = {
        currentStep: 'detection',
        currentIndex: 2,
        totalItems: 10,
        completedItems: 2
      };

      const message = formatWorkflowStatus(state);
      expect(message).toBe('Detection - 2 of 10 completed');
    });

    it('should format classification step status', () => {
      const state: WorkflowState = {
        currentStep: 'classification',
        currentIndex: 5,
        totalItems: 10,
        completedItems: 5
      };

      const message = formatWorkflowStatus(state);
      expect(message).toBe('Classification - 5 of 10 completed');
    });

    it('should format complete step status', () => {
      const state: WorkflowState = {
        currentStep: 'complete',
        currentIndex: 10,
        totalItems: 10,
        completedItems: 10
      };

      const message = formatWorkflowStatus(state);
      expect(message).toBe('✓ Complete - All 10 items processed');
    });

    it('should format review step status', () => {
      const state: WorkflowState = {
        currentStep: 'review',
        currentIndex: 8,
        totalItems: 10,
        completedItems: 8
      };

      const message = formatWorkflowStatus(state);
      expect(message).toBe('Review - 8 of 10 completed');
    });
  });

  describe('calculateRemainingItems', () => {
    it('should calculate remaining items correctly', () => {
      const remaining = calculateRemainingItems(10, 3);
      expect(remaining).toBe(7);
    });

    it('should return zero when all items completed', () => {
      const remaining = calculateRemainingItems(5, 5);
      expect(remaining).toBe(0);
    });

    it('should handle completed > total', () => {
      const remaining = calculateRemainingItems(5, 8);
      expect(remaining).toBe(0);
    });

    it('should handle zero total', () => {
      const remaining = calculateRemainingItems(0, 0);
      expect(remaining).toBe(0);
    });
  });

});