import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';

export interface AnnotationCounts {
  sequenceCount: number;
  detectionCount: number;
  isLoading: boolean;
  error: any;
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
      const response = await apiClient.getSequences({
        detection_annotation_completion: 'incomplete', // Sequences that still need detection annotation
        include_detection_stats: true,
        is_unsure: false, // Exclude unsure sequences to match DetectionAnnotatePage filtering
        size: 1, // Only need the total count
      });
      return response.total;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
  });

  return {
    sequenceCount: sequenceData || 0,
    detectionCount: detectionData || 0,
    isLoading: sequenceLoading || detectionLoading,
    error: sequenceError || detectionError,
  };
}
