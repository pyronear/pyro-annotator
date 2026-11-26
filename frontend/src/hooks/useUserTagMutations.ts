import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { ApiError, UserTagsChange } from '@/types/api';
import { QUERY_KEYS } from '@/utils/constants';

function describe(error: unknown, fallback: string): string {
  const detail = (error as ApiError | undefined)?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

/**
 * The writes behind the user page's access column: give or remove a tag for
 * a set of users, and turn full access on or off. Both refresh the user list.
 */
export function useUserTagMutations(onError: (message: string) => void) {
  const queryClient = useQueryClient();
  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.USERS });

  const changeTagUsers = useMutation({
    mutationFn: ({ tagId, change }: { tagId: number; change: UserTagsChange }) =>
      apiClient.updateTagUsers(tagId, change),
    onError: error => onError(describe(error, 'Could not update the tags')),
    onSettled: refreshUsers,
  });

  const setFullAccess = useMutation({
    mutationFn: ({ userId, fullAccess }: { userId: number; fullAccess: boolean }) =>
      apiClient.updateUser(userId, { full_access: fullAccess }),
    onError: error => onError(describe(error, 'Could not change full access')),
    onSettled: refreshUsers,
  });

  return {
    changeTagUsers: (tagId: number, change: UserTagsChange) =>
      changeTagUsers.mutate({ tagId, change }),
    setFullAccess: (userId: number, fullAccess: boolean) =>
      setFullAccess.mutate({ userId, fullAccess }),
    isPending: changeTagUsers.isPending || setFullAccess.isPending,
  };
}
