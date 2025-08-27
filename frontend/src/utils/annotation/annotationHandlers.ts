/**
 * Event handler utilities for annotation interface.
 * 
 * This module contains complex event handling logic extracted from the AnnotationInterface
 * component, including bbox changes, save/reset operations, and false positive type handling.
 * 
 * @fileoverview Provides factory functions for creating annotation event handlers with
 * proper state management integration and validation logic.
 */

import { SequenceBbox, FalsePositiveType, SequenceAnnotation } from '@/types/api';
import { FALSE_POSITIVE_TYPES } from '@/utils/constants';
import { initializeCleanBbox, getInitialMissedSmokeReview } from './sequenceUtils';
import { getAnnotationValidationErrors } from './progressUtils';

/**
 * Handler function type for bbox changes.
 * @callback BboxChangeHandler
 * @param {number} index - The index of the bbox being changed
 * @param {SequenceBbox} updatedBbox - The updated bbox data
 */
export interface BboxChangeHandler {
  (index: number, updatedBbox: SequenceBbox): void;
}

/**
 * Handler function type for missed smoke review changes.
 * @callback MissedSmokeHandler
 * @param {'yes' | 'no'} review - The missed smoke review value
 */
export interface MissedSmokeHandler {
  (review: 'yes' | 'no'): void;
}

/**
 * Handler function type for toast notifications.
 * @callback ToastHandler
 * @param {string} message - The message to display
 * @param {'success' | 'error' | 'info'} [type] - The type of notification
 */
export interface ToastHandler {
  (message: string, type?: 'success' | 'error' | 'info'): void;
}

/**
 * Creates a bbox change handler with state setter integration.
 * 
 * This factory function creates a handler that updates the bboxes array immutably
 * when a specific bbox is modified. The handler integrates with React state setters.
 * 
 * @param {Function} setBboxes - React state setter for the bboxes array
 * @returns {BboxChangeHandler} Handler function for bbox changes
 * 
 * @example
 * ```typescript
 * const handleBboxChange = createBboxChangeHandler(setBboxes);
 * handleBboxChange(0, updatedBbox); // Updates bbox at index 0
 * ```
 */
export const createBboxChangeHandler = (
  setBboxes: (bboxes: SequenceBbox[] | ((prev: SequenceBbox[]) => SequenceBbox[])) => void
): BboxChangeHandler => {
  return (index: number, updatedBbox: SequenceBbox) => {
    setBboxes((currentBboxes: SequenceBbox[]) => {
      const newBboxes = [...currentBboxes];
      newBboxes[index] = updatedBbox;
      return newBboxes;
    });
  };
};

/**
 * Creates a missed smoke review change handler.
 * 
 * This factory function creates a handler that updates both the missed smoke review
 * state and the boolean has missed smoke flag when the user provides feedback.
 * 
 * @param {Function} setMissedSmokeReview - React state setter for missed smoke review
 * @param {Function} setHasMissedSmoke - React state setter for has missed smoke boolean
 * @returns {MissedSmokeHandler} Handler function for missed smoke review changes
 * 
 * @example
 * ```typescript
 * const handleMissedSmokeChange = createMissedSmokeHandler(
 *   setMissedSmokeReview, 
 *   setHasMissedSmoke
 * );
 * handleMissedSmokeChange('yes'); // Sets review to 'yes' and hasSmoke to true
 * ```
 */
export const createMissedSmokeHandler = (
  setMissedSmokeReview: (review: 'yes' | 'no' | null) => void,
  setHasMissedSmoke: (hasSmoke: boolean) => void
): MissedSmokeHandler => {
  return (review: 'yes' | 'no') => {
    setMissedSmokeReview(review);
    setHasMissedSmoke(review === 'yes');
  };
};

/**
 * Creates a save annotation handler with validation.
 * 
 * This factory function creates a handler that validates annotation completeness
 * before saving, with support for unsure submissions that skip validation.
 * 
 * @param {SequenceBbox[]} bboxes - Current bbox annotations
 * @param {'yes' | 'no' | null} missedSmokeReview - Current missed smoke review state
 * @param {boolean} isUnsure - Whether this is an unsure submission
 * @param {Object} saveMutation - TanStack Query mutation object with mutate method
 * @param {ToastHandler} showToast - Function to show toast notifications
 * @returns {Function} Handler function for save operations
 */
export const createSaveHandler = (
  bboxes: SequenceBbox[],
  missedSmokeReview: 'yes' | 'no' | null,
  isUnsure: boolean,
  saveMutation: { mutate: (bboxes: SequenceBbox[]) => void },
  showToast: ToastHandler
) => {
  return () => {
    // If marked as unsure, skip all validation and allow immediate submission
    if (isUnsure) {
      saveMutation.mutate(bboxes);
      return;
    }

    // Validate annotation completeness
    const validationErrors = getAnnotationValidationErrors(bboxes, missedSmokeReview);
    if (validationErrors.length > 0) {
      showToast(validationErrors[0], 'error');
      return;
    }
    
    saveMutation.mutate(bboxes);
  };
};

