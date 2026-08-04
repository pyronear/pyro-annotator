import { describe, it, expect } from 'vitest';
import { computeSquareCrop, CONTEXT_FACTOR, MAX_ZOOM } from '@/utils/annotation/squareCropUtils';

// 1280x720 frame; bbox 128px wide, 72px tall, centered at (640, 360).
const IMG_W = 1280;
const IMG_H = 720;
const BBOX: [number, number, number, number] = [
  (640 - 64) / IMG_W,
  (360 - 36) / IMG_H,
  (640 + 64) / IMG_W,
  (360 + 36) / IMG_H,
];

describe('computeSquareCrop', () => {
  it('frames the bbox at CONTEXT_FACTOR times its larger side at zoom 1', () => {
    const crop = computeSquareCrop(BBOX, IMG_W, IMG_H, 1);
    expect(crop.size).toBeCloseTo(128 * CONTEXT_FACTOR); // 384
    // Centered on the bbox center.
    expect(crop.x + crop.size / 2).toBeCloseTo(640);
    expect(crop.y + crop.size / 2).toBeCloseTo(360);
  });

  it('caps the default side at the image short dimension', () => {
    // Huge bbox: side would be 3x its 600px height = 1800 > 720.
    const big: [number, number, number, number] = [0.1, 0.05, 0.6, 0.9];
    const crop = computeSquareCrop(big, IMG_W, IMG_H, 1);
    expect(crop.size).toBeCloseTo(IMG_H); // 720
  });

  it('shifts (not shrinks) the square when the bbox center is near an edge', () => {
    // Center near the top-left corner.
    const corner: [number, number, number, number] = [0, 0, 128 / IMG_W, 72 / IMG_H];
    const crop = computeSquareCrop(corner, IMG_W, IMG_H, 1);
    expect(crop.size).toBeCloseTo(384); // unchanged
    expect(crop.x).toBeCloseTo(0); // clamped into the frame
    expect(crop.y).toBeCloseTo(0);
  });

  it('divides the side by zoom, still clamped inside the frame', () => {
    const z1 = computeSquareCrop(BBOX, IMG_W, IMG_H, 1);
    const z2 = computeSquareCrop(BBOX, IMG_W, IMG_H, 2);
    expect(z2.size).toBeCloseTo(z1.size / 2);
    expect(z2.x + z2.size / 2).toBeCloseTo(640); // stays centered
  });

  it('clamps zoom below 1 up to 1', () => {
    const z = computeSquareCrop(BBOX, IMG_W, IMG_H, 0.25);
    expect(z.size).toBeCloseTo(384);
  });

  it('clamps zoom above MAX_ZOOM to MAX_ZOOM', () => {
    const crop = computeSquareCrop(BBOX, IMG_W, IMG_H, MAX_ZOOM * 2); // over-ask
    expect(crop.size).toBeCloseTo(384 / MAX_ZOOM);
  });

  it('handles a degenerate zero-size bbox with a whole-short-side square', () => {
    const dot: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
    const crop = computeSquareCrop(dot, IMG_W, IMG_H, 1);
    expect(crop.size).toBeCloseTo(IMG_H);
  });
});
