import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';

export function useDetectionImage(detectionId: number | null) {
  return useQuery({
    queryKey: [...QUERY_KEYS.DETECTION_IMAGE, detectionId],
    queryFn: () => detectionId ? apiClient.getDetectionImageUrl(detectionId) : null,
    enabled: !!detectionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function useSequenceDetections(sequenceId: number) {
  return useQuery({
    queryKey: [...QUERY_KEYS.DETECTIONS, { sequence_id: sequenceId }],
    queryFn: () => apiClient.getDetections({ 
      sequence_id: sequenceId, 
      size: 1,
      order_by: 'recorded_at',
      order_direction: 'asc'
    }),
    enabled: !!sequenceId,
  });
}