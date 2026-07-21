/**
 * Unit tests for bounding-box move/resize geometry.
 */

import { describe, it, expect } from 'vitest';
import { moveBox, resizeBox, Box } from '@/utils/annotation';

describe('moveBox', () => {
  it('translates by the delta, preserving size', () => {
    expect(moveBox([0.2, 0.2, 0.4, 0.5], 0.1, -0.1)).toEqual([
      0.30000000000000004, 0.1, 0.5, 0.4,
    ]);
  });

  it('clamps to keep the box inside [0,1]', () => {
    const [x1, y1, x2, y2] = moveBox([0.8, 0.8, 0.95, 0.95], 0.5, 0.5);
    expect(x2).toBeCloseTo(1);
    expect(y2).toBeCloseTo(1);
    expect(x2 - x1).toBeCloseTo(0.15);
    expect(y2 - y1).toBeCloseTo(0.15);
  });
});

describe('resizeBox', () => {
  it('se handle moves only the bottom-right corner', () => {
    expect(resizeBox([0.2, 0.2, 0.4, 0.4], 'se', 0.1, 0.1)).toEqual([
      0.2, 0.2, 0.5, 0.5,
    ]);
  });

  it('nw handle moves only the top-left corner', () => {
    const r = resizeBox([0.2, 0.2, 0.4, 0.4], 'nw', 0.05, 0.05);
    expect(r[0]).toBeCloseTo(0.25);
    expect(r[1]).toBeCloseTo(0.25);
    expect(r[2]).toBeCloseTo(0.4);
    expect(r[3]).toBeCloseTo(0.4);
  });

  it('e handle moves only the right edge', () => {
    const r = resizeBox([0.2, 0.2, 0.4, 0.6], 'e', 0.1, 0.2);
    expect(r[0]).toBeCloseTo(0.2);
    expect(r[1]).toBeCloseTo(0.2);
    expect(r[2]).toBeCloseTo(0.5);
    expect(r[3]).toBeCloseTo(0.6); // unchanged: e doesn't touch y
  });

  it('re-normalizes when a corner is dragged past the opposite edge', () => {
    const r = resizeBox([0.2, 0.2, 0.4, 0.4], 'e', -0.3, 0) as Box;
    expect(r[0]).toBeLessThanOrEqual(r[2]); // x1 <= x2 after normalization
  });

  it('keeps a minimum size', () => {
    const r = resizeBox([0.2, 0.2, 0.4, 0.4], 'e', -0.2, 0);
    expect(r[2] - r[0]).toBeGreaterThan(0);
  });
});
