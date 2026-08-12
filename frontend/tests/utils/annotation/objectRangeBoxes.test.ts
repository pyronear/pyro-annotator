import { describe, it, expect } from 'vitest';
import { fillRangeBoxes } from '@/utils/annotation/objectRangeBoxes';

const BOX: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];

describe('fillRangeBoxes', () => {
  it('gives every frame in the range the same box', () => {
    const stamps = ['2026-08-11T12:00:00Z', '2026-08-11T12:00:30Z', '2026-08-11T12:01:00Z'];
    const result = fillRangeBoxes(stamps, BOX);
    expect(result.map(r => r.recordedAt)).toEqual(stamps);
    expect(result.every(r => r.xyxyn === BOX)).toBe(true);
  });

  it('handles a one-frame range', () => {
    expect(fillRangeBoxes(['2026-08-11T12:00:00Z'], BOX)).toEqual([
      { recordedAt: '2026-08-11T12:00:00Z', xyxyn: BOX },
    ]);
  });

  it('returns nothing for an empty range', () => {
    expect(fillRangeBoxes([], BOX)).toEqual([]);
  });
});
