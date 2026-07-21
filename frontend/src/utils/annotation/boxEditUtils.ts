/**
 * Pure geometry for moving and resizing a normalized bounding box during
 * detection annotation. All coordinates are normalized (0..1); deltas are
 * normalized too. Boxes stay within [0,1] and keep a minimum size.
 */

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type Box = [number, number, number, number];

const MIN_SIZE = 0.005;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** Translate a box by (dx, dy), keeping it fully inside [0,1]. */
export function moveBox(box: Box, dx: number, dy: number): Box {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const x1 = clamp(box[0] + dx, 0, 1 - w);
  const y1 = clamp(box[1] + dy, 0, 1 - h);
  return [x1, y1, x1 + w, y1 + h];
}

/**
 * Resize a box by dragging `handle` by (dx, dy). Only the edges the handle
 * touches move; the result is re-normalized (x1<x2, y1<y2), clamped to [0,1],
 * and kept at least MIN_SIZE in each dimension.
 */
export function resizeBox(box: Box, handle: ResizeHandle, dx: number, dy: number): Box {
  let [x1, y1, x2, y2] = box;
  if (handle.includes('w')) x1 = clamp(x1 + dx, 0, 1);
  if (handle.includes('e')) x2 = clamp(x2 + dx, 0, 1);
  if (handle.includes('n')) y1 = clamp(y1 + dy, 0, 1);
  if (handle.includes('s')) y2 = clamp(y2 + dy, 0, 1);

  const nx1 = Math.min(x1, x2);
  const nx2 = Math.max(x1, x2);
  const ny1 = Math.min(y1, y2);
  const ny2 = Math.max(y1, y2);
  return [
    nx1,
    ny1,
    Math.min(1, Math.max(nx2, nx1 + MIN_SIZE)),
    Math.min(1, Math.max(ny2, ny1 + MIN_SIZE)),
  ];
}

/** CSS cursor for each handle (diagonal / straight resize affordance). */
export const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};
