import { describe, it, expect } from 'vitest';
import { interpolateRangeBoxes } from '@/utils/annotation/objectRangeInterpolation';

const FIRST: [number, number, number, number] = [0, 0, 0.2, 0.2];
const LAST: [number, number, number, number] = [0, 0, 0.6, 0.6];

describe('interpolateRangeBoxes', () => {
  it('weights by elapsed time, not by position in the list', () => {
    // The middle frame sits 10s after the first and 90s before the last, so it
    // is 10% of the way through — NOT 50%, which index weighting would give.
    // Alert frames are genuinely unevenly spaced (ObjectFilmstrip's own docs
    // note cells sit anywhere from two seconds to two minutes apart), so this
    // is the case that decides the implementation.
    const result = interpolateRangeBoxes(
      ['2026-08-11T12:00:00Z', '2026-08-11T12:00:10Z', '2026-08-11T12:01:40Z'],
      FIRST,
      LAST
    );
    expect(result).toHaveLength(3);
    expect(result[1].xyxyn[2]).toBeCloseTo(0.24, 5);
    expect(result[1].xyxyn[3]).toBeCloseTo(0.24, 5);
  });

  it('pins the anchors exactly', () => {
    const result = interpolateRangeBoxes(
      ['2026-08-11T12:00:00Z', '2026-08-11T12:00:30Z', '2026-08-11T12:01:00Z'],
      FIRST,
      LAST
    );
    expect(result[0].xyxyn).toEqual(FIRST);
    expect(result[2].xyxyn).toEqual(LAST);
  });

  it('interpolates an evenly spaced midpoint to the halfway box', () => {
    const result = interpolateRangeBoxes(
      ['2026-08-11T12:00:00Z', '2026-08-11T12:00:30Z', '2026-08-11T12:01:00Z'],
      FIRST,
      LAST
    );
    expect(result[1].xyxyn[2]).toBeCloseTo(0.4, 5);
  });

  it('moves the box as well as growing it', () => {
    const result = interpolateRangeBoxes(
      ['2026-08-11T12:00:00Z', '2026-08-11T12:00:30Z', '2026-08-11T12:01:00Z'],
      [0.1, 0.1, 0.2, 0.2],
      [0.5, 0.3, 0.7, 0.5]
    );
    expect(result[1].xyxyn[0]).toBeCloseTo(0.3, 5);
    expect(result[1].xyxyn[1]).toBeCloseTo(0.2, 5);
  });

  it('returns the single anchor box for a one-frame range', () => {
    const result = interpolateRangeBoxes(['2026-08-11T12:00:00Z'], FIRST, LAST);
    expect(result).toEqual([{ recordedAt: '2026-08-11T12:00:00Z', xyxyn: FIRST }]);
  });

  it('returns both anchors and nothing between for a two-frame range', () => {
    const result = interpolateRangeBoxes(
      ['2026-08-11T12:00:00Z', '2026-08-11T12:01:00Z'],
      FIRST,
      LAST
    );
    expect(result.map(r => r.xyxyn)).toEqual([FIRST, LAST]);
  });

  it('falls back to the first box when every timestamp is identical', () => {
    // Should never occur in real data; must not divide by zero and emit NaN
    // coordinates, which would be written to the database as a box.
    const result = interpolateRangeBoxes(
      ['2026-08-11T12:00:00Z', '2026-08-11T12:00:00Z'],
      FIRST,
      LAST
    );
    expect(result[0].xyxyn).toEqual(FIRST);
    expect(result[1].xyxyn).toEqual(FIRST);
    expect(result.every(r => r.xyxyn.every(n => Number.isFinite(n)))).toBe(true);
  });

  it('returns nothing for an empty range', () => {
    expect(interpolateRangeBoxes([], FIRST, LAST)).toEqual([]);
  });

  it('carries recordedAt through unchanged and in order', () => {
    const stamps = ['2026-08-11T12:00:00Z', '2026-08-11T12:00:30Z', '2026-08-11T12:01:00Z'];
    expect(interpolateRangeBoxes(stamps, FIRST, LAST).map(r => r.recordedAt)).toEqual(stamps);
  });
});
