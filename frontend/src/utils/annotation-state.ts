/**
 * Pure utility functions for annotation state management
 * 
 * These functions provide functional operations for sequence annotation workflows,
 * bbox state management, and annotation validation without side effects.
 */

import { SequenceAnnotation, SequenceBbox, FalsePositiveType } from '@/types/api';

/**
 * Annotation workflow stages
 */
export type AnnotationStage = 'ready_to_annotate' | 'in_progress' | 'annotated' | 'reviewed';

/**
 * Annotation completion status
 */
export interface AnnotationCompletion {
  readonly totalBboxes: number;
  readonly annotatedBboxes: number;
  readonly completionRate: number;
  readonly isComplete: boolean;
}

/**
 * Bbox annotation state
 */
export interface BboxAnnotationState {
  readonly bboxId: string;
  readonly isSmoke: boolean;
  readonly falsePositiveTypes: readonly FalsePositiveType[];
  readonly isAnnotated: boolean;
  readonly hasConflict: boolean;
}

/**
 * Navigation state for annotation interface
 */
export interface AnnotationNavigation {
  readonly currentIndex: number;
  readonly totalCount: number;
  readonly canNavigateNext: boolean;
  readonly canNavigatePrevious: boolean;
  readonly isFirstItem: boolean;
  readonly isLastItem: boolean;
}

/**
 * Checks if a bbox has any user annotations
 * 
 * @pure Function determines annotation status without side effects
 * @param bbox - Sequence bbox to check
 * @returns True if bbox has user annotations
 * 
 * @example
 * const isAnnotated = hasUserAnnotations({
 *   is_smoke: true,
 *   false_positive_types: [],
 *   bboxes: [...]
 * });
 */
export const hasUserAnnotations = (bbox: SequenceBbox): boolean => {
  return bbox.is_smoke || bbox.false_positive_types.length > 0;
};

/**
 * Creates a clean bbox with reset annotation state
 * 
 * @pure Function creates new bbox without mutating original
 * @param originalBbox - Original bbox to clean
 * @returns New bbox with reset annotation state
 * 
 * @example
 * const cleanBbox = initializeCleanBbox(originalBbox);
 * // Result: { ...originalBbox, is_smoke: false, false_positive_types: [] }
 */
export const initializeCleanBbox = (originalBbox: SequenceBbox): SequenceBbox => {
  return {
    ...originalBbox,
    is_smoke: false,
    false_positive_types: [],
  };
};

/**
 * Determines if bbox should be displayed as annotated
 * 
 * @pure Function evaluates display state based on processing stage
 * @param bbox - Sequence bbox to evaluate
 * @param processingStage - Current processing stage
 * @returns True if bbox should appear annotated
 * 
 * @example
 * const showAnnotated = shouldShowAsAnnotated(bbox, 'ready_to_annotate');
 */
export const shouldShowAsAnnotated = (bbox: SequenceBbox, processingStage: string): boolean => {
  // If already marked as annotated in processing stage, show as annotated
  if (processingStage === 'annotated') {
    return true;
  }
  
  // If ready to annotate, only show as annotated if user has made selections
  if (processingStage === 'ready_to_annotate') {
    return hasUserAnnotations(bbox);
  }
  
  // For other stages, default to checking user annotations
  return hasUserAnnotations(bbox);
};

/**
 * Gets initial missed smoke review state from annotation
 * 
 * @pure Function extracts review state without side effects
 * @param annotation - Sequence annotation to evaluate
 * @returns Initial missed smoke review state
 * 
 * @example
 * const reviewState = getInitialMissedSmokeReview(annotation);
 * // Returns: 'yes' | 'no' | null
 */
export const getInitialMissedSmokeReview = (annotation: SequenceAnnotation): 'yes' | 'no' | null => {
  if (annotation.processing_stage === 'annotated') {
    // For annotated sequences, the has_missed_smoke boolean reflects the actual review result
    return annotation.has_missed_smoke ? 'yes' : 'no';
  } else {
    // For other stages (like ready_to_annotate), null means not reviewed yet
    return annotation.has_missed_smoke ? 'yes' : null;
  }
};

