import { describe, it, expect } from 'vitest';
import { computeCellCrop } from '@/utils/annotation/gridCropUtils';

const box = (x1: number, y1: number, x2: number, y2: number) => ({ xyxyn: [x1, y1, x2, y2] });

describe('computeCellCrop', () => {
  it('no boxes: identity (no zoom)', () => {
    expect(computeCellCrop([])).toEqual({ scale: 1, originX: 50, originY: 50 });
  });

  it('centers the origin on a single box', () => {
    const crop = computeCellCrop([box(0.4, 0.4, 0.6, 0.6)]);
    expect(crop.originX).toBe(50);
    expect(crop.originY).toBe(50);
    // union is 0.2 wide/high → scale = 0.8 / 0.2 = 4
    expect(crop.scale).toBeCloseTo(4);
  });

  it('uses the union of several boxes', () => {
    const crop = computeCellCrop([box(0.1, 0.1, 0.2, 0.2), box(0.5, 0.3, 0.7, 0.4)]);
    // union: x 0.1-0.7 (w=0.6), y 0.1-0.4 (h=0.3) → scale = 0.8/0.6 ≈ 1.33
    expect(crop.originX).toBeCloseTo(40);
    expect(crop.originY).toBeCloseTo(25);
    expect(crop.scale).toBeCloseTo(1.33);
  });

  it('clamps the zoom for tiny boxes', () => {
    const crop = computeCellCrop([box(0.5, 0.5, 0.51, 0.51)]);
    expect(crop.scale).toBe(8);
  });

  it('never zooms out for large boxes', () => {
    const crop = computeCellCrop([box(0.05, 0.05, 0.95, 0.95)]);
    expect(crop.scale).toBe(1);
  });
});
