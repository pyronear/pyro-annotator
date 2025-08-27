/**
 * Pure utility functions for annotation progress calculations.
 * These functions handle progress tracking and completion status.
 */

import { SequenceBbox } from '@/types/api';
import { hasUserAnnotations } from './sequenceUtils';

/**
 * Progress information for annotation workflow.
 */
export interface AnnotationProgress {
  completed: number;
  total: number;
  percentage: number;
  remaining: number;
  isComplete: boolean;
  // Legacy interface compatibility
  totalBboxes: number;
  annotatedBboxes: number;
  smokeBboxes: number;
  falsePositiveBboxes: number;
  unannotatedBboxes: number;
  completionPercentage: number;
}

/**
 * Calculates annotation progress for a set of bounding boxes.
 * 
 * @param bboxes - Array of sequence bounding boxes
 * @returns Progress information with completion stats
 * 
 * @example
 * ```typescript
 * const progress = getAnnotationProgress(bboxes);
 * // Returns: { completed: 3, total: 5, percentage: 60, remaining: 2, isComplete: false }
 * ```
 */
export const getAnnotationProgress = (bboxes: SequenceBbox[]): AnnotationProgress => {
  const total = bboxes.length;
  const completed = bboxes.filter(bbox => hasUserAnnotations(bbox)).length;
  const remaining = total - completed;
  const percentage = total === 0 ? 100 : Math.round((completed / total) * 100);
  const isComplete = completed === total && total > 0;
  
  // Additional detailed statistics
  const smokeBboxes = bboxes.filter(bbox => bbox.is_smoke).length;
  const falsePositiveBboxes = bboxes.filter(bbox => bbox.false_positive_types.length > 0).length;

  return {
    // New interface
    completed,
    total,
    percentage,
    remaining,
    isComplete,
    // Legacy interface compatibility
    totalBboxes: total,
    annotatedBboxes: completed,
    smokeBboxes,
    falsePositiveBboxes,
    unannotatedBboxes: remaining,
    completionPercentage: percentage
  };
};

/**
 * Calculates completion percentage for progress display.
 * 
 * @param completed - Number of completed items
 * @param total - Total number of items
 * @returns Percentage as a number between 0-100
 * 
 * @example
 * ```typescript
 * const percentage = calculateCompletionPercentage(3, 5);
 * // Returns: 60
 * ```
 */
export const calculateCompletionPercentage = (
  completed: number,
  total: number
): number => {
  if (total === 0) return 100;
  return Math.round((completed / total) * 100);
};

/**
 * Formats a message describing remaining annotation work.
 * 
 * @param remaining - Number of remaining items
 * @param includeMissedSmoke - Whether to include missed smoke review requirement
 * @returns Formatted message string
 * 
 * @example
 * ```typescript
 * const message = formatRemainingMessage(2, true);
 * // Returns: '2 detections still need annotation and missed smoke review is required'
 * ```
 */
export const formatRemainingMessage = (
  remaining: number,
  includeMissedSmoke: boolean = false
): string => {
  const detectionText = `${remaining} detection${remaining !== 1 ? 's' : ''} still need${remaining === 1 ? 's' : ''} annotation`;
  
  if (includeMissedSmoke) {
    return `${detectionText} and missed smoke review is required`;
  }
  
  return detectionText;
};

/**
 * Determines if annotation work is complete for saving.
 * 
 * @param bboxes - Array of sequence bounding boxes
 * @param missedSmokeReview - Missed smoke review status
 * @returns True if all annotations and reviews are complete
 * 
 * @example
 * ```typescript
 * const canSave = isAnnotationComplete(bboxes, 'yes');
 * // Returns: true if all bboxes annotated and missed smoke reviewed
 * ```
 */
export const isAnnotationComplete = (
  bboxes: SequenceBbox[],
  missedSmokeReview: 'yes' | 'no' | null
): boolean => {
  const bboxesComplete = bboxes.every(bbox => hasUserAnnotations(bbox));
  const missedSmokeComplete = missedSmokeReview !== null;
  return bboxesComplete && missedSmokeComplete;
};

/**
 * Gets validation errors for incomplete annotation.
 * 
 * @param bboxes - Array of sequence bounding boxes
 * @param missedSmokeReview - Missed smoke review status
 * @returns Array of error messages, empty if complete
 * 
 * @example
 * ```typescript
 * const errors = getAnnotationValidationErrors(bboxes, null);
 * // Returns: ['2 detections still need annotation', 'Missed smoke review is required']
 * ```
 */
export const getAnnotationValidationErrors = (
  bboxes: SequenceBbox[],
  missedSmokeReview: 'yes' | 'no' | null
): string[] => {
  const errors: string[] = [];
  
  const progress = getAnnotationProgress(bboxes);
  const bboxesComplete = progress.isComplete;
  const missedSmokeComplete = missedSmokeReview !== null;
  
  if (!bboxesComplete && !missedSmokeComplete) {
    errors.push(`Cannot save: ${formatRemainingMessage(progress.remaining, true)}`);
  } else if (!bboxesComplete) {
    errors.push(`Cannot save: ${formatRemainingMessage(progress.remaining, false)}`);
  } else if (!missedSmokeComplete) {
    errors.push('Cannot save: Please complete the missed smoke review');
  }
  
  return errors;
};

/**
 * Formats progress display text.
 * 
 * @param progress - Progress information
 * @param missedSmokeReview - Missed smoke review status
 * @returns Formatted progress string
 * 
 * @example
 * ```typescript
 * const text = formatProgressDisplay(progress, 'yes');
 * // Returns: 'Done • 3 of 5 detections • 60% complete'
 * ```
 */
export const formatProgressDisplay = (
  progress: AnnotationProgress,
  missedSmokeReview: 'yes' | 'no' | null
): string => {
  const reviewStatus = missedSmokeReview ? 'Done' : 'Pending';
  return `${reviewStatus} • ${progress.completed} of ${progress.total} detections • ${progress.percentage}% complete`;
};


/**
 * Gets progress status color class for UI display.
 * 
 * @param progress - Progress information
 * @param processingStage - Current processing stage
 * @returns CSS color class name
 * 
 * @example
 * ```typescript
 * const colorClass = getProgressColor(progress, 'annotated');
 * // Returns: 'bg-green-600'
 * ```
 */
export const getProgressColor = (
  progress: AnnotationProgress,
  processingStage?: string
): string => {
  if (progress.isComplete) {
    return processingStage === 'annotated' ? 'bg-green-600' : 'bg-amber-600';
  }
  
  return 'bg-primary-600';
};