/**
 * Creates reset annotation handler.
 */
export const createResetHandler = (
  annotation: SequenceAnnotation | null,
  setHasMissedSmoke: (hasSmoke: boolean) => void,
  setIsUnsure: (isUnsure: boolean) => void,
  setMissedSmokeReview: (review: 'yes' | 'no' | null) => void,
  setBboxes: (bboxes: SequenceBbox[]) => void,
  setPrimaryClassification: (classification: Record<number, 'unselected' | 'smoke' | 'false_positive'>) => void,
  showToast: ToastHandler
) => {
  return () => {
    if (!annotation) return;

    // Reset missed smoke to original value
    setHasMissedSmoke(annotation.has_missed_smoke || false);
    
    // Reset unsure flag to original value
    setIsUnsure(annotation.is_unsure || false);
    
    // Reset missed smoke review using helper function that respects processing stage
    setMissedSmokeReview(getInitialMissedSmokeReview(annotation));
    
    // Use the same logic as initialization to respect processing stage
    if (annotation.processing_stage === 'ready_to_annotate') {
      // For sequences ready to annotate, reset to clean checkboxes
      const cleanBboxes = annotation.annotation.sequences_bbox.map(bbox => 
        initializeCleanBbox(bbox)
      );
      setBboxes(cleanBboxes);
    } else {
      // For sequences in other stages (annotated, etc.), preserve existing annotations
      setBboxes([...annotation.annotation.sequences_bbox]);
    }
    
    // Reset primary classification UI state
    const initialClassification: Record<number, 'unselected' | 'smoke' | 'false_positive'> = {};
    annotation.annotation.sequences_bbox.forEach((bbox, index) => {
      if (bbox.is_smoke) {
        initialClassification[index] = 'smoke';
      } else if (bbox.false_positive_types.length > 0) {
        initialClassification[index] = 'false_positive';
      } else {
        initialClassification[index] = 'unselected';
      }
    });
    setPrimaryClassification(initialClassification);
    
    // Show success toast notification
    showToast('Annotation reset successfully', 'success');
  };
};

/**
 * Maps keyboard keys to false positive type indices.
 */
export const getTypeIndexForKey = (key: string): number => {
  const keyMap: Record<string, number> = {
    'a': FALSE_POSITIVE_TYPES.indexOf('antenna'),
    'b': FALSE_POSITIVE_TYPES.indexOf('building'),
    'c': FALSE_POSITIVE_TYPES.indexOf('cliff'),
    'd': FALSE_POSITIVE_TYPES.indexOf('dark'),
    'u': FALSE_POSITIVE_TYPES.indexOf('dust'), // 'd' taken by dark
    'h': FALSE_POSITIVE_TYPES.indexOf('high_cloud'),
    'l': FALSE_POSITIVE_TYPES.indexOf('low_cloud'),
    'g': FALSE_POSITIVE_TYPES.indexOf('lens_flare'),
    'p': FALSE_POSITIVE_TYPES.indexOf('lens_droplet'), // 'l' taken by low_cloud, use 'p' for droplet
    'i': FALSE_POSITIVE_TYPES.indexOf('light'), // 'l' taken
    'r': FALSE_POSITIVE_TYPES.indexOf('rain'),
    't': FALSE_POSITIVE_TYPES.indexOf('trail'),
    'o': FALSE_POSITIVE_TYPES.indexOf('road'), // 'r' taken by rain, use 'o' for road
    'k': FALSE_POSITIVE_TYPES.indexOf('sky'), // 's' taken by smoke
    'e': FALSE_POSITIVE_TYPES.indexOf('tree'), // 't' taken by trail
    'w': FALSE_POSITIVE_TYPES.indexOf('water_body'),
    'x': FALSE_POSITIVE_TYPES.indexOf('other'), // 'o' taken by road
  };
  
  return keyMap[key] ?? -1;
};

/**
 * Toggles false positive type for a detection.
 */
export const toggleFalsePositiveType = (
  detectionIndex: number, 
  typeIndex: number, 
  bboxes: SequenceBbox[], 
  handleBboxChange: BboxChangeHandler
): void => {
  const bbox = bboxes[detectionIndex];
  if (!bbox || bbox.is_smoke) return; // Don't allow if it's marked as smoke
  
  const fpType = FALSE_POSITIVE_TYPES[typeIndex] as FalsePositiveType;
  const updatedBbox = { ...bbox };
  
  if (bbox.false_positive_types.includes(fpType)) {
    // Remove the type
    updatedBbox.false_positive_types = bbox.false_positive_types.filter(type => type !== fpType);
  } else {
    // Add the type
    updatedBbox.false_positive_types = [...bbox.false_positive_types, fpType];
  }
  
  handleBboxChange(detectionIndex, updatedBbox);
};