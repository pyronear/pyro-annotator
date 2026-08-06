import { useQueries, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { derivePipelineStats, PipelineStats } from '@/utils/pipeline';
import { useClassifyQueueTotal, useLocalizeQueueTotal } from '@/hooks/useQueueTotals';

const STALE = 5 * 60 * 1000;
const GC = 10 * 60 * 1000;

export function usePipelineStats(): PipelineStats & {
  groupsToLabel: number;
  isLoading: boolean;
  error: string | null;
} {
  // Same cache entries the sidebar badges read — see useQueueTotals.
  const classifyQueue = useClassifyQueueTotal();
  const localizeQueue = useLocalizeQueueTotal();

  // Group labeling is a bulk accelerator for the Classify pass (labels fan out
  // to member sequences), surfaced as a secondary entry on the Classify card.
  const groupsQuery = useQuery({
    queryKey: ['pipeline-stats', 'groups-to-label'],
    queryFn: () => apiClient.getSequenceGroupStats(),
    staleTime: STALE,
    gcTime: GC,
  });

  const results = useQueries({
    queries: [
      {
        queryKey: ['pipeline-stats', 'sequences-total'],
        queryFn: () => apiClient.getSequences({ size: 1, page: 1 }),
        staleTime: STALE,
        gcTime: GC,
      },
      {
        queryKey: ['pipeline-stats', 'detections-complete'],
        queryFn: () =>
          apiClient.getSequences({ detection_annotation_completion: 'complete', size: 1, page: 1 }),
        staleTime: STALE,
        gcTime: GC,
      },
      {
        // Done totals come from the alert-grouped done queues — the same pages
        // the cards' "Review …" links open — so each card's to-do and done
        // halves are both alert counts. Summing the `seq_annotation_done` and
        // `annotated` annotation stages instead counted objects, which made
        // the progress bar divide objects by (alerts + objects).
        queryKey: ['pipeline-stats', 'classify-done'],
        queryFn: () => apiClient.getClassifyDone({ size: 1, page: 1 }),
        staleTime: STALE,
        gcTime: GC,
      },
      {
        queryKey: ['pipeline-stats', 'localize-done'],
        queryFn: () => apiClient.getLocalizeDoneQueue({ size: 1, page: 1 }),
        staleTime: STALE,
        gcTime: GC,
      },
    ],
  });

  // Positional destructure: order must match the queries array above.
  const [seqTotal, detComplete, classifyDone, localizeDone] = results;

  const stats = derivePipelineStats({
    total: seqTotal.data?.total ?? 0,
    detectionComplete: detComplete.data?.total ?? 0,
    localizeQueueTotal: localizeQueue.data ?? 0,
    classifyQueueTotal: classifyQueue.data ?? 0,
    classifyDoneTotal: classifyDone.data?.total ?? 0,
    localizeDoneTotal: localizeDone.data?.total ?? 0,
  });

  const firstError =
    results.find(r => r.error)?.error ??
    classifyQueue.error ??
    localizeQueue.error ??
    groupsQuery.error;
  return {
    ...stats,
    groupsToLabel: groupsQuery.data?.unlabeled ?? 0,
    isLoading:
      results.some(r => r.isLoading) ||
      classifyQueue.isLoading ||
      localizeQueue.isLoading ||
      groupsQuery.isLoading,
    error: firstError ? String(firstError) : null,
  };
}
