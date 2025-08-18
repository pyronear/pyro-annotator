/**
 * Custom hook for managing annotation workflow state and operations
 * 
 * This hook provides complete annotation workflow management using pure functions
 * and functional state management patterns. It manages state at the system edge
 * while delegating business logic to pure utility functions.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SequenceAnnotation, SequenceBbox, FalsePositiveType } from '@/types/api';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import {
  AnnotationCompletion,
  AnnotationNavigation,
  BboxAnnotationState,
  calculateAnnotationCompletion,
  createAnnotationNavigation,
  createAnnotationSummary,
  validateAnnotationCompleteness,
  updateBboxAnnotation,
  initializeCleanBbox,
  getInitialMissedSmokeReview,
  calculateNextIndex,
  calculatePreviousIndex
} from '@/utils/annotation-state';

/**
 * Annotation workflow state interface
 */
export interface AnnotationWorkflowState {
  // Current annotation data
  readonly annotation: SequenceAnnotation | null;
  readonly bboxes: readonly SequenceBbox[];
  readonly currentBboxIndex: number;
  readonly currentBbox: SequenceBbox | null;
  
  // Navigation state
  readonly navigation: AnnotationNavigation;
  readonly canNavigateNext: boolean;
  readonly canNavigatePrevious: boolean;
  
  // Progress tracking
  readonly completion: AnnotationCompletion;
  readonly validationErrors: readonly string[];
  readonly hasChanges: boolean;
  
  // UI state
  readonly missedSmokeReview: 'yes' | 'no' | null;
  readonly isLoading: boolean;
  readonly isSubmitting: boolean;
  readonly error: string | null;
}

/**
 * Annotation workflow actions interface
 */
export interface AnnotationWorkflowActions {
  // Navigation actions
  readonly navigateToSequence: (sequenceId: number) => void;
  readonly navigateNext: () => void;
  readonly navigatePrevious: () => void;
  readonly navigateToFirst: () => void;
  readonly navigateToLast: () => void;
  
  // Bbox navigation actions
  readonly navigateToBbox: (bboxIndex: number) => void;
  readonly navigateNextBbox: () => void;
  readonly navigatePreviousBbox: () => void;
  
  // Annotation actions
  readonly updateSmokeAnnotation: (bboxIndex: number, isSmoke: boolean) => void;
  readonly updateFalsePositiveAnnotation: (bboxIndex: number, types: readonly FalsePositiveType[]) => void;
  readonly updateMissedSmokeReview: (review: 'yes' | 'no' | null) => void;
  readonly resetBboxAnnotation: (bboxIndex: number) => void;
  readonly resetAllAnnotations: () => void;
  
  // Workflow actions
  readonly saveAnnotation: () => Promise<void>;
  readonly completeAnnotation: () => Promise<void>;
  readonly refresh: () => void;
}

/**
 * Combined hook return type
 */
export interface UseAnnotationWorkflowReturn {
  readonly state: AnnotationWorkflowState;
  readonly actions: AnnotationWorkflowActions;
}

/**
 * Hook configuration options
 */
export interface UseAnnotationWorkflowOptions {
  readonly sequenceId: number;
  readonly initialBboxIndex?: number;
  readonly autoSave?: boolean;
  readonly autoSaveDelay?: number;
  readonly onNavigationChange?: (sequenceId: number, bboxIndex: number) => void;
  readonly onAnnotationComplete?: (annotation: SequenceAnnotation) => void;
}

/**
 * Custom hook for managing annotation workflow
 * 
 * Provides complete annotation workflow management with pure functional patterns,
 * state management at system edges, and comprehensive validation.
 * 
 * @param options - Workflow configuration options
 * @returns Workflow state and actions
 * 
 * @example
 * const { state, actions } = useAnnotationWorkflow({
 *   sequenceId: 123,
 *   initialBboxIndex: 0,
 *   autoSave: true,
 *   onAnnotationComplete: handleComplete
 * });
 * 
 * // Navigate to next bbox
 * actions.navigateNextBbox();
 * 
 * // Update annotation
 * actions.updateSmokeAnnotation(0, true);
 * 
 * // Complete annotation
 * await actions.completeAnnotation();
 */
