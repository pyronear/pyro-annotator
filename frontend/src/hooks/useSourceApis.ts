import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { SourceApi } from '@/types/api';

export function useSourceApis() {
  return useQuery<SourceApi[]>({
    queryKey: QUERY_KEYS.SOURCE_APIS,
    queryFn: () => apiClient.getSourceApis(),
    staleTime: 5 * 60 * 1000, // 5 minutes - source APIs don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}
