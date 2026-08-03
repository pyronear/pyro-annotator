/**
 * Tests for deriveSequenceOutcome: the single derivation behind the outcome
 * codes shown in the done tables (unsure > missed smoke > smoke > no smoke).
 */

import { deriveSequenceOutcome } from '@/utils/modelAccuracy';
import type { SequenceAnnotation } from '@/types/api';

const createAnnotation = (overrides: Partial<SequenceAnnotation> = {}): SequenceAnnotation => ({
  id: 1,
  sequence_id: 1,
  has_smoke: true,
  has_false_positives: false,
  false_positive_types: '',
  smoke_types: ['wildfire'],
  has_missed_smoke: false,
  is_unsure: false,
  annotation: { sequences_bbox: [] },
  processing_stage: 'annotated',
  created_at: '2024-01-01T10:00:00Z',
  updated_at: null,
  contributors: [],
  ...overrides,
});

describe('deriveSequenceOutcome', () => {
  it('returns null when there is no annotation', () => {
    expect(deriveSequenceOutcome(null)).toBeNull();
    expect(deriveSequenceOutcome(undefined)).toBeNull();
  });

  it('returns tp when the human confirmed smoke', () => {
    expect(deriveSequenceOutcome(createAnnotation())).toBe('tp');
  });

  it('returns fp when the human found no smoke', () => {
    expect(deriveSequenceOutcome(createAnnotation({ has_smoke: false, smoke_types: [] }))).toBe(
      'fp'
    );
  });

  it('returns fn when smoke was missed, even if the detected smoke is real', () => {
    expect(deriveSequenceOutcome(createAnnotation({ has_missed_smoke: true }))).toBe('fn');
  });

  it('returns unsure ahead of every other outcome', () => {
    expect(
      deriveSequenceOutcome(createAnnotation({ is_unsure: true, has_missed_smoke: true }))
    ).toBe('unsure');
  });
});
