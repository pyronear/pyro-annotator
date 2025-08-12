import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Camera } from '@/types/api';

export function useCameras(search?: string) {
  return useQuery<Camera[]>({
    queryKey: [...QUERY_KEYS.CAMERAS, search],
    queryFn: () => apiClient.getCameras(search),
    staleTime: 5 * 60 * 1000, // 5 minutes - cameras don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}