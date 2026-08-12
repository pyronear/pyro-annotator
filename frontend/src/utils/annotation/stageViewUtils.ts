/**
 * View math for the box-drawing stage.
 *
 * The stage's view is a scale plus a pan, and the pan is a FRACTION of the
 * image's rendered size rather than layout pixels. That keeps the framing
 * math free of layout — the clamp and the `Z` conversion below are pure
 * numbers — and only the pointer anchor needs to know how big the image
 * actually is, to say where the cursor fell.
 *
 * The transform origin is always the image's centre, so there is exactly one
 * positional knob to solve for. Writing `O` for that centre, the CSS
 * `scale(z) translate(t)` applied to a point `p` in image pixels is
 *
 *     s(p) = O + z * ((p - O) + t * W)
 *
 * with the translate inside the scale. See
 * docs/specs/2026-08-12-localize-pointer-zoom-design.md.
 */

export interface StageView {
  scale: number;
  /** Pan, as a fraction of the image's rendered size. */
  pan: { x: number; y: number };
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

/** What one mouse notch multiplies the zoom by. */
const NOTCH_FACTOR = 1.15;
/** The wheel delta a notch reports, in pixel mode. */
const NOTCH_DELTA = 100;
const SENSITIVITY = Math.log(NOTCH_FACTOR) / NOTCH_DELTA;
/**
 * `deltaMode` units in pixels. Firefox reports 3 LINEs where Chrome reports
 * ~100 pixels for the same notch, so a line is worth about 33.
 */
const LINE_PX = 33;
const PAGE_PX = 400;

const round = (value: number, dp: number): number => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

/**
 * The factor one wheel event should multiply the zoom by. Exponential in the
 * delta, so a step feels the same at 1x and at 6x, and proportional to the
 * delta's size, so a trackpad's stream of small deltas zooms smoothly
 * instead of slamming into the ceiling.
 */
export function wheelZoomFactor(e: { deltaY: number; deltaMode?: number }): number {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
  return Math.exp(-e.deltaY * unit * SENSITIVITY);
}

export function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * The pan that still leaves the image covering its frame. The pan applies
 * inside the scale, so the bound is (z - 1) / 2z — dimensionless, because
 * the pan is a fraction. It is 0 at the full frame, which is what returns
 * the view to centre when the zoom comes back to 1.
 */
export function clampPan(pan: { x: number; y: number }, scale: number): { x: number; y: number } {
  const max = (scale - 1) / (2 * scale);
  const clamp = (value: number) => {
    const clamped = Math.max(-max, Math.min(max, value));
    // Clamping a negative pan to a bound of 0 yields -0, which compares
    // unequal to the 0 every other path produces. Only -0 is normalized:
    // `|| 0` would also swallow a NaN, and a NaN here means the caller
    // measured a geometry that was not there yet — worth surfacing, not
    // rounding into a view that looks deliberate.
    return clamped === 0 ? 0 : clamped;
  };
  return { x: clamp(pan.x), y: clamp(pan.y) };
}

/**
 * Zoom to `nextScale` while holding `cursor` — a normalized image point —
 * still on screen. Solving s(cursor) before = s(cursor) after for the new
 * pan gives t' = (z*t + (z - z')*(c - 0.5)) / z'.
 *
 * The clamp can override the anchor near the edges; letting the anchor win
 * there would be letting blank space in.
 */
export function zoomAtPoint(
  view: StageView,
  cursor: { x: number; y: number },
  nextScale: number
): StageView {
  const z = view.scale;
  const next = clampScale(nextScale);
  const solve = (pan: number, c: number) => (z * pan + (z - next) * (c - 0.5)) / next;
  return {
    scale: next,
    pan: clampPan({ x: solve(view.pan.x, cursor.x), y: solve(view.pan.y, cursor.y) }, next),
  };
}

/**
 * The pan equivalent to a `computeCellCrop` framing, which speaks in
 * transform-origin percentages. Equating the origin-based transform
 * `O' + z(p - O')` with the centred one gives t = (1 - z)(c - 0.5) / z, so
 * the object is framed exactly where the origin version framed it.
 */
export function cropToPan(crop: { scale: number; originX: number; originY: number }): StageView {
  const z = crop.scale;
  const solve = (originPercent: number) => ((1 - z) * (originPercent / 100 - 0.5)) / z;
  return {
    scale: z,
    pan: clampPan({ x: solve(crop.originX), y: solve(crop.originY) }, z),
  };
}

/**
 * The CSS every layer of the stage shares. The pan renders as a percentage
 * so it needs no layout to apply; the rounding is there because a
 * multiplicative zoom step leaves float noise that would otherwise reach the
 * DOM as `scale(1.1499999999999997)`.
 */
export function stageTransform(view: StageView): string {
  return `scale(${round(view.scale, 4)}) translate(${round(view.pan.x * 100, 3)}%, ${round(
    view.pan.y * 100,
    3
  )}%)`;
}
