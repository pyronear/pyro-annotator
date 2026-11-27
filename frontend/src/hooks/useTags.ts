import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Tag } from '@/types/api';

/** Every tag, for the pickers: the list, and whether it is loading or failed. */
export interface TagCatalog {
  tags: Tag[];
  isLoading: boolean;
  isError: boolean;
}

/** The tag list. Admin only for now (#401): pass `enabled: false` for anyone else. */
export function useTags(enabled: boolean): TagCatalog {
  const { data, isLoading, isError } = useQuery<Tag[]>({
    queryKey: QUERY_KEYS.TAGS,
    queryFn: () => apiClient.getTags(),
    enabled,
  });
  return { tags: data ?? [], isLoading: enabled && isLoading, isError };
}
