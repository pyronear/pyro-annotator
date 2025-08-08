import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';

export function useDetectionImage(detectionId: number | null) {
  return useQuery({
    queryKey: [...QUERY_KEYS.DETECTION_IMAGE, detectionId],
    queryFn: () => detectionId ? apiClient.getDetectionImageUrl(detectionId) : Promise.resolve(null),
    enabled: !!detectionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

