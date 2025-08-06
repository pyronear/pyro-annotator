import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';

export interface ProcessingStageStats {
  imported: number;
  ready_to_annotate: number;
  annotated: number;
}

export interface AnnotationStats {
  totalSequences: number;
  annotatedSequences: number;
  pendingSequences: number;
  completionPercentage: number;
  processingStages: ProcessingStageStats;
  isLoading: boolean;
  error: string | null;
}

export function useAnnotationStats(): AnnotationStats {
  // Fetch total sequences count (using size=1 to minimize data transfer)
  const { 
    data: sequencesData, 
    isLoading: sequencesLoading, 
    error: sequencesError 
  } = useQuery({
    queryKey: [...QUERY_KEYS.ANNOTATION_STATS, 'sequences'],
    queryFn: () => apiClient.getSequences({ size: 1, page: 1 }),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Fetch total annotations count (using size=1 to minimize data transfer)
  const { 
    data: annotationsData, 
    isLoading: annotationsLoading, 
    error: annotationsError 
  } = useQuery({
    queryKey: [...QUERY_KEYS.ANNOTATION_STATS, 'annotations'],
    queryFn: () => apiClient.getSequenceAnnotations({ size: 1, page: 1 }),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Fetch annotations by processing stage
  const { 
    data: importedData, 
    isLoading: importedLoading 
  } = useQuery({
    queryKey: [...QUERY_KEYS.ANNOTATION_STATS, 'imported'],
    queryFn: () => apiClient.getSequenceAnnotations({ 
      processing_stage: 'imported', 
      size: 1, 
      page: 1 
    }),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
  });

  const { 
    data: readyToAnnotateData, 
    isLoading: readyToAnnotateLoading 
  } = useQuery({
    queryKey: [...QUERY_KEYS.ANNOTATION_STATS, 'ready_to_annotate'],
    queryFn: () => apiClient.getSequenceAnnotations({ 
      processing_stage: 'ready_to_annotate', 
      size: 1, 
      page: 1 
    }),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
  });

  const { 
    data: annotatedData, 
    isLoading: annotatedLoading 
  } = useQuery({
    queryKey: [...QUERY_KEYS.ANNOTATION_STATS, 'annotated_stage'],
    queryFn: () => apiClient.getSequenceAnnotations({ 
      processing_stage: 'annotated', 
      size: 1, 
      page: 1 
    }),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
  });

  // Calculate derived statistics
  const totalSequences = sequencesData?.total ?? 0;
  const annotatedSequences = annotationsData?.total ?? 0;
  const pendingSequences = Math.max(0, totalSequences - annotatedSequences);
  const completionPercentage = totalSequences > 0 
    ? Math.round((annotatedSequences / totalSequences) * 100)
    : 0;

  // Processing stage statistics
  const processingStages: ProcessingStageStats = {
    imported: importedData?.total ?? 0,
    ready_to_annotate: readyToAnnotateData?.total ?? 0,
    annotated: annotatedData?.total ?? 0,
  };

  const isLoading = sequencesLoading || annotationsLoading || 
                   importedLoading || readyToAnnotateLoading || annotatedLoading;
  const error = sequencesError || annotationsError;
  const errorMessage = error ? String(error) : null;

  return {
    totalSequences,
    annotatedSequences,
    pendingSequences,
    completionPercentage,
    processingStages,
    isLoading,
    error: errorMessage,
  };
}