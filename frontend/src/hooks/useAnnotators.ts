import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Contributor } from '@/types/api';

export function useAnnotators() {
  return useQuery<Contributor[]>({
    queryKey: QUERY_KEYS.ANNOTATORS,
    queryFn: () => apiClient.getAnnotators(),
    staleTime: 5 * 60 * 1000, // 5 minutes - the user list rarely changes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}
