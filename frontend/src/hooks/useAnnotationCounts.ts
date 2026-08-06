import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { useClassifyQueueTotal, useLocalizeQueueTotal } from '@/hooks/useQueueTotals';

export interface AnnotationCounts {
  sequenceCount: number;
  detectionCount: number;
  groupCount: number;
  isLoading: boolean;
  error: Error | null;
}

export function useAnnotationCounts(): AnnotationCounts {
  // Alerts awaiting classification / ready for localization. Shared with the
  // dashboard cards so a badge and its card can never disagree.
  const {
    data: sequenceData,
    isLoading: sequenceLoading,
    error: sequenceError,
  } = useClassifyQueueTotal();

  const {
    data: detectionData,
    isLoading: detectionLoading,
    error: detectionError,
  } = useLocalizeQueueTotal();

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
