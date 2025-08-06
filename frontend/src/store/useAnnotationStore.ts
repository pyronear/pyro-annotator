import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { SequenceAnnotation, SequenceBbox } from '@/types/api';
import { AnnotationLabel } from '@/utils/constants';

interface AnnotationProgress {
  total: number;
  completed: number;
  percentage: number;
}

interface AnnotationStore {
  // State
  currentAnnotation: SequenceAnnotation | null;
  annotations: Map<number, SequenceAnnotation>;
  progress: AnnotationProgress;
  loading: boolean;
  error: string | null;
  
  // Current annotation work
  currentSequenceId: number | null;
  currentBboxIndex: number;
  selectedLabels: AnnotationLabel[];
  missedSmoke: boolean;
  
  // GIF URLs
  gifUrls: Map<number, { main?: string; crop?: string }>;

  // Actions
  setCurrentAnnotation: (annotation: SequenceAnnotation | null) => void;
  setAnnotations: (annotations: SequenceAnnotation[]) => void;
  addAnnotation: (annotation: SequenceAnnotation) => void;
  updateAnnotation: (id: number, updates: Partial<SequenceAnnotation>) => void;
  removeAnnotation: (id: number) => void;
  
  setProgress: (progress: AnnotationProgress) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;

  // Current work actions
  startAnnotating: (sequenceId: number) => void;
  setCurrentBboxIndex: (index: number) => void;
  setSelectedLabels: (labels: AnnotationLabel[]) => void;
  setMissedSmoke: (missed: boolean) => void;
  nextBbox: () => void;
  previousBbox: () => void;
  resetCurrentWork: () => void;

  // GIF management
  setGifUrls: (annotationId: number, urls: { main?: string; crop?: string }) => void;
  getGifUrls: (annotationId: number) => { main?: string; crop?: string } | undefined;

  // Computed
  getCurrentBbox: () => SequenceBbox | null;
  hasUnsavedChanges: () => boolean;
  getAnnotationById: (id: number) => SequenceAnnotation | undefined;
}

export const useAnnotationStore = create<AnnotationStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      currentAnnotation: null,
      annotations: new Map(),
      progress: { total: 0, completed: 0, percentage: 0 },
      loading: false,
      error: null,
      
      currentSequenceId: null,
      currentBboxIndex: 0,
      selectedLabels: [],
      missedSmoke: false,
      
      gifUrls: new Map(),

      // Actions
      setCurrentAnnotation: (annotation) =>
        set(
          { currentAnnotation: annotation },
          false,
          'setCurrentAnnotation'
        ),

      setAnnotations: (annotations) =>
        set(
          {
            annotations: new Map(annotations.map(ann => [ann.id, ann])),
          },
          false,
          'setAnnotations'
        ),

      addAnnotation: (annotation) =>
        set(
          (state) => {
            const newAnnotations = new Map(state.annotations);
            newAnnotations.set(annotation.id, annotation);
            return { annotations: newAnnotations };
          },
          false,
          'addAnnotation'
        ),

      updateAnnotation: (id, updates) =>
        set(
          (state) => {
            const newAnnotations = new Map(state.annotations);
            const existing = newAnnotations.get(id);
            if (existing) {
              newAnnotations.set(id, { ...existing, ...updates });
            }
            return { annotations: newAnnotations };
          },
          false,
          'updateAnnotation'
        ),

      removeAnnotation: (id) =>
        set(
          (state) => {
            const newAnnotations = new Map(state.annotations);
            newAnnotations.delete(id);
            return { annotations: newAnnotations };
          },
          false,
          'removeAnnotation'
        ),

      setProgress: (progress) =>
        set({ progress }, false, 'setProgress'),

      setLoading: (loading) =>
        set({ loading }, false, 'setLoading'),

      setError: (error) =>
        set({ error }, false, 'setError'),

      clearError: () =>
        set({ error: null }, false, 'clearError'),

      // Current work actions
      startAnnotating: (sequenceId) =>
        set(
          {
            currentSequenceId: sequenceId,
            currentBboxIndex: 0,
            selectedLabels: [],
            missedSmoke: false,
            error: null,
          },
          false,
          'startAnnotating'
        ),

      setCurrentBboxIndex: (index) =>
        set({ currentBboxIndex: index }, false, 'setCurrentBboxIndex'),

      setSelectedLabels: (labels) =>
        set({ selectedLabels: labels }, false, 'setSelectedLabels'),

      setMissedSmoke: (missed) =>
        set({ missedSmoke: missed }, false, 'setMissedSmoke'),

      nextBbox: () =>
        set(
          (state) => {
            const currentAnnotation = state.currentAnnotation;
            if (!currentAnnotation) return state;
            
            const maxIndex = currentAnnotation.sequences_bbox.length - 1;
            const nextIndex = Math.min(state.currentBboxIndex + 1, maxIndex);
            
            return {
              currentBboxIndex: nextIndex,
              selectedLabels: [], // Reset labels for next bbox
            };
          },
          false,
          'nextBbox'
        ),

      previousBbox: () =>
        set(
          (state) => ({
            currentBboxIndex: Math.max(state.currentBboxIndex - 1, 0),
            selectedLabels: [],
          }),
          false,
          'previousBbox'
        ),

      resetCurrentWork: () =>
        set(
          {
            currentSequenceId: null,
            currentBboxIndex: 0,
            selectedLabels: [],
            missedSmoke: false,
          },
          false,
          'resetCurrentWork'
        ),

      // GIF management
      setGifUrls: (annotationId, urls) =>
        set(
          (state) => {
            const newGifUrls = new Map(state.gifUrls);
            newGifUrls.set(annotationId, urls);
            return { gifUrls: newGifUrls };
          },
          false,
          'setGifUrls'
        ),

      getGifUrls: (annotationId) => {
        const { gifUrls } = get();
        return gifUrls.get(annotationId);
      },

      // Computed
      getCurrentBbox: () => {
        const { currentAnnotation, currentBboxIndex } = get();
        if (!currentAnnotation || currentBboxIndex >= currentAnnotation.sequences_bbox.length) {
          return null;
        }
        return currentAnnotation.sequences_bbox[currentBboxIndex];
      },

      hasUnsavedChanges: () => {
        const { selectedLabels, missedSmoke } = get();
        return selectedLabels.length > 0 || missedSmoke;
      },

      getAnnotationById: (id) => {
        const { annotations } = get();
        return annotations.get(id);
      },
    }),
    {
      name: 'annotation-store',
    }
  )
);