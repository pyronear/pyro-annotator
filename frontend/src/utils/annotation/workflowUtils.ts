/**
 * Pure utility functions for annotation workflow operations.
 * These functions handle workflow state calculations and progress tracking.
 */

import { Detection, DetectionAnnotation } from '@/types/api';
import { DrawnRectangle } from './drawingUtils';

/**
 * Workflow step in the annotation process.
 */
export type WorkflowStep = 'detection' | 'classification' | 'review' | 'complete';

/**
 * Annotation workflow state.
 */
export interface WorkflowState {
  currentStep: WorkflowStep;
  currentIndex: number;
  totalItems: number;
  completedItems: number;
}

/**
 * Progress information for the annotation workflow.
 */
export interface WorkflowProgress {
  percentage: number;
  current: number;
  total: number;
  isComplete: boolean;
  message: string;
}

/**
 * Calculates the current workflow step based on state.
 *
 * @param hasAnnotations - Whether annotations exist
 * @param isReviewing - Whether in review mode
 * @param isComplete - Whether workflow is complete
 * @returns Current workflow step
 *
 * @example
 * ```typescript
 * const step = getWorkflowStep(true, false, false);
 * // Returns: 'classification'
 * ```
 */
export const getWorkflowStep = (
  hasAnnotations: boolean,
  isReviewing: boolean,
  isComplete: boolean
): WorkflowStep => {
  if (isComplete) return 'complete';
  if (isReviewing) return 'review';
  if (hasAnnotations) return 'classification';
  return 'detection';
};

/**
 * Calculates workflow progress information.
 *
 * @param current - Current item index
 * @param total - Total number of items
 * @returns Progress information
 *
 * @example
 * ```typescript
 * const progress = calculateWorkflowProgress(3, 10);
 * // Returns: { percentage: 30, current: 3, total: 10, isComplete: false, message: '3 of 10' }
 * ```
 */
export const calculateWorkflowProgress = (current: number, total: number): WorkflowProgress => {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const isComplete = current >= total && total > 0;

  let message = '';
  if (total === 0) {
    message = 'No items to process';
  } else if (isComplete) {
    message = 'All items completed';
  } else {
    message = `${current} of ${total}`;
  }

  return {
    percentage,
    current,
    total,
    isComplete,
    message,
  };
};

/**
 * Gets the next detection index in the workflow.
 *
 * @param currentIndex - Current detection index
 * @param totalDetections - Total number of detections
 * @param loop - Whether to loop back to start
 * @returns Next index or null if at end
 *
 * @example
 * ```typescript
 * const nextIndex = getNextDetectionIndex(2, 5, false);
 * // Returns: 3
 * ```
 */
export const getNextDetectionIndex = (
  currentIndex: number,
  totalDetections: number,
  loop: boolean = false
): number | null => {
  if (totalDetections === 0) return null;

  const nextIndex = currentIndex + 1;

  if (nextIndex >= totalDetections) {
    return loop ? 0 : null;
  }

  return nextIndex;
};

/**
 * Gets the previous detection index in the workflow.
 *
 * @param currentIndex - Current detection index
 * @param totalDetections - Total number of detections
 * @param loop - Whether to loop back to end
 * @returns Previous index or null if at start
 *
 * @example
 * ```typescript
 * const prevIndex = getPreviousDetectionIndex(0, 5, false);
 * // Returns: null (at start, no loop)
 * ```
 */
export const getPreviousDetectionIndex = (
  currentIndex: number,
  totalDetections: number,
  loop: boolean = false
): number | null => {
  if (totalDetections === 0) return null;

  const prevIndex = currentIndex - 1;

  if (prevIndex < 0) {
    return loop ? totalDetections - 1 : null;
  }

  return prevIndex;
};

/**
 * Checks if the annotation workflow is complete.
 *
 * @param detections - Array of detections
 * @param annotations - Map of detection ID to annotation
 * @returns True if all detections are annotated
 *
 * @example
 * ```typescript
 * const isComplete = isWorkflowComplete(detections, annotations);
 * ```
 */
export const isWorkflowComplete = (
  detections: Detection[],
  annotations: Map<number, DetectionAnnotation>
): boolean => {
  if (detections.length === 0) return true;

  return detections.every(detection => {
    const annotation = annotations.get(detection.id);
    return annotation && annotation.processing_stage === 'annotated';
  });
};

/**
 * Validates annotation data before submission.
 *
 * @param rectangles - Array of drawn rectangles
 * @param minRectangles - Minimum number of rectangles required
 * @returns Validation result with message
 *
 * @example
 * ```typescript
 * const validation = validateAnnotationData(rectangles, 1);
 * // Returns: { isValid: true, message: 'Ready to submit' }
 * ```
 */
export const validateAnnotationData = (
  rectangles: DrawnRectangle[],
  minRectangles: number = 0
): { isValid: boolean; message: string; warnings: string[] } => {
  if (rectangles.length < minRectangles) {
    return {
      isValid: false,
      message: `At least ${minRectangles} annotation${minRectangles > 1 ? 's' : ''} required`,
      warnings: [],
    };
  }

  // Check if all rectangles have valid smoke types
  const invalidRectangles = rectangles.filter(
    rect => !rect.smokeType || !['wildfire', 'industrial', 'other'].includes(rect.smokeType)
  );

  if (invalidRectangles.length > 0) {
    return {
      isValid: false,
      message: 'All annotations must have a valid smoke type',
      warnings: [],
    };
  }

  // Check for valid coordinates
  const invalidCoords = rectangles.filter(rect => {
    const [x1, y1, x2, y2] = rect.xyxyn;
    return (
      x1 >= x2 ||
      y1 >= y2 ||
      x1 < 0 ||
      x1 > 1 ||
      x2 < 0 ||
      x2 > 1 ||
      y1 < 0 ||
      y1 > 1 ||
      y2 < 0 ||
      y2 > 1
    );
  });

  if (invalidCoords.length > 0) {
    return {
      isValid: false,
      message: 'Some annotations have invalid coordinates',
      warnings: [],
    };
  }

  return {
    isValid: true,
    message: 'Ready to submit',
    warnings: [],
  };
};

/**
 * Formats workflow status message.
 *
 * @param state - Current workflow state
 * @returns Formatted status message
 *
 * @example
 * ```typescript
 * const message = formatWorkflowStatus({
 *   currentStep: 'classification',
 *   currentIndex: 2,
 *   totalItems: 10,
 *   completedItems: 2
 * });
 * // Returns: 'Classification - 2 of 10 completed'
 * ```
 */
export const formatWorkflowStatus = (state: WorkflowState): string => {
  const stepLabels: Record<WorkflowStep, string> = {
    detection: 'Detection',
    classification: 'Classification',
    review: 'Review',
    complete: 'Complete',
  };

  const stepLabel = stepLabels[state.currentStep];

  if (state.currentStep === 'complete') {
    return `✓ ${stepLabel} - All ${state.totalItems} items processed`;
  }

  return `${stepLabel} - ${state.completedItems} of ${state.totalItems} completed`;
};

/**
 * Calculates the number of remaining items in workflow.
 *
 * @param total - Total number of items
 * @param completed - Number of completed items
 * @returns Number of remaining items
 *
 * @example
 * ```typescript
 * const remaining = calculateRemainingItems(10, 3);
 * // Returns: 7
 * ```
 */
export const calculateRemainingItems = (total: number, completed: number): number => {
  return Math.max(0, total - completed);
};
