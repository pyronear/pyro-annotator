import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';

export interface AnnotationCounts {
  sequenceCount: number;
  detectionCount: number;
  groupCount: number;
  isLoading: boolean;
  error: Error | null;
}

export function useAnnotationCounts(): AnnotationCounts {
  // Query for sequences needing sequence-level annotation
  const {
    data: sequenceData,
    isLoading: sequenceLoading,
    error: sequenceError,
  } = useQuery({
    queryKey: ['annotation-counts', 'sequences'],
    queryFn: async () => {
      const response = await apiClient.getSequencesWithAnnotations({
        processing_stage: 'ready_to_annotate',
        size: 1, // Only need the total count
      });
      return response.total;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
  });

  // Query for sequences needing detection-level annotation
  const {
    data: detectionData,
    isLoading: detectionLoading,
    error: detectionError,
  } = useQuery({
    queryKey: ['annotation-counts', 'detections'],
    queryFn: async () => {
      // Localize queue total: alerts ready for smoke localization (matches
      // exactly what /detections/annotate shows).
      const response = await apiClient.getLocalizationQueue({ size: 1 });
      return response.total;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
  });

  // Query for sequence groups awaiting validation
  const {
    data: groupData,
    isLoading: groupLoading,
    error: groupError,
  } = useQuery({
    queryKey: ['annotation-counts', 'sequence-groups'],
    queryFn: async () => {
      const stats = await apiClient.getSequenceGroupStats();
      return stats.unvalidated;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
  });

  return {
    sequenceCount: sequenceData || 0,
    detectionCount: detectionData || 0,
    groupCount: groupData || 0,
    isLoading: sequenceLoading || detectionLoading || groupLoading,
    error: sequenceError || detectionError || groupError,
  };
}
