import { useQueries, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { derivePipelineStats, PipelineStats } from '@/utils/pipeline';
import { ProcessingStage } from '@/types/api';
import { useClassifyQueueTotal, useLocalizeQueueTotal } from '@/hooks/useQueueTotals';

const STALE = 5 * 60 * 1000;
const GC = 10 * 60 * 1000;

// `ready_to_annotate` is deliberately absent: Classify · to do is the
// alert-grouped queue total, not a per-lane stage count (see below).
const STAGES: ProcessingStage[] = ['seq_annotation_done', 'annotated'];

export function usePipelineStats(): PipelineStats & {
  groupsToLabel: number;
  isLoading: boolean;
  error: string | null;
} {
  // Group labeling is a bulk accelerator for the Classify pass (labels fan out
  // to member sequences), surfaced as a secondary entry on the Classify card.
  // Same cache entries the sidebar badges read — see useQueueTotals.
  const classifyQueue = useClassifyQueueTotal();
  const localizeQueue = useLocalizeQueueTotal();

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
      ...STAGES.map(stage => ({
        queryKey: ['pipeline-stats', stage],
        queryFn: () =>
          apiClient.getSequenceAnnotations({ processing_stage: stage, size: 1, page: 1 }),
        staleTime: STALE,
        gcTime: GC,
      })),
    ],
  });

  // Positional destructure: order must match the queries array above —
  // [sequences-total, detections-complete, ...STAGES in declaration order].
  const [seqTotal, detComplete, seqDone, annotated] = results;

  const stats = derivePipelineStats({
    total: seqTotal.data?.total ?? 0,
    detectionComplete: detComplete.data?.total ?? 0,
    localizeQueueTotal: localizeQueue.data ?? 0,
    classifyQueueTotal: classifyQueue.data ?? 0,
    seqAnnotationDone: seqDone.data?.total ?? 0,
    annotatedStage: annotated.data?.total ?? 0,
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
