import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Sequence, SequenceFilters, SequenceWithAnnotation, ExtendedSequenceFilters } from '@/types/api';
import { PAGINATION_DEFAULTS } from '@/utils/constants';

interface AnnotationWorkflow {
  sequences: SequenceWithAnnotation[];
  currentIndex: number;
  filters: ExtendedSequenceFilters;
  isActive: boolean;
}

interface SequenceStore {
  // State
  sequences: Sequence[];
  currentSequence: Sequence | null;
  filters: SequenceFilters;
  loading: boolean;
  error: string | null;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  
  // Annotation Workflow State
  annotationWorkflow: AnnotationWorkflow | null;

  // Actions
  setSequences: (sequences: Sequence[], totalCount: number, page: number, totalPages: number) => void;
  setCurrentSequence: (sequence: Sequence | null) => void;
  setFilters: (filters: SequenceFilters) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  resetFilters: () => void;
  
  // Workflow Actions
  startAnnotationWorkflow: (sequences: SequenceWithAnnotation[], clickedSequenceId: number, filters: ExtendedSequenceFilters) => void;
  getNextSequenceInWorkflow: () => SequenceWithAnnotation | null;
  clearAnnotationWorkflow: () => void;
  
  // Manual Navigation
  navigateToPreviousInWorkflow: () => SequenceWithAnnotation | null;
  navigateToNextInWorkflow: () => SequenceWithAnnotation | null;
  canNavigatePrevious: () => boolean;
  canNavigateNext: () => boolean;
  
  // Computed
  getFilteredSequences: () => Sequence[];
  getAnnotatedCount: () => number;
  getPendingCount: () => number;
  getCompletionPercentage: () => number;
}

const initialFilters: SequenceFilters = {
  page: PAGINATION_DEFAULTS.PAGE,
  size: PAGINATION_DEFAULTS.SIZE,
};

export const useSequenceStore = create<SequenceStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      sequences: [],
      currentSequence: null,
      filters: initialFilters,
      loading: false,
      error: null,
      totalCount: 0,
      currentPage: 1,
      totalPages: 1,
      
      // Workflow state
      annotationWorkflow: null,

      // Actions
      setSequences: (sequences, totalCount, page, totalPages) =>
        set(
          {
            sequences,
            totalCount,
            currentPage: page,
            totalPages,
            error: null,
          },
          false,
          'setSequences'
        ),

      setCurrentSequence: (sequence) =>
        set(
          { currentSequence: sequence },
          false,
          'setCurrentSequence'
        ),

      setFilters: (filters) =>
        set(
          (state) => ({
            filters: { ...state.filters, ...filters },
          }),
          false,
          'setFilters'
        ),

      setLoading: (loading) =>
        set({ loading }, false, 'setLoading'),

      setError: (error) =>
        set({ error }, false, 'setError'),

      clearError: () =>
        set({ error: null }, false, 'clearError'),

      resetFilters: () =>
        set({ filters: initialFilters }, false, 'resetFilters'),

      // Workflow Actions
      startAnnotationWorkflow: (sequences, clickedSequenceId, filters) => {
        const currentIndex = sequences.findIndex(seq => seq.id === clickedSequenceId);
        if (currentIndex !== -1) {
          set({
            annotationWorkflow: {
              sequences,
              currentIndex,
              filters,
              isActive: true,
            }
          }, false, 'startAnnotationWorkflow');
        }
      },

      getNextSequenceInWorkflow: () => {
        const { annotationWorkflow } = get();
        if (!annotationWorkflow || !annotationWorkflow.isActive) {
          return null;
        }
        
        const nextIndex = annotationWorkflow.currentIndex + 1;
        if (nextIndex < annotationWorkflow.sequences.length) {
          // Update current index to next sequence
          set({
            annotationWorkflow: {
              ...annotationWorkflow,
              currentIndex: nextIndex,
            }
          }, false, 'moveToNextInWorkflow');
          
          return annotationWorkflow.sequences[nextIndex];
        }
        
        // No more sequences in workflow
        return null;
      },

      clearAnnotationWorkflow: () =>
        set({ annotationWorkflow: null }, false, 'clearAnnotationWorkflow'),

      // Manual Navigation Functions
      navigateToPreviousInWorkflow: () => {
        const { annotationWorkflow } = get();
        if (!annotationWorkflow || !annotationWorkflow.isActive) {
          return null;
        }
        
        const previousIndex = annotationWorkflow.currentIndex - 1;
        if (previousIndex >= 0) {
          // Update current index to previous sequence
          set({
            annotationWorkflow: {
              ...annotationWorkflow,
              currentIndex: previousIndex,
            }
          }, false, 'navigateToPreviousInWorkflow');
          
          return annotationWorkflow.sequences[previousIndex];
        }
        
        // Already at first sequence
        return null;
      },

      navigateToNextInWorkflow: () => {
        const { annotationWorkflow } = get();
        if (!annotationWorkflow || !annotationWorkflow.isActive) {
          return null;
        }
        
        const nextIndex = annotationWorkflow.currentIndex + 1;
        if (nextIndex < annotationWorkflow.sequences.length) {
          // Update current index to next sequence
          set({
            annotationWorkflow: {
              ...annotationWorkflow,
              currentIndex: nextIndex,
            }
          }, false, 'navigateToNextInWorkflow');
          
          return annotationWorkflow.sequences[nextIndex];
        }
        
        // Already at last sequence
        return null;
      },

      canNavigatePrevious: () => {
        const { annotationWorkflow } = get();
        return !!(annotationWorkflow?.isActive && annotationWorkflow.currentIndex > 0);
      },

      canNavigateNext: () => {
        const { annotationWorkflow } = get();
        return !!(annotationWorkflow?.isActive && annotationWorkflow.currentIndex < annotationWorkflow.sequences.length - 1);
      },

      // Computed values
      getFilteredSequences: () => {
        const { sequences } = get();
        return sequences;
      },

      getAnnotatedCount: () => {
        // TODO: Implement based on actual annotation data
        return 0;
      },

      getPendingCount: () => {
        const { sequences } = get();
        // TODO: Implement based on actual annotation data
        return sequences.length;
      },

      getCompletionPercentage: () => {
        const { sequences } = get();
        if (sequences.length === 0) return 0;
        // TODO: Implement based on actual annotation data
        const annotatedCount = 0;
        return Math.round((annotatedCount / sequences.length) * 100);
      },
    }),
    {
      name: 'sequence-store',
    }
  )
);