/**
 * Calculates annotation completion statistics
 * 
 * @pure Function computes completion metrics without side effects
 * @param bboxes - Array of sequence bboxes
 * @returns Completion statistics object
 * 
 * @example
 * const completion = calculateAnnotationCompletion(bboxes);
 * // Returns: { totalBboxes: 5, annotatedBboxes: 3, completionRate: 60, isComplete: false }
 */
export const calculateAnnotationCompletion = (bboxes: readonly SequenceBbox[]): AnnotationCompletion => {
  const totalBboxes = bboxes.length;
  const annotatedBboxes = bboxes.filter(hasUserAnnotations).length;
  const completionRate = totalBboxes > 0 ? Math.round((annotatedBboxes / totalBboxes) * 100) : 100;
  const isComplete = totalBboxes > 0 && annotatedBboxes === totalBboxes;
  
  return {
    totalBboxes,
    annotatedBboxes,
    completionRate,
    isComplete
  };
};

/**
 * Creates bbox annotation state object
 * 
 * @pure Function extracts annotation state without side effects
 * @param bbox - Sequence bbox to analyze
 * @param index - Bbox index for ID generation
 * @returns Bbox annotation state object
 * 
 * @example
 * const state = createBboxAnnotationState(bbox, 0);
 */
export const createBboxAnnotationState = (bbox: SequenceBbox, index: number): BboxAnnotationState => {
  const isSmoke = bbox.is_smoke;
  const falsePositiveTypes = bbox.false_positive_types;
  const isAnnotated = hasUserAnnotations(bbox);
  const hasConflict = isSmoke && falsePositiveTypes.length > 0; // Smoke and false positive selected
  
  return {
    bboxId: `bbox-${index}`,
    isSmoke,
    falsePositiveTypes,
    isAnnotated,
    hasConflict
  };
};

/**
 * Updates bbox with new annotation values
 * 
 * @pure Function creates updated bbox without mutation
 * @param bbox - Original bbox to update
 * @param isSmoke - New smoke annotation value
 * @param falsePositiveTypes - New false positive types
 * @returns Updated bbox object
 * 
 * @example
 * const updated = updateBboxAnnotation(bbox, true, []);
 */
export const updateBboxAnnotation = (
  bbox: SequenceBbox,
  isSmoke: boolean,
  falsePositiveTypes: readonly FalsePositiveType[]
): SequenceBbox => {
  return {
    ...bbox,
    is_smoke: isSmoke,
    false_positive_types: [...falsePositiveTypes]
  };
};

/**
 * Validates annotation completeness for submission
 * 
 * @pure Function validates annotation state without side effects
 * @param annotation - Sequence annotation to validate
 * @param bboxes - Array of sequence bboxes
 * @param missedSmokeReview - Current missed smoke review state
 * @returns Validation result with errors
 * 
 * @example
 * const validation = validateAnnotationCompleteness(annotation, bboxes, 'yes');
 */
