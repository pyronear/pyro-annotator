/**
 * Refactored Sequence Store using functional programming principles
 * 
 * This version demonstrates:
 * - Pure action creators that return state transformations
 * - Immutable state updates using functional composition
 * - Separation of business logic from state management
 * - Referentially transparent selectors
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Sequence, SequenceFilters, SequenceWithAnnotation, ExtendedSequenceFilters } from '@/types/api';
import { PAGINATION_DEFAULTS } from '@/utils/constants';

/**
 * Annotation workflow state
 */
export interface AnnotationWorkflow {
  readonly sequences: readonly SequenceWithAnnotation[];
  readonly currentIndex: number;
  readonly filters: ExtendedSequenceFilters;
  readonly isActive: boolean;
}

/**
 * Core sequence store state
 */
export interface SequenceStoreState {
  readonly sequences: readonly Sequence[];
  readonly currentSequence: Sequence | null;
  readonly filters: SequenceFilters;
  readonly loading: boolean;
  readonly error: string | null;
  readonly totalCount: number;
  readonly currentPage: number;
  readonly totalPages: number;
  readonly annotationWorkflow: AnnotationWorkflow | null;
}

/**
 * State transformation function type
 */
type StateTransformer<T = void> = (state: SequenceStoreState) => SequenceStoreState;

/**
 * Action creator function type
 */
type ActionCreator<TArgs extends any[] = []> = (...args: TArgs) => StateTransformer;

/**
 * Store actions interface
 */
export interface SequenceStoreActions {
  // Pure action creators that return state transformations
  readonly setSequences: (sequences: readonly Sequence[], totalCount: number, page: number, totalPages: number) => void;
  readonly setCurrentSequence: (sequence: Sequence | null) => void;
  readonly setFilters: (filters: Partial<SequenceFilters>) => void;
  readonly setLoading: (loading: boolean) => void;
  readonly setError: (error: string | null) => void;
  readonly clearError: () => void;
  readonly resetFilters: () => void;
  
  // Workflow actions
  readonly startAnnotationWorkflow: (sequences: readonly SequenceWithAnnotation[], clickedSequenceId: number, filters: ExtendedSequenceFilters) => void;
  readonly getNextSequenceInWorkflow: () => SequenceWithAnnotation | null;
  readonly clearAnnotationWorkflow: () => void;
  readonly navigateToPreviousInWorkflow: () => SequenceWithAnnotation | null;
  readonly navigateToNextInWorkflow: () => SequenceWithAnnotation | null;
  
  // Pure selectors (computed values)
  readonly canNavigatePrevious: () => boolean;
  readonly canNavigateNext: () => boolean;
  readonly getFilteredSequences: () => readonly Sequence[];
  readonly getAnnotatedCount: () => number;
  readonly getPendingCount: () => number;
  readonly getCompletionPercentage: () => number;
}

/**
 * Combined store type
 */
export type SequenceStore = SequenceStoreState & SequenceStoreActions;

/**
 * Initial state using functional composition
 */
const createInitialState = (): SequenceStoreState => ({
  sequences: [],
  currentSequence: null,
  filters: createInitialFilters(),
  loading: false,
  error: null,
  totalCount: 0,
  currentPage: 1,
  totalPages: 1,
  annotationWorkflow: null
});

/**
 * Pure function to create initial filters
 * 
 * @pure Function always returns the same initial state
 */
const createInitialFilters = (): SequenceFilters => ({
  page: PAGINATION_DEFAULTS.PAGE,
  size: PAGINATION_DEFAULTS.SIZE
});

/**
 * Pure action creator for setting sequences
 * 
 * @pure Function returns a pure state transformation
 */
const createSetSequencesAction: ActionCreator<[readonly Sequence[], number, number, number]> = 
  (sequences, totalCount, page, totalPages) => (state) => ({
    ...state,
    sequences,
    totalCount,
    currentPage: page,
    totalPages,
    error: null
  });

/**
 * Pure action creator for setting current sequence
 * 
 * @pure Function returns a pure state transformation
 */
const createSetCurrentSequenceAction: ActionCreator<[Sequence | null]> = 
  (sequence) => (state) => ({
    ...state,
    currentSequence: sequence
  });

/**
 * Pure action creator for setting filters with functional update
 * 
 * @pure Function returns a pure state transformation
 */
const createSetFiltersAction: ActionCreator<[Partial<SequenceFilters>]> = 
  (newFilters) => (state) => ({
    ...state,
    filters: { ...state.filters, ...newFilters }
  });

/**
 * Pure action creator for setting loading state
 * 
 * @pure Function returns a pure state transformation
 */
const createSetLoadingAction: ActionCreator<[boolean]> = 
  (loading) => (state) => ({
    ...state,
    loading
  });

