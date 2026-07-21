/**
 * Unit tests for the seed-at-submit review materialization.
 * The headline case is the spec's 3-object worked example (§3).
 */

import { describe, it, expect } from 'vitest';
import { materializeReviewAnnotation, sequenceSmokeType } from '@/utils/annotation';
import { AlgoPrediction, SequenceAnnotation } from '@/types/api';
import { DrawnRectangle } from '@/utils/annotation/drawingUtils';

const box = (xyxyn: [number, number, number, number]): AlgoPrediction => ({
  xyxyn,
  confidence: 0.5,
  class_name: 'smoke',
});

describe('materializeReviewAnnotation', () => {
  it('3-object worked example: accept box1, adjust box2, add box3', () => {
    const box1: [number, number, number, number] = [0.1, 0.1, 0.2, 0.2];
    const box2: [number, number, number, number] = [0.4, 0.4, 0.5, 0.5]; // bad outline
    const box2p: [number, number, number, number] = [0.42, 0.41, 0.53, 0.52]; // adjusted
    const box3: [number, number, number, number] = [0.7, 0.7, 0.8, 0.8]; // missed -> added

    const result = materializeReviewAnnotation({
      winningBoxes: [box(box1), box(box2)],
      winningLayer: 'auto',
      rejected: new Set([1]), // box2 rejected (superseded by the adjusted copy)
      humanRects: [
        { id: 'a', xyxyn: box2p, smokeType: 'wildfire' } as DrawnRectangle,
        { id: 'b', xyxyn: box3, smokeType: 'wildfire' } as DrawnRectangle,
      ],
      smokeType: 'wildfire',
    });

    expect(result).toEqual([
      { xyxyn: box1, class_name: 'smoke', smoke_type: 'wildfire', origin: 'auto' },
      { xyxyn: box2p, class_name: 'smoke', smoke_type: 'wildfire', origin: 'human' },
      { xyxyn: box3, class_name: 'smoke', smoke_type: 'wildfire', origin: 'human' },
    ]);
    // the rejected model box (box2) never appears in the committed annotation
    expect(result.some(b => b.xyxyn === box2)).toBe(false);
  });

  it('all accepted, none rejected/added -> every winning box, origin = layer', () => {
    const result = materializeReviewAnnotation({
      winningBoxes: [box([0.1, 0.1, 0.2, 0.2]), box([0.3, 0.3, 0.4, 0.4])],
      winningLayer: 'engine',
      rejected: new Set(),
      humanRects: [],
      smokeType: 'industrial',
    });
    expect(result).toHaveLength(2);
    expect(result.every(b => b.origin === 'engine')).toBe(true);
    expect(result.every(b => b.smoke_type === 'industrial')).toBe(true);
  });

  it('rejecting all model boxes with no human boxes -> empty annotation', () => {
    const result = materializeReviewAnnotation({
      winningBoxes: [box([0.1, 0.1, 0.2, 0.2])],
      winningLayer: 'auto',
      rejected: new Set([0]),
      humanRects: [],
      smokeType: 'wildfire',
    });
    expect(result).toEqual([]);
  });
});

describe('sequenceSmokeType', () => {
  it('returns the sequence-level classified type', () => {
    expect(
      sequenceSmokeType({ smoke_types: ['industrial'] } as SequenceAnnotation)
    ).toBe('industrial');
  });

  it('falls back to wildfire when no type is recorded', () => {
    expect(sequenceSmokeType({ smoke_types: [] } as unknown as SequenceAnnotation)).toBe(
      'wildfire'
    );
    expect(sequenceSmokeType(undefined)).toBe('wildfire');
  });
});
