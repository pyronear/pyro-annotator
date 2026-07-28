/**
 * Crop-mode zoom for grid cells: a CSS transform that magnifies the cell
 * around the union of its displayed boxes so box tightness is judgeable at
 * grid scale. Scaling about the union's center keeps the container fully
 * covered for any scale >= 1 (no blank edges), so no translation is needed.
 */

/** Fraction of the cell the boxes' union should occupy after zoom. */
const TARGET_FILL = 0.8;
const MAX_SCALE = 8;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CellCrop {
  /** CSS scale factor (1 = no zoom). */
  scale: number;
  /** transform-origin, in % of the element. */
  originX: number;
  originY: number;
}

export function computeCellCrop(boxes: { xyxyn: number[] }[]): CellCrop {
  if (boxes.length === 0) return { scale: 1, originX: 50, originY: 50 };

  let x1 = 1,
    y1 = 1,
    x2 = 0,
    y2 = 0;
  for (const b of boxes) {
    x1 = Math.min(x1, b.xyxyn[0]);
    y1 = Math.min(y1, b.xyxyn[1]);
    x2 = Math.max(x2, b.xyxyn[2]);
    y2 = Math.max(y2, b.xyxyn[3]);
  }

  const span = Math.max(x2 - x1, y2 - y1);
  const scale = Math.min(MAX_SCALE, Math.max(1, TARGET_FILL / Math.max(span, 1e-6)));

  return {
    scale: round2(scale),
    originX: round2(((x1 + x2) / 2) * 100),
    originY: round2(((y1 + y2) / 2) * 100),
  };
}