/**
 * Pure action creator for setting error state
 * 
 * @pure Function returns a pure state transformation
 */
const createSetErrorAction: ActionCreator<[string | null]> = 
  (error) => (state) => ({
    ...state,
    error,
    loading: error ? false : state.loading // Clear loading if error occurs
  });

/**
 * Pure action creator for clearing error
 * 
 * @pure Function returns a pure state transformation
 */
const createClearErrorAction: ActionCreator = 
  () => (state) => ({
    ...state,
    error: null
  });

/**
 * Pure action creator for resetting filters
 * 
 * @pure Function returns a pure state transformation
 */
const createResetFiltersAction: ActionCreator = 
  () => (state) => ({
    ...state,
    filters: createInitialFilters()
  });

/**
 * Pure action creator for starting annotation workflow
 * 
 * @pure Function returns a pure state transformation
 */
const createStartWorkflowAction: ActionCreator<[readonly SequenceWithAnnotation[], number, ExtendedSequenceFilters]> = 
  (sequences, clickedSequenceId, filters) => (state) => {
    const clickedIndex = sequences.findIndex(seq => seq.id === clickedSequenceId);
    
    return {
      ...state,
      annotationWorkflow: {
        sequences,
        currentIndex: Math.max(0, clickedIndex),
        filters,
        isActive: true
      }
    };
  };

/**
 * Pure action creator for clearing workflow
 * 
 * @pure Function returns a pure state transformation
 */
const createClearWorkflowAction: ActionCreator = 
  () => (state) => ({
    ...state,
    annotationWorkflow: null
  });

/**
 * Pure action creator for navigating to previous workflow item
 * 
 * @pure Function returns a pure state transformation
 */
const createNavigatePreviousAction: ActionCreator = 
  () => (state) => {
    if (!state.annotationWorkflow || state.annotationWorkflow.currentIndex <= 0) {
      return state;
    }
    
    return {
      ...state,
      annotationWorkflow: {
        ...state.annotationWorkflow,
        currentIndex: state.annotationWorkflow.currentIndex - 1
      }
    };
  };

/**
 * Pure action creator for navigating to next workflow item
 * 
 * @pure Function returns a pure state transformation
 */
const createNavigateNextAction: ActionCreator = 
  () => (state) => {
    if (!state.annotationWorkflow || 
        state.annotationWorkflow.currentIndex >= state.annotationWorkflow.sequences.length - 1) {
      return state;
    }
    
    return {
      ...state,
      annotationWorkflow: {
        ...state.annotationWorkflow,
        currentIndex: state.annotationWorkflow.currentIndex + 1
      }
    };
  };

/**
 * Pure selector for checking if can navigate previous
 * 
 * @pure Function always returns same result for same state
 */
const canNavigatePrevious = (state: SequenceStoreState): boolean => {
  return Boolean(state.annotationWorkflow && state.annotationWorkflow.currentIndex > 0);
};

/**
 * Pure selector for checking if can navigate next
 * 
 * @pure Function always returns same result for same state
 */
const canNavigateNext = (state: SequenceStoreState): boolean => {
  return Boolean(
    state.annotationWorkflow && 
    state.annotationWorkflow.currentIndex < state.annotationWorkflow.sequences.length - 1
  );
};

/**
 * Pure selector for getting current workflow sequence
 * 
 * @pure Function always returns same result for same state
 */
const getCurrentWorkflowSequence = (state: SequenceStoreState): SequenceWithAnnotation | null => {
  if (!state.annotationWorkflow) return null;
  
  const { sequences, currentIndex } = state.annotationWorkflow;
  return sequences[currentIndex] || null;
};

/**
 * Pure selector for getting filtered sequences
 * 
 * @pure Function always returns same result for same state  
 */
const getFilteredSequences = (state: SequenceStoreState): readonly Sequence[] => {
  // For now, return all sequences. In a real implementation,
  // this would apply client-side filtering based on state.filters
  return state.sequences;
};

/**
 * Pure selector for getting annotated count
 * 
 * @pure Function always returns same result for same state
 */
const getAnnotatedCount = (state: SequenceStoreState): number => {
  // This would need to be implemented based on actual annotation status
  // For now, return 0 as placeholder
  return 0;
};

/**
 * Pure selector for getting pending count
 * 
 * @pure Function always returns same result for same state
 */
const getPendingCount = (state: SequenceStoreState): number => {
  return state.sequences.length - getAnnotatedCount(state);
};

/**
 * Pure selector for calculating completion percentage
 * 
 * @pure Function always returns same result for same state
 */
const getCompletionPercentage = (state: SequenceStoreState): number => {
  const total = state.sequences.length;
  if (total === 0) return 0;
  
  const annotated = getAnnotatedCount(state);
  return Math.round((annotated / total) * 100);
};

