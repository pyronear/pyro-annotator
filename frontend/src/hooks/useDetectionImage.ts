import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';

export function useDetectionImage(detectionId: number | null) {
  return useQuery({
    queryKey: [...QUERY_KEYS.DETECTION_IMAGE, detectionId],
    queryFn: () =>
      detectionId ? apiClient.getDetectionImageUrl(detectionId) : Promise.resolve(null),
    enabled: !!detectionId,
    // Hold the previous detection's URL while the next one resolves. Consumers
    // with a fixed detection id never see this; the one that steps through
    // frames — the localize object editor — otherwise drops to `undefined` on
    // every arrow press, and its canvas flashes its "no image" placeholder
    // between frames.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}
