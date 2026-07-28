import { useQueries, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { derivePipelineStats, PipelineStats } from '@/utils/pipeline';
import { ProcessingStage } from '@/types/api';

const STALE = 5 * 60 * 1000;
const GC = 10 * 60 * 1000;

const STAGES: ProcessingStage[] = ['ready_to_annotate', 'seq_annotation_done', 'annotated'];

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
  // [sequences-total, detections-complete, localize-queue, ...STAGES in declaration order].
  const [seqTotal, detComplete, localizeQueue, ready, seqDone, annotated] = results;

  const stats = derivePipelineStats({
    total: seqTotal.data?.total ?? 0,
    detectionComplete: detComplete.data?.total ?? 0,
    localizeQueueTotal: localizeQueue.data?.total ?? 0,
    readyToAnnotate: ready.data?.total ?? 0,
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
