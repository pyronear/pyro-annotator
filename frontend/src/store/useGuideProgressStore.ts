import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Which user guide trainings each user has finished, kept in this browser's
 * localStorage and keyed by user id so annotators sharing a machine don't see
 * each other's ticks. A module is identified by its `href`.
 *
 * Client-side only for now: recording the training on the server
 * (pyronear/pyro-annotator#413) would replace this.
 */
interface GuideProgressStore {
  completedByUser: Record<string, string[]>;
  markCompleted: (userKey: string, moduleHref: string) => void;
}

export const useGuideProgressStore = create<GuideProgressStore>()(
  persist(
    set => ({
      completedByUser: {},
      markCompleted: (userKey, moduleHref) =>
        set(state => {
          const done = state.completedByUser[userKey] ?? [];
          if (done.includes(moduleHref)) return state;
          return {
            completedByUser: { ...state.completedByUser, [userKey]: [...done, moduleHref] },
          };
        }),
    }),
    { name: 'guide-progress' }
  )
);

/** The signed-in user's key, or `anonymous` before auth has loaded. */
function useUserKey(): string {
  const user = useAuthStore(state => state.user);
  return user ? String(user.id) : 'anonymous';
}

/** Whether the signed-in user has finished the module at `moduleHref`. */
export function useIsModuleCompleted(moduleHref: string): boolean {
  const userKey = useUserKey();
  return useGuideProgressStore(
    state => state.completedByUser[userKey]?.includes(moduleHref) ?? false
  );
}

/** Marks the module at `moduleHref` as finished for the signed-in user. */
export function useMarkModuleCompleted(moduleHref: string): () => void {
  const userKey = useUserKey();
  const markCompleted = useGuideProgressStore(state => state.markCompleted);
  return () => markCompleted(userKey, moduleHref);
}