export const useAnnotationWorkflow = (options: UseAnnotationWorkflowOptions): UseAnnotationWorkflowReturn => {
  const {
    sequenceId,
    initialBboxIndex = 0,
    autoSave = false,
    autoSaveDelay = 2000,
    onNavigationChange,
    onAnnotationComplete
  } = options;

  const queryClient = useQueryClient();

  // Local state for UI-specific values
  const [currentBboxIndex, setCurrentBboxIndex] = useState(initialBboxIndex);
  const [localBboxes, setLocalBboxes] = useState<SequenceBbox[]>([]);
  const [missedSmokeReview, setMissedSmokeReview] = useState<'yes' | 'no' | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch sequence annotation
  const { 
    data: annotation, 
    isLoading, 
    error: fetchError,
    refetch: refreshAnnotation 
  } = useQuery({
    queryKey: [QUERY_KEYS.SEQUENCE_ANNOTATIONS, sequenceId],
    queryFn: async () => {
      const response = await apiClient.getSequenceAnnotationBySequenceId(sequenceId);
      return response.data;
    },
    enabled: !!sequenceId
  });

  // Initialize local state when annotation loads
  useEffect(() => {
    if (annotation) {
      setLocalBboxes(annotation.annotation.sequences_bbox);
      setMissedSmokeReview(getInitialMissedSmokeReview(annotation));
      setHasChanges(false);
    }
  }, [annotation]);

  // Save annotation mutation
  const saveAnnotationMutation = useMutation({
    mutationFn: async (updatedAnnotation: Partial<SequenceAnnotation>) => {
      if (!annotation?.id) throw new Error('No annotation to update');
      
      const response = await apiClient.updateSequenceAnnotation(annotation.id, updatedAnnotation);
      return response.data;
    },
    onSuccess: (savedAnnotation) => {
      queryClient.setQueryData([QUERY_KEYS.SEQUENCE_ANNOTATIONS, sequenceId], savedAnnotation);
      setHasChanges(false);
    }
  });

  // Complete annotation mutation
  const completeAnnotationMutation = useMutation({
    mutationFn: async () => {
      if (!annotation) throw new Error('No annotation to complete');
      
      const updatedAnnotation = {
        ...annotation,
        annotation: { sequences_bbox: localBboxes },
        has_missed_smoke: missedSmokeReview === 'yes',
        processing_stage: 'annotated' as const
      };
      
      const response = await apiClient.updateSequenceAnnotation(annotation.id, updatedAnnotation);
      return response.data;
    },
    onSuccess: (completedAnnotation) => {
      queryClient.setQueryData([QUERY_KEYS.SEQUENCE_ANNOTATIONS, sequenceId], completedAnnotation);
      setHasChanges(false);
      if (onAnnotationComplete) {
        onAnnotationComplete(completedAnnotation);
      }
    }
  });

  // Computed state values using pure utilities
  const currentBbox = localBboxes[currentBboxIndex] || null;
  const completion = calculateAnnotationCompletion(localBboxes);
  const navigation = createAnnotationNavigation(currentBboxIndex, localBboxes.length);
  
  const validationResult = annotation 
    ? validateAnnotationCompleteness(annotation, localBboxes, missedSmokeReview)
    : { isValid: false, errors: ['Annotation not loaded'] };

  const canNavigateNext = calculateNextIndex(currentBboxIndex, localBboxes.length, false) !== null;
  const canNavigatePrevious = calculatePreviousIndex(currentBboxIndex, localBboxes.length, false) !== null;

  // Navigation actions
  const navigateToSequence = useCallback((newSequenceId: number) => {
    if (onNavigationChange) {
      onNavigationChange(newSequenceId, 0);
    }
  }, [onNavigationChange]);

  const navigateNext = useCallback(() => {
    const nextIndex = calculateNextIndex(currentBboxIndex, localBboxes.length, false);
    if (nextIndex !== null) {
      setCurrentBboxIndex(nextIndex);
      if (onNavigationChange) {
        onNavigationChange(sequenceId, nextIndex);
      }
    }
  }, [currentBboxIndex, localBboxes.length, sequenceId, onNavigationChange]);

  const navigatePrevious = useCallback(() => {
    const prevIndex = calculatePreviousIndex(currentBboxIndex, localBboxes.length, false);
    if (prevIndex !== null) {
      setCurrentBboxIndex(prevIndex);
      if (onNavigationChange) {
        onNavigationChange(sequenceId, prevIndex);
      }
    }
  }, [currentBboxIndex, localBboxes.length, sequenceId, onNavigationChange]);

  const navigateToFirst = useCallback(() => {
    if (localBboxes.length > 0) {
      setCurrentBboxIndex(0);
      if (onNavigationChange) {
        onNavigationChange(sequenceId, 0);
      }
    }
  }, [localBboxes.length, sequenceId, onNavigationChange]);

  const navigateToLast = useCallback(() => {
    if (localBboxes.length > 0) {
      const lastIndex = localBboxes.length - 1;
      setCurrentBboxIndex(lastIndex);
      if (onNavigationChange) {
        onNavigationChange(sequenceId, lastIndex);
      }
    }
  }, [localBboxes.length, sequenceId, onNavigationChange]);

  // Bbox navigation actions
  const navigateToBbox = useCallback((bboxIndex: number) => {
    if (bboxIndex >= 0 && bboxIndex < localBboxes.length) {
      setCurrentBboxIndex(bboxIndex);
      if (onNavigationChange) {
        onNavigationChange(sequenceId, bboxIndex);
      }
    }
  }, [localBboxes.length, sequenceId, onNavigationChange]);

  const navigateNextBbox = navigateNext;
  const navigatePreviousBbox = navigatePrevious;

  // Annotation update actions using pure functions
  const updateSmokeAnnotation = useCallback((bboxIndex: number, isSmoke: boolean) => {
    if (bboxIndex >= 0 && bboxIndex < localBboxes.length) {
      const currentBbox = localBboxes[bboxIndex];
      const updatedBbox = updateBboxAnnotation(
        currentBbox,
        isSmoke,
        isSmoke ? [] : currentBbox.false_positive_types // Clear false positives if smoke
      );
      
      const newBboxes = localBboxes.map((bbox, index) => 
        index === bboxIndex ? updatedBbox : bbox
      );
      
      setLocalBboxes(newBboxes);
      setHasChanges(true);
    }
  }, [localBboxes]);

  const updateFalsePositiveAnnotation = useCallback((
    bboxIndex: number, 
    types: readonly FalsePositiveType[]
  ) => {
    if (bboxIndex >= 0 && bboxIndex < localBboxes.length) {
      const currentBbox = localBboxes[bboxIndex];
      const updatedBbox = updateBboxAnnotation(
        currentBbox,
        types.length > 0 ? false : currentBbox.is_smoke, // Clear smoke if false positives
        types
      );
      
      const newBboxes = localBboxes.map((bbox, index) => 
        index === bboxIndex ? updatedBbox : bbox
      );
      
      setLocalBboxes(newBboxes);
      setHasChanges(true);
    }
  }, [localBboxes]);

  const updateMissedSmokeReview = useCallback((review: 'yes' | 'no' | null) => {
    setMissedSmokeReview(review);
    setHasChanges(true);
  }, []);

  const resetBboxAnnotation = useCallback((bboxIndex: number) => {
    if (bboxIndex >= 0 && bboxIndex < localBboxes.length) {
      const currentBbox = localBboxes[bboxIndex];
      const cleanBbox = initializeCleanBbox(currentBbox);
      
      const newBboxes = localBboxes.map((bbox, index) => 
        index === bboxIndex ? cleanBbox : bbox
      );
      
      setLocalBboxes(newBboxes);
      setHasChanges(true);
    }
  }, [localBboxes]);

  const resetAllAnnotations = useCallback(() => {
    const cleanBboxes = localBboxes.map(initializeCleanBbox);
    setLocalBboxes(cleanBboxes);
    setMissedSmokeReview(null);
    setHasChanges(true);
  }, [localBboxes]);

  // Workflow actions
  const saveAnnotation = useCallback(async () => {
    if (!annotation || !hasChanges) return;
    
    const updatedAnnotation = {
      annotation: { sequences_bbox: localBboxes },
      has_missed_smoke: missedSmokeReview === 'yes'
    };
    
    await saveAnnotationMutation.mutateAsync(updatedAnnotation);
  }, [annotation, hasChanges, localBboxes, missedSmokeReview, saveAnnotationMutation]);

  const completeAnnotation = useCallback(async () => {
    if (!validationResult.isValid) {
      throw new Error(`Validation failed: ${validationResult.errors.join(', ')}`);
    }
    
    await completeAnnotationMutation.mutateAsync();
  }, [validationResult, completeAnnotationMutation]);

  const refresh = useCallback(() => {
    refreshAnnotation();
  }, [refreshAnnotation]);

  // Auto-save functionality
  useEffect(() => {
    if (!autoSave || !hasChanges) return;
    
    const timeoutId = setTimeout(() => {
      saveAnnotation().catch(console.error);
    }, autoSaveDelay);
    
    return () => clearTimeout(timeoutId);
  }, [autoSave, hasChanges, autoSaveDelay, saveAnnotation]);

  // Memoized state object
  const state: AnnotationWorkflowState = useMemo(() => ({
    annotation,
    bboxes: localBboxes,
    currentBboxIndex,
    currentBbox,
    navigation,
    canNavigateNext,
    canNavigatePrevious,
    completion,
    validationErrors: validationResult.errors,
    hasChanges,
    missedSmokeReview,
    isLoading,
    isSubmitting: saveAnnotationMutation.isPending || completeAnnotationMutation.isPending,
    error: fetchError?.message || saveAnnotationMutation.error?.message || completeAnnotationMutation.error?.message || null
  }), [
    annotation,
    localBboxes,
    currentBboxIndex,
    currentBbox,
    navigation,
    canNavigateNext,
    canNavigatePrevious,
    completion,
    validationResult.errors,
    hasChanges,
    missedSmokeReview,
    isLoading,
    saveAnnotationMutation.isPending,
    completeAnnotationMutation.isPending,
    fetchError,
    saveAnnotationMutation.error,
    completeAnnotationMutation.error
  ]);

  // Memoized actions object
  const actions: AnnotationWorkflowActions = useMemo(() => ({
    navigateToSequence,
    navigateNext,
    navigatePrevious,
    navigateToFirst,
    navigateToLast,
    navigateToBbox,
    navigateNextBbox,
    navigatePreviousBbox,
    updateSmokeAnnotation,
    updateFalsePositiveAnnotation,
    updateMissedSmokeReview,
    resetBboxAnnotation,
    resetAllAnnotations,
    saveAnnotation,
    completeAnnotation,
    refresh
  }), [
    navigateToSequence,
    navigateNext,
    navigatePrevious,
    navigateToFirst,
    navigateToLast,
    navigateToBbox,
    navigateNextBbox,
    navigatePreviousBbox,
    updateSmokeAnnotation,
    updateFalsePositiveAnnotation,
    updateMissedSmokeReview,
    resetBboxAnnotation,
    resetAllAnnotations,
    saveAnnotation,
    completeAnnotation,
    refresh
  ]);

  return { state, actions };
};