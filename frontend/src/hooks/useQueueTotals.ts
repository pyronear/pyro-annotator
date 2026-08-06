import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';

/**
 * Queue totals shared by the sidebar badges and the dashboard cards.
 *
 * Both surfaces are on screen at the same time (the sidebar is mounted on
 * every route), so they must never show different numbers. Reading the same
 * endpoint from two query keys is not enough — separate cache entries refetch
 * on their own schedule and drift apart between refreshes. One key per total
 * means React Query serves both callers from a single cache entry and a single
 * request, so they are equal by construction.
 *
 * The keys stay under the `annotation-counts` prefix that every queue-affecting
 * mutation already invalidates.
 */

/**
 * Root key every queue-affecting mutation invalidates. Exported so the
 * invalidating pages and the tests reference the same string as the hooks —
 * a rename that reached only one side would silently stop the refresh.
 */
export const QUEUE_COUNTS_KEY = 'annotation-counts';

export const CLASSIFY_QUEUE_TOTAL_KEY = [QUEUE_COUNTS_KEY, 'classify-queue-total'] as const;
export const LOCALIZE_QUEUE_TOTAL_KEY = [QUEUE_COUNTS_KEY, 'localize-queue-total'] as const;

const STALE = 5 * 60 * 1000;
const GC = 10 * 60 * 1000;

const SHARED = {
  staleTime: STALE,
  gcTime: GC,
  refetchOnWindowFocus: true,
} as const;

/** Alerts with at least one object awaiting classification (skips excluded). */
export function useClassifyQueueTotal() {
  return useQuery({
    queryKey: CLASSIFY_QUEUE_TOTAL_KEY,
    queryFn: () => apiClient.getClassifyQueue({ size: 1 }),
    select: queue => queue.total,
    ...SHARED,
  });
}

/** Alerts ready for smoke localization (skips excluded). */
export function useLocalizeQueueTotal() {
  return useQuery({
    queryKey: LOCALIZE_QUEUE_TOTAL_KEY,
    queryFn: () => apiClient.getLocalizationQueue({ size: 1 }),
    select: queue => queue.total,
    ...SHARED,
  });
}