/**
 * Create the Zustand store with functional actions
 */
export const useSequenceStoreRefactored = create<SequenceStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      ...createInitialState(),
      
      // Actions that use pure state transformations
      setSequences: (sequences, totalCount, page, totalPages) => {
        const transform = createSetSequencesAction(sequences, totalCount, page, totalPages);
        set(transform, false, 'setSequences');
      },
      
      setCurrentSequence: (sequence) => {
        const transform = createSetCurrentSequenceAction(sequence);
        set(transform, false, 'setCurrentSequence');
      },
      
      setFilters: (filters) => {
        const transform = createSetFiltersAction(filters);
        set(transform, false, 'setFilters');
      },
      
      setLoading: (loading) => {
        const transform = createSetLoadingAction(loading);
        set(transform, false, 'setLoading');
      },
      
      setError: (error) => {
        const transform = createSetErrorAction(error);
        set(transform, false, 'setError');
      },
      
      clearError: () => {
        const transform = createClearErrorAction();
        set(transform, false, 'clearError');
      },
      
      resetFilters: () => {
        const transform = createResetFiltersAction();
        set(transform, false, 'resetFilters');
      },
      
      // Workflow actions
      startAnnotationWorkflow: (sequences, clickedSequenceId, filters) => {
        const transform = createStartWorkflowAction(sequences, clickedSequenceId, filters);
        set(transform, false, 'startAnnotationWorkflow');
      },
      
      getNextSequenceInWorkflow: () => {
        const state = get();
        return getCurrentWorkflowSequence(state);
      },
      
      clearAnnotationWorkflow: () => {
        const transform = createClearWorkflowAction();
        set(transform, false, 'clearAnnotationWorkflow');
      },
      
      navigateToPreviousInWorkflow: () => {
        const transform = createNavigatePreviousAction();
        set(transform, false, 'navigateToPreviousInWorkflow');
        return getCurrentWorkflowSequence(get());
      },
      
      navigateToNextInWorkflow: () => {
        const transform = createNavigateNextAction();
        set(transform, false, 'navigateToNextInWorkflow');
        return getCurrentWorkflowSequence(get());
      },
      
      // Pure selectors
      canNavigatePrevious: () => canNavigatePrevious(get()),
      canNavigateNext: () => canNavigateNext(get()),
      getFilteredSequences: () => getFilteredSequences(get()),
      getAnnotatedCount: () => getAnnotatedCount(get()),
      getPendingCount: () => getPendingCount(get()),
      getCompletionPercentage: () => getCompletionPercentage(get())
    }),
    {
      name: 'sequence-store-refactored'
    }
  )
);

/**
 * Hook for accessing just the state portion (useful for pure components)
 * 
 * @example
 * const state = useSequenceStoreState();
 * const filteredSequences = getFilteredSequences(state);
 */
export const useSequenceStoreState = () => {
  return useSequenceStoreRefactored((state) => ({
    sequences: state.sequences,
    currentSequence: state.currentSequence,
    filters: state.filters,
    loading: state.loading,
    error: state.error,
    totalCount: state.totalCount,
    currentPage: state.currentPage,
    totalPages: state.totalPages,
    annotationWorkflow: state.annotationWorkflow
  }));
};

/**
 * Hook for accessing just the actions (useful for event handlers)
 * 
 * @example
 * const actions = useSequenceStoreActions();
 * actions.setSequences(newSequences, total, page, pages);
 */
export const useSequenceStoreActions = () => {
  return useSequenceStoreRefactored((state) => ({
    setSequences: state.setSequences,
    setCurrentSequence: state.setCurrentSequence,
    setFilters: state.setFilters,
    setLoading: state.setLoading,
    setError: state.setError,
    clearError: state.clearError,
    resetFilters: state.resetFilters,
    startAnnotationWorkflow: state.startAnnotationWorkflow,
    getNextSequenceInWorkflow: state.getNextSequenceInWorkflow,
    clearAnnotationWorkflow: state.clearAnnotationWorkflow,
    navigateToPreviousInWorkflow: state.navigateToPreviousInWorkflow,
    navigateToNextInWorkflow: state.navigateToNextInWorkflow,
    canNavigatePrevious: state.canNavigatePrevious,
    canNavigateNext: state.canNavigateNext,
    getFilteredSequences: state.getFilteredSequences,
    getAnnotatedCount: state.getAnnotatedCount,
    getPendingCount: state.getPendingCount,
    getCompletionPercentage: state.getCompletionPercentage
  }));
};

/**
 * Exported pure selector functions for use outside of React components
 */
export const selectors = {
  canNavigatePrevious,
  canNavigateNext,
  getCurrentWorkflowSequence,
  getFilteredSequences,
  getAnnotatedCount,
  getPendingCount,
  getCompletionPercentage
} as const;