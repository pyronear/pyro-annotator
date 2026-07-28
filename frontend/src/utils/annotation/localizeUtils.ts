import { LocalizationQueueLane } from '@/types/api';

/**
 * Stage to write at classify submit (spec: smoke-localization entry point).
 * FP-only lanes (no smoke, no missed smoke, not unsure) exit the pipeline
 * immediately; smoke / missed-smoke / unsure lanes park at
 * seq_annotation_done. An already-annotated lane is never demoted.
 */
export function determineClassifySubmitStage(args: {
  currentStage: string | undefined;
  isUnsure: boolean;
  hasSmoke: boolean;
  hasMissedSmoke: boolean;
}): 'annotated' | 'seq_annotation_done' {
  if (args.currentStage === 'annotated') return 'annotated';
  if (!args.isUnsure && !args.hasSmoke && !args.hasMissedSmoke) return 'annotated';
  return 'seq_annotation_done';
}

/** Next unfinished smoke lane of an alert, walking in lane order. */
export function pickNextLocalizeLane(
  lanes: LocalizationQueueLane[],
  currentSequenceId: number
): number | null {
  const next = lanes.find(
    l =>
      l.sequence_id !== currentSequenceId &&
      l.has_smoke &&
      l.processing_stage === 'seq_annotation_done'
  );
  return next ? next.sequence_id : null;
}
