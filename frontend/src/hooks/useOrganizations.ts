import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Organization } from '@/types/api';

export function useOrganizations(search?: string) {
  return useQuery<Organization[]>({
    queryKey: [...QUERY_KEYS.ORGANIZATIONS, search],
    queryFn: () => apiClient.getOrganizations(search),
    staleTime: 5 * 60 * 1000, // 5 minutes - organizations don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}