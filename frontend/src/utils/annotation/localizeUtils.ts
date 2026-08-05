import { LocalizationQueueLane } from '@/types/api';

/**
 * Stage to write at classify submit (spec: smoke-localization entry point).
 * FP-only lanes (no smoke, no missed smoke, not unsure) exit the pipeline
 * immediately; smoke / missed-smoke / unsure lanes park at
 * seq_annotation_done. An already-annotated lane is never demoted, with one
 * exception (spec: fp-promote-relocalize, issue #275): a lane that did NOT
 * need localization before this edit (an FP exit) but does now re-enters at
 * seq_annotation_done — it never had any localization work to protect.
 */
export function determineClassifySubmitStage(args: {
  currentStage: string | undefined;
  isUnsure: boolean;
  hasSmoke: boolean;
  hasMissedSmoke: boolean;
  /** `laneNeedsLocalization()` over the lane's pre-edit flags. */
  previouslyNeededLocalization: boolean;
}): 'annotated' | 'seq_annotation_done' {
  const nowNeedsLocalization = (args.hasSmoke || args.hasMissedSmoke) && !args.isUnsure;
  if (args.currentStage === 'annotated') {
    return nowNeedsLocalization && !args.previouslyNeededLocalization
      ? 'seq_annotation_done'
      : 'annotated';
  }
  if (!args.isUnsure && !args.hasSmoke && !args.hasMissedSmoke) return 'annotated';
  return 'seq_annotation_done';
}

/**
 * Whether a lane needs localization. Mirrors the backend rule in
 * annotation_api/src/app/services/localization_rule.py:
 *
 *     (has_smoke OR has_missed_smoke) AND NOT is_unsure
 *
 * Accepts just the three flags (a `Pick` of `LocalizationQueueLane`) so a
 * `SequenceAnnotation` (which carries the same three booleans but not the
 * rest of the queue-lane shape) can be checked directly, e.g. from
 * `AlertLane.annotation` on the collocated localize page.
 */
export function laneNeedsLocalization(
  lane: Pick<LocalizationQueueLane, 'has_smoke' | 'has_missed_smoke' | 'is_unsure'>
): boolean {
  return (lane.has_smoke || lane.has_missed_smoke) && !lane.is_unsure;
}

/** Next unfinished smoke lane of an alert, walking in lane order. */
export function pickNextLocalizeLane(
  lanes: LocalizationQueueLane[],
  currentSequenceId: number
): number | null {
  const next = lanes.find(
    l =>
      l.sequence_id !== currentSequenceId &&
      laneNeedsLocalization(l) &&
      l.processing_stage === 'seq_annotation_done'
  );
  return next ? next.sequence_id : null;
}
