/**
 * Crop-mode zoom for grid cells: a CSS transform that magnifies the cell
 * around the union of its displayed boxes so box tightness is judgeable at
 * grid scale. Scaling about the union's center keeps the container fully
 * covered for any scale >= 1 (no blank edges), so no translation is needed.
 */

import { Detection } from '@/types/api';

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

const intersects = (a: number[], b: number[]): boolean =>
  a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Boxes belonging to the lane's main object: those intersecting one of the
 * frame's engine boxes (`algo_predictions` — the platform track this lane
 * was object-split on). Keeps stray boxes near sibling objects from
 * dragging the crop window. Falls back to all boxes when the frame has no
 * engine anchor or nothing overlaps it.
 */
export function focusOnMainObject<T extends { xyxyn: number[] }>(
  detection: Detection,
  boxes: T[]
): T[] {
  const anchors = detection.algo_predictions?.predictions ?? [];
  if (anchors.length === 0 || boxes.length === 0) return boxes;
  const focused = boxes.filter(b => anchors.some(a => intersects(b.xyxyn, a.xyxyn)));
  return focused.length > 0 ? focused : boxes;
}

/**
 * Tuning for one caller's idea of "framed".
 *
 * The grid's defaults are tight on purpose — a cell is small and the object
 * has to survive being one of many. The object editor passes a lower fill and
 * a lower ceiling, because there the object is the only subject and the sky
 * and ridge around it are what tell you whether the box is on the right
 * plume.
 */
export interface CellCropOptions {
  /** Fraction of the viewport the boxes' union should occupy. */
  targetFill?: number;
  /** Ceiling on the zoom. */
  maxScale?: number;
}

export function computeCellCrop(
  boxes: { xyxyn: number[] }[],
  options: CellCropOptions = {}
): CellCrop {
  const targetFill = options.targetFill ?? TARGET_FILL;
  const maxScale = options.maxScale ?? MAX_SCALE;
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
  const scale = Math.min(maxScale, Math.max(1, targetFill / Math.max(span, 1e-6)));

  return {
    scale: round2(scale),
    originX: round2(((x1 + x2) / 2) * 100),
    originY: round2(((y1 + y2) / 2) * 100),
  };
}

/**
 * Minimal structural shape of `alertLocalizeUtils`' `AlertFrame` — declared
 * here rather than imported, because that module already imports from this
 * one and a real import would be a cycle.
 */
export interface FallbackCropFrame {
  recordedAt: string;
  cells: { laneSequenceId: number; boxes: { xyxyn: number[] }[] }[];
}

/**
 * Inferred crops for the frames where the active lane has no boxes — gap
 * frames (lane present, nothing drawn) and before/after context frames
 * (lane absent). All frames of an alert share one camera pose, so a region
 * borrowed from neighbors is geometrically valid: each boxless frame gets
 * the crop of the union of the nearest boxed frame on each side (only one
 * side exists beyond the object's span). Frames must be chronologically
 * ordered, as `buildAlertFrames` returns them. Boxed frames get no entry —
 * they compute their own crop — and a lane with no boxed frames at all
 * yields an empty map (those cells stay full-frame).
 */
export function computeFallbackCrops(
  frames: FallbackCropFrame[],
  activeLaneId: number | null
): Map<string, CellCrop> {
  const crops = new Map<string, CellCrop>();
  if (activeLaneId === null) return crops;

  type CropBox = { xyxyn: number[] };
  const boxed: (CropBox[] | null)[] = frames.map(f => {
    const cell = f.cells.find(c => c.laneSequenceId === activeLaneId);
    return cell && cell.boxes.length > 0 ? cell.boxes : null;
  });

  const prevNeighbor: (CropBox[] | null)[] = new Array(frames.length);
  let carry: CropBox[] | null = null;
  for (let i = 0; i < frames.length; i++) {
    carry = boxed[i] ?? carry;
    prevNeighbor[i] = carry;
  }
  const nextNeighbor: (CropBox[] | null)[] = new Array(frames.length);
  carry = null;
  for (let i = frames.length - 1; i >= 0; i--) {
    carry = boxed[i] ?? carry;
    nextNeighbor[i] = carry;
  }

  frames.forEach((frame, i) => {
    if (boxed[i]) return;
    const neighbors = [...(prevNeighbor[i] ?? []), ...(nextNeighbor[i] ?? [])];
    if (neighbors.length > 0) crops.set(frame.recordedAt, computeCellCrop(neighbors));
  });
  return crops;
}
