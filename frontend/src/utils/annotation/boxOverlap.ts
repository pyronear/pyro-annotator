/**
 * How well a drawn box matches a reference box, for the localization
 * training exercise.
 */

export type NormalizedBox = [number, number, number, number];

const area = ([x1, y1, x2, y2]: NormalizedBox) => Math.max(0, x2 - x1) * Math.max(0, y2 - y1);

/** Intersection over union of two normalized xyxy boxes, in [0, 1]. */
export function boxIoU(a: NormalizedBox, b: NormalizedBox): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const intersection = ix * iy;
  const union = area(a) + area(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

/** The usual detection threshold: half the combined area must be shared. */
export const MATCH_IOU = 0.5;

export type BoxMismatch = 'missed' | 'too-loose' | 'too-tight' | 'off-centre';

/**
 * Why a box failed to match, phrased as the one thing to fix. Size is judged
 * first: a box twice the plume's size can't be fixed by moving it.
 */
export function boxMismatch(drawn: NormalizedBox, reference: NormalizedBox): BoxMismatch {
  if (boxIoU(drawn, reference) === 0) return 'missed';
  const ratio = area(drawn) / (area(reference) || 1);
  if (ratio > 1.6) return 'too-loose';
  if (ratio < 0.6) return 'too-tight';
  return 'off-centre';
}
