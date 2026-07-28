import { useQueries } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { derivePipelineStats, PipelineStats } from '@/utils/pipeline';
import { ProcessingStage } from '@/types/api';

const STALE = 5 * 60 * 1000;
const GC = 10 * 60 * 1000;

const STAGES: ProcessingStage[] = [
  'ready_to_annotate',
  'seq_annotation_done',
  'in_review',
  'annotated',
  'needs_manual',
];

export function usePipelineStats(): PipelineStats & { isLoading: boolean; error: string | null } {
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

  const [seqTotal, detComplete, ready, seqDone, inReview, annotated, needsManual] = results;

  const stats = derivePipelineStats({
    total: seqTotal.data?.total ?? 0,
    detectionComplete: detComplete.data?.total ?? 0,
    readyToAnnotate: ready.data?.total ?? 0,
    seqAnnotationDone: seqDone.data?.total ?? 0,
    inReview: inReview.data?.total ?? 0,
    annotatedStage: annotated.data?.total ?? 0,
    needsManual: needsManual.data?.total ?? 0,
  });

  const firstError = results.find(r => r.error)?.error;
  return {
    ...stats,
    isLoading: results.some(r => r.isLoading),
    error: firstError ? String(firstError) : null,
  };
}
