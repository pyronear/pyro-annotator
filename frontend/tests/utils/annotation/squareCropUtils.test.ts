import { describe, it, expect } from 'vitest';
import {
  computeSquareCrop,
  maxSquareZoom,
  CONTEXT_FACTOR,
  MAX_ZOOM,
} from '@/utils/annotation/squareCropUtils';

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

  it('never zooms past the bbox+pad framing', () => {
    const zMax = maxSquareZoom(BBOX, IMG_W, IMG_H);
    const crop = computeSquareCrop(BBOX, IMG_W, IMG_H, zMax * 2); // over-ask
    expect(crop.size).toBeCloseTo(384 / zMax);
    // bbox (128px wide) plus 20% pad still fits.
    expect(crop.size).toBeGreaterThanOrEqual(128 * 1.2 - 0.001);
  });

  it('handles a degenerate zero-size bbox with a whole-short-side square', () => {
    const dot: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
    const crop = computeSquareCrop(dot, IMG_W, IMG_H, 1);
    expect(crop.size).toBeCloseTo(IMG_H);
  });
});

describe('maxSquareZoom', () => {
  it('is defaultSide / (bboxSide * 1.2), capped at MAX_ZOOM', () => {
    // defaultSide 384, bbox larger side 128 → 384 / 153.6 = 2.5
    expect(maxSquareZoom(BBOX, IMG_W, IMG_H)).toBeCloseTo(2.5);
  });

  it('equals CONTEXT_FACTOR / pad for uncapped framings (tiny boxes) and stays under MAX_ZOOM', () => {
    // Uncapped default side = bboxSide * CONTEXT_FACTOR, so the ratio to
    // the bbox+pad framing is CONTEXT_FACTOR / 1.2 regardless of bbox size.
    const tiny: [number, number, number, number] = [0.5, 0.5, 0.5 + 4 / IMG_W, 0.5 + 4 / IMG_H];
    expect(maxSquareZoom(tiny, IMG_W, IMG_H)).toBeCloseTo(CONTEXT_FACTOR / 1.2);
    expect(maxSquareZoom(tiny, IMG_W, IMG_H)).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it('is at least 1 even for huge boxes', () => {
    const big: [number, number, number, number] = [0, 0, 1, 1];
    expect(maxSquareZoom(big, IMG_W, IMG_H)).toBe(1);
  });
});
