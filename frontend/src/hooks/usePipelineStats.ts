import { useQueries, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { derivePipelineStats, PipelineStats } from '@/utils/pipeline';
import { ProcessingStage } from '@/types/api';

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
        queryKey: ['pipeline-stats', 'localize-queue'],
        queryFn: () => apiClient.getLocalizationQueue({ size: 1 }),
        staleTime: STALE,
        gcTime: GC,
      },
      {
        // Alert-grouped, skip-excluding total — the same call the sidebar
        // "Alerts" badge makes, so the two numbers cannot drift.
        queryKey: ['pipeline-stats', 'classify-queue'],
        queryFn: () => apiClient.getClassifyQueue({ size: 1 }),
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
  // [sequences-total, detections-complete, localize-queue, classify-queue,
  // ...STAGES in declaration order].
  const [seqTotal, detComplete, localizeQueue, classifyQueue, seqDone, annotated] = results;

  const stats = derivePipelineStats({
    total: seqTotal.data?.total ?? 0,
    detectionComplete: detComplete.data?.total ?? 0,
    localizeQueueTotal: localizeQueue.data?.total ?? 0,
    classifyQueueTotal: classifyQueue.data?.total ?? 0,
    seqAnnotationDone: seqDone.data?.total ?? 0,
    annotatedStage: annotated.data?.total ?? 0,
  });

  const firstError = results.find(r => r.error)?.error ?? groupsQuery.error;
  return {
    ...stats,
    groupsToLabel: groupsQuery.data?.unlabeled ?? 0,
    isLoading: results.some(r => r.isLoading) || groupsQuery.isLoading,
    error: firstError ? String(firstError) : null,
  };
}
