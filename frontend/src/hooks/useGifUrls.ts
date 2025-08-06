import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';

export function useGifUrls(annotationId: number | null) {
  return useQuery({
    queryKey: QUERY_KEYS.GIF_URLS(annotationId || 0),
    queryFn: () => annotationId ? apiClient.getGifUrls(annotationId) : Promise.resolve(null),
    enabled: !!annotationId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 2,
  });
}