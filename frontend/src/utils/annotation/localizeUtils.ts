import { LocalizationQueueLane, QueueOrderBy } from '@/types/api';

/**
 * Stage to write at classify submit (spec: smoke-localization entry point;
 * amended by 2026-08-05 unsure lanes gate the localize queue).
 *
 * FP-only lanes (no smoke, no missed smoke, not unsure) exit the pipeline
 * immediately. Smoke / missed-smoke lanes park at seq_annotation_done.
 *
 * An unsure lane parks at seq_annotation_done — where it withholds its whole
 * alert from localization — until it is explicitly deferred ("Undecidable for
 * now"), which settles it at annotated with is_unsure kept true.
 *
 * An already-annotated lane is never demoted, with one exception (spec:
 * fp-promote-relocalize, issue #275): a lane that did NOT need localization
 * before this edit — an FP exit or a deferred-unsure lane — but does now
 * re-enters at seq_annotation_done. It never had any localization work to
 * protect, and without the demotion the correction could never be localized.
 */
export function determineClassifySubmitStage(args: {
  currentStage: string | undefined;
  isUnsure: boolean;
  hasSmoke: boolean;
  hasMissedSmoke: boolean;
  /** `laneNeedsLocalization()` over the lane's pre-edit flags. */
  previouslyNeededLocalization: boolean;
  deferred?: boolean;
}): 'annotated' | 'seq_annotation_done' {
  if (args.isUnsure) return args.deferred ? 'annotated' : 'seq_annotation_done';
  if (args.currentStage === 'annotated') {
    return (args.hasSmoke || args.hasMissedSmoke) && !args.previouslyNeededLocalization
      ? 'seq_annotation_done'
      : 'annotated';
  }
  if (!args.hasSmoke && !args.hasMissedSmoke) return 'annotated';
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

/**
 * The queue ordering an alert was opened under. It rides in the detail URL
 * (`?order_by=…&order_direction=…`) so the post-submit advance re-runs the
 * same listing the annotator is working, rather than silently walking score
 * order while they work by recency.
 *
 * The skipped backlog is deliberately absent: its rows are not clickable
 * (`LocalizeQueueTable.tsx`), so no alert is ever opened from it.
 */
export interface LocalizeQueueView {
  orderBy: QueueOrderBy;
  orderDirection: 'asc' | 'desc';
}

/** What /localize itself shows on arrival (DetectionAnnotatePage.tsx:25-26). */
export const DEFAULT_LOCALIZE_QUEUE_VIEW: LocalizeQueueView = {
  orderBy: 'temporal_model_score',
  orderDirection: 'desc',
};

const QUEUE_ORDER_BY_VALUES: QueueOrderBy[] = ['recorded_at', 'temporal_model_score'];

/**
 * Reads the view out of a location search string. Anything missing or
 * unrecognised falls back to the defaults, so a deep link, a dashboard link or
 * a hand-edited URL behaves like a plain queue entry instead of forwarding an
 * order_by the API would reject.
 */
export function parseLocalizeQueueView(search: string): LocalizeQueueView {
  const params = new URLSearchParams(search);
  const orderBy = params.get('order_by');
  const orderDirection = params.get('order_direction');
  return {
    orderBy: QUEUE_ORDER_BY_VALUES.includes(orderBy as QueueOrderBy)
      ? (orderBy as QueueOrderBy)
      : DEFAULT_LOCALIZE_QUEUE_VIEW.orderBy,
    orderDirection:
      orderDirection === 'asc' || orderDirection === 'desc'
        ? orderDirection
        : DEFAULT_LOCALIZE_QUEUE_VIEW.orderDirection,
  };
}

/** The search string to hang off a `/localize/:sequenceId` URL. */
export function localizeQueueViewSearch(view: LocalizeQueueView): string {
  return `?${new URLSearchParams({
    order_by: view.orderBy,
    order_direction: view.orderDirection,
  }).toString()}`;
}
