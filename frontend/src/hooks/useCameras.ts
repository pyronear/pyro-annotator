import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Camera } from '@/types/api';

export function useCameras() {
  return useQuery<Camera[]>({
    queryKey: QUERY_KEYS.CAMERAS,
    queryFn: () => apiClient.getCameras(),
    staleTime: 5 * 60 * 1000, // 5 minutes - cameras don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}