export const validateAnnotationCompleteness = (
  annotation: SequenceAnnotation,
  bboxes: readonly SequenceBbox[],
  missedSmokeReview: 'yes' | 'no' | null
): { readonly isValid: boolean; readonly errors: readonly string[] } => {
  const errors: string[] = [];
  
  // Check if all bboxes are annotated
  const completion = calculateAnnotationCompletion(bboxes);
  if (!completion.isComplete) {
    errors.push(`Only ${completion.annotatedBboxes} of ${completion.totalBboxes} bboxes are annotated`);
  }
  
  // Check if missed smoke review is completed
  if (missedSmokeReview === null) {
    errors.push('Missed smoke review is required');
  }
  
  // Check for annotation conflicts
  const conflictBboxes = bboxes.filter((bbox, index) => {
    const state = createBboxAnnotationState(bbox, index);
    return state.hasConflict;
  });
  
  if (conflictBboxes.length > 0) {
    errors.push(`${conflictBboxes.length} bbox(es) have conflicting annotations (both smoke and false positive)`);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Creates navigation state for annotation interface
 * 
 * @pure Function computes navigation state without side effects
 * @param currentIndex - Current item index (0-based)
 * @param totalCount - Total number of items
 * @returns Navigation state object
 * 
 * @example
 * const nav = createAnnotationNavigation(2, 10);
 * // Returns: { currentIndex: 2, totalCount: 10, canNavigateNext: true, ... }
 */
export const createAnnotationNavigation = (currentIndex: number, totalCount: number): AnnotationNavigation => {
  return {
    currentIndex,
    totalCount,
    canNavigateNext: currentIndex < totalCount - 1,
    canNavigatePrevious: currentIndex > 0,
    isFirstItem: currentIndex === 0,
    isLastItem: currentIndex === totalCount - 1
  };
};

/**
 * Calculates next navigation index with bounds checking
 * 
 * @pure Function computes next index without side effects
 * @param currentIndex - Current index
 * @param totalCount - Total number of items
 * @param wrap - Whether to wrap to beginning when at end
 * @returns Next index or null if at boundary without wrapping
 * 
 * @example
 * const nextIndex = calculateNextIndex(8, 10, false); // 9
 * const wrapIndex = calculateNextIndex(9, 10, true); // 0
 */
export const calculateNextIndex = (currentIndex: number, totalCount: number, wrap: boolean = false): number | null => {
  if (currentIndex >= totalCount - 1) {
    return wrap ? 0 : null;
  }
  return currentIndex + 1;
};

/**
 * Calculates previous navigation index with bounds checking
 * 
 * @pure Function computes previous index without side effects
 * @param currentIndex - Current index
 * @param totalCount - Total number of items
 * @param wrap - Whether to wrap to end when at beginning
 * @returns Previous index or null if at boundary without wrapping
 * 
 * @example
 * const prevIndex = calculatePreviousIndex(1, 10, false); // 0
 * const wrapIndex = calculatePreviousIndex(0, 10, true); // 9
 */
export const calculatePreviousIndex = (currentIndex: number, totalCount: number, wrap: boolean = false): number | null => {
  if (currentIndex <= 0) {
    return wrap ? totalCount - 1 : null;
  }
  return currentIndex - 1;
};

/**
 * Groups bboxes by annotation status for display organization
 * 
 * @pure Function organizes bboxes without side effects
 * @param bboxes - Array of sequence bboxes
 * @returns Grouped bboxes by annotation status
 * 
 * @example
 * const grouped = groupBboxesByStatus(bboxes);
 * // Returns: { annotated: [...], unannotated: [...], conflicted: [...] }
 */
export const groupBboxesByStatus = (bboxes: readonly SequenceBbox[]) => {
  const annotated: SequenceBbox[] = [];
  const unannotated: SequenceBbox[] = [];
  const conflicted: SequenceBbox[] = [];
  
  bboxes.forEach((bbox, index) => {
    const state = createBboxAnnotationState(bbox, index);
    
    if (state.hasConflict) {
      conflicted.push(bbox);
    } else if (state.isAnnotated) {
      annotated.push(bbox);
    } else {
      unannotated.push(bbox);
    }
  });
  
  return { annotated, unannotated, conflicted } as const;
};

/**
 * Creates annotation summary for display and reporting
 * 
 * @pure Function summarizes annotation state without side effects
 * @param annotation - Sequence annotation
 * @param bboxes - Array of sequence bboxes
 * @param missedSmokeReview - Current missed smoke review state
 * @returns Annotation summary object
 * 
 * @example
 * const summary = createAnnotationSummary(annotation, bboxes, 'no');
 */
export const createAnnotationSummary = (
  annotation: SequenceAnnotation,
  bboxes: readonly SequenceBbox[],
  missedSmokeReview: 'yes' | 'no' | null
) => {
  const completion = calculateAnnotationCompletion(bboxes);
  const validation = validateAnnotationCompleteness(annotation, bboxes, missedSmokeReview);
  const grouped = groupBboxesByStatus(bboxes);
  
  const smokeCount = bboxes.filter(bbox => bbox.is_smoke).length;
  const falsePositiveCount = bboxes.filter(bbox => bbox.false_positive_types.length > 0).length;
  
  return {
    // Completion metrics
    ...completion,
    
    // Validation status
    ...validation,
    
    // Content summary
    smokeCount,
    falsePositiveCount,
    conflictCount: grouped.conflicted.length,
    
    // Review status
    missedSmokeReview,
    hasMissedSmokeReview: missedSmokeReview !== null,
    
    // Processing stage
    processingStage: annotation.processing_stage,
    isReadyToComplete: validation.isValid && completion.isComplete
  };
};