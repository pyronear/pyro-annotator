/**
 * Square crop geometry for CroppedImageSequence's stable viewport.
 *
 * The visible region is always a square (in image pixels) centered on the
 * track's average bbox. Zoom divides the default side; the square is
 * clamped inside the frame by shifting, never shrinking. See
 * docs/specs/2026-08-04-cropped-view-stable-square-design.md.
 */

/** Object occupies ~1/CONTEXT_FACTOR of the window at default framing. */
export const CONTEXT_FACTOR = 3;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export interface SquareCrop {
  /** Top-left corner and side length, in image pixels. */
  x: number;
  y: number;
  size: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const bboxSidePx = (
  bbox: [number, number, number, number],
  imgWidth: number,
  imgHeight: number
): number => {
  const w = (bbox[2] - bbox[0]) * imgWidth;
  const h = (bbox[3] - bbox[1]) * imgHeight;
  return Math.max(w, h);
};

const defaultSidePx = (
  bbox: [number, number, number, number],
  imgWidth: number,
  imgHeight: number
): number => {
  const side = bboxSidePx(bbox, imgWidth, imgHeight) * CONTEXT_FACTOR;
  const shortDim = Math.min(imgWidth, imgHeight);
  // Degenerate (zero-size) bboxes fall back to the whole short side.
  return side > 0 ? Math.min(side, shortDim) : shortDim;
};

export function computeSquareCrop(
  bbox: [number, number, number, number],
  imgWidth: number,
  imgHeight: number,
  zoom: number
): SquareCrop {
  const effectiveZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const size = defaultSidePx(bbox, imgWidth, imgHeight) / effectiveZoom;
  const cx = ((bbox[0] + bbox[2]) / 2) * imgWidth;
  const cy = ((bbox[1] + bbox[3]) / 2) * imgHeight;
  return {
    x: clamp(cx - size / 2, 0, imgWidth - size),
    y: clamp(cy - size / 2, 0, imgHeight - size),
    size,
  };
}
