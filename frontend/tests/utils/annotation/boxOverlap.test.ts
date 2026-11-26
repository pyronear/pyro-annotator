import { describe, expect, it } from 'vitest';
import { boxIoU, boxMismatch, type NormalizedBox } from '@/utils/annotation/boxOverlap';

const ref: NormalizedBox = [0.4, 0.4, 0.6, 0.6];

describe('boxIoU', () => {
  it('is 1 for identical boxes and 0 for disjoint ones', () => {
    expect(boxIoU(ref, ref)).toBe(1);
    expect(boxIoU(ref, [0.7, 0.7, 0.8, 0.8])).toBe(0);
  });

  it('is intersection over union', () => {
    // Half of ref, shifted right by half its width: 0.01 shared over 0.03 total.
    expect(boxIoU(ref, [0.5, 0.4, 0.7, 0.6])).toBeCloseTo(1 / 3);
  });

  it('is 0 for a degenerate box', () => {
    expect(boxIoU([0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5])).toBe(0);
  });
});

describe('boxMismatch', () => {
  it('names a box that misses the smoke', () => {
    expect(boxMismatch([0, 0, 0.1, 0.1], ref)).toBe('missed');
  });

  it('names a box too large for the plume', () => {
    expect(boxMismatch([0.3, 0.3, 0.7, 0.7], ref)).toBe('too-loose');
  });

  it('names a box too small for the plume', () => {
    expect(boxMismatch([0.45, 0.45, 0.55, 0.55], ref)).toBe('too-tight');
  });

  it('names a box of the right size in the wrong place', () => {
    expect(boxMismatch([0.5, 0.4, 0.7, 0.6], ref)).toBe('off-centre');
  });
});
