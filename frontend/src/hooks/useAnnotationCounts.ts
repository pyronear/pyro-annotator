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

  // Recurring objects still needing a label. Not `unvalidated`: the badge opens
  // the recurring-objects list on its "To label" tab, which counts `unlabeled`,
  // and label propagation is gated on is_validated — so a validated-but-
  // unlabeled backlog always exists and the two numbers never converge.
  const {
    data: groupData,
    isLoading: groupLoading,
    error: groupError,
  } = useQuery({
    queryKey: ['annotation-counts', 'sequence-groups'],
    queryFn: async () => {
      const stats = await apiClient.getSequenceGroupStats();
      return stats.unlabeled;
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
