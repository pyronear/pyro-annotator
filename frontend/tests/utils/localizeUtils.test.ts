import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALIZE_QUEUE_VIEW,
  LocalizeQueueView,
  determineClassifySubmitStage,
  localizeQueueViewSearch,
  parseLocalizeQueueView,
  pickNextLocalizeLane,
} from '@/utils/annotation/localizeUtils';
import { LocalizationQueueLane } from '@/types/api';

const lane = (id: number, over: Partial<LocalizationQueueLane> = {}): LocalizationQueueLane => ({
  sequence_id: id,
  alert_api_id: id,
  has_smoke: true,
  has_missed_smoke: false,
  is_unsure: false,
  processing_stage: 'seq_annotation_done',
  total_detections: 3,
  annotated_detections: 0,
  auto_annotated_at: '2026-07-28T00:00:00Z',
  ...over,
});

describe('determineClassifySubmitStage', () => {
  it('already-finalised stays annotated (localized smoke lane edited while still smoke)', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'annotated',
        isUnsure: false,
        hasSmoke: true,
        hasMissedSmoke: false,
        previouslyNeededLocalization: true,
      })
    ).toBe('annotated'));

  it('FP-only fast-paths to annotated', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'ready_to_annotate',
        isUnsure: false,
        hasSmoke: false,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
      })
    ).toBe('annotated'));

  it('smoke goes to seq_annotation_done', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'ready_to_annotate',
        isUnsure: false,
        hasSmoke: true,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
      })
    ).toBe('seq_annotation_done'));

  it('missed smoke must NOT fast-path', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'ready_to_annotate',
        isUnsure: false,
        hasSmoke: false,
        hasMissedSmoke: true,
        previouslyNeededLocalization: false,
      })
    ).toBe('seq_annotation_done'));

  it('unsure must NOT fast-path', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'ready_to_annotate',
        isUnsure: true,
        hasSmoke: false,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
      })
    ).toBe('seq_annotation_done'));

  it('deferred unsure settles at annotated', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'seq_annotation_done',
        isUnsure: true,
        hasSmoke: false,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
        deferred: true,
      })
    ).toBe('annotated'));

  it('undeferred unsure still parks at seq_annotation_done', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'seq_annotation_done',
        isUnsure: true,
        hasSmoke: false,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
        deferred: false,
      })
    ).toBe('seq_annotation_done'));

  it('promoted FP lane (annotated, now needs localization) demotes to seq_annotation_done', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'annotated',
        isUnsure: false,
        hasSmoke: true,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
      })
    ).toBe('seq_annotation_done'));

  it('FP lane corrected to missed smoke also demotes', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'annotated',
        isUnsure: false,
        hasSmoke: false,
        hasMissedSmoke: true,
        previouslyNeededLocalization: false,
      })
    ).toBe('seq_annotation_done'));

  it('FP lane staying FP keeps annotated', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'annotated',
        isUnsure: false,
        hasSmoke: false,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
      })
    ).toBe('annotated'));

  it('FP lane flipped to unsure re-parks as undecided at seq_annotation_done', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'annotated',
        isUnsure: true,
        hasSmoke: false,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
      })
    ).toBe('seq_annotation_done'));

  it('a deferred-unsure lane re-decided as smoke returns to seq_annotation_done', () =>
    // A deferred-unsure lane was is_unsure pre-edit, so its
    // previouslyNeededLocalization is false — same promotion rule as an
    // FP exit re-decided as smoke.
    expect(
      determineClassifySubmitStage({
        currentStage: 'annotated',
        isUnsure: false,
        hasSmoke: true,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
      })
    ).toBe('seq_annotation_done'));

  it('a deferred-unsure lane re-decided as FP stays annotated', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'annotated',
        isUnsure: false,
        hasSmoke: false,
        hasMissedSmoke: false,
        previouslyNeededLocalization: false,
      })
    ).toBe('annotated'));
});

describe('pickNextLocalizeLane', () => {
  it('picks the first unfinished smoke lane that is not current', () =>
    expect(pickNextLocalizeLane([lane(1), lane(2)], 1)).toBe(2));

  it('skips FP and submitted lanes', () =>
    expect(
      pickNextLocalizeLane(
        [
          lane(1),
          lane(2, { has_smoke: false }),
          lane(3, { processing_stage: 'annotated' }),
          lane(4),
        ],
        1
      )
    ).toBe(4));

  it('returns null when none remain', () => expect(pickNextLocalizeLane([lane(1)], 1)).toBeNull());

  it('picks a missed-smoke-only lane (no has_smoke, incomplete detections)', () =>
    expect(
      pickNextLocalizeLane(
        [
          lane(1),
          lane(2, {
            has_smoke: false,
            has_missed_smoke: true,
            is_unsure: false,
            total_detections: 3,
            annotated_detections: 0,
          }),
        ],
        1
      )
    ).toBe(2));

  it('skips an unsure lane even when it has smoke', () =>
    expect(
      pickNextLocalizeLane([lane(1), lane(2, { has_smoke: true, is_unsure: true }), lane(3)], 1)
    ).toBe(3));
});

describe('localize queue view (the listing an alert was opened from)', () => {
  it('reads the queue listing out of a detail URL', () => {
    expect(parseLocalizeQueueView('?order_by=recorded_at&order_direction=asc')).toEqual({
      orderBy: 'recorded_at',
      orderDirection: 'asc',
    });
  });

  it('falls back to the queue page defaults when the params are absent, junk or unrelated', () => {
    expect(parseLocalizeQueueView('')).toEqual(DEFAULT_LOCALIZE_QUEUE_VIEW);
    // A hand-edited or stale URL must never reach the API as an order_by it rejects.
    expect(parseLocalizeQueueView('?order_by=drop_table&order_direction=sideways')).toEqual(
      DEFAULT_LOCALIZE_QUEUE_VIEW
    );
    // Alert-scoped params (the editor's deep-link frame) are not view state.
    expect(parseLocalizeQueueView('?frame=3')).toEqual(DEFAULT_LOCALIZE_QUEUE_VIEW);
  });

  it('round-trips through the search string it builds', () => {
    const view: LocalizeQueueView = {
      orderBy: 'recorded_at',
      orderDirection: 'asc',
    };
    expect(localizeQueueViewSearch(view)).toBe('?order_by=recorded_at&order_direction=asc');
    expect(parseLocalizeQueueView(localizeQueueViewSearch(view))).toEqual(view);
  });

  it('spells out the default view rather than emitting an empty search', () => {
    expect(localizeQueueViewSearch(DEFAULT_LOCALIZE_QUEUE_VIEW)).toBe(
      '?order_by=temporal_model_score&order_direction=desc'
    );
  });
});
