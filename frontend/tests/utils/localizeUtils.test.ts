import { describe, expect, it } from 'vitest';

import {
  determineClassifySubmitStage,
  pickNextLocalizeLane,
} from '@/utils/annotation/localizeUtils';
import { LocalizationQueueLane } from '@/types/api';

const lane = (id: number, over: Partial<LocalizationQueueLane> = {}): LocalizationQueueLane => ({
  sequence_id: id,
  alert_api_id: id,
  has_smoke: true,
  processing_stage: 'seq_annotation_done',
  total_detections: 3,
  annotated_detections: 0,
  auto_annotated_at: '2026-07-28T00:00:00Z',
  ...over,
});

describe('determineClassifySubmitStage', () => {
  it('already-finalised stays annotated', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'annotated',
        isUnsure: false,
        hasSmoke: true,
        hasMissedSmoke: false,
      })
    ).toBe('annotated'));

  it('FP-only fast-paths to annotated', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'ready_to_annotate',
        isUnsure: false,
        hasSmoke: false,
        hasMissedSmoke: false,
      })
    ).toBe('annotated'));

  it('smoke goes to seq_annotation_done', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'ready_to_annotate',
        isUnsure: false,
        hasSmoke: true,
        hasMissedSmoke: false,
      })
    ).toBe('seq_annotation_done'));

  it('missed smoke must NOT fast-path', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'ready_to_annotate',
        isUnsure: false,
        hasSmoke: false,
        hasMissedSmoke: true,
      })
    ).toBe('seq_annotation_done'));

  it('unsure must NOT fast-path', () =>
    expect(
      determineClassifySubmitStage({
        currentStage: 'ready_to_annotate',
        isUnsure: true,
        hasSmoke: false,
        hasMissedSmoke: false,
      })
    ).toBe('seq_annotation_done'));
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
});
