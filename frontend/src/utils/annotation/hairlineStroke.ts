/**
 * Box outlines thinner than a CSS border can draw.
 *
 * The annotation stage puts every overlay inside a `scale(zoomLevel)`
 * transform, so a stroke has to be authored at `width / zoom` to keep a
 * constant weight on screen. That is where CSS borders fail us: Blink floors
 * `border-width` to whole pixels and clamps any nonzero value under 1px back
 * up to 1px, so `0.25px` and `1.33px` both resolve to `1px` and the transform
 * then paints them at `zoom` device pixels. Measured in headless Chrome at
 * zoom 3, every authored width from 0.167px to 1.33px painted the same 3px —
 * which silently flattened the whole `SOURCE_WEIGHT` ladder to one width
 * whenever the annotator zoomed in. `outline` is clamped identically.
 *
 * `box-shadow` spread is a PAINT property — no layout rounding, no clamp — and
 * renders a true sub-pixel ring, verified complete and crisp at zoom 1 to 4.
 *
 * This matters because a wildfire at the start of an alert can be a dozen
 * pixels across, and the annotator zooms in precisely because it is small —
 * the moment a border-drawn stroke is at its fattest and sitting on the smoke
 * being traced.
 *
 * Two things were tried and rejected, both of which LOOK right in the DOM and
 * fail only when painted:
 *
 * - Dashed strokes as four `background` gradient bands. Chrome will not
 *   reliably rasterize a band a fraction of a pixel tall; it drops whole
 *   edges rather than anti-aliasing them, so boxes lost their top or right
 *   side as the zoom rose. Sources are distinguished by colour and weight
 *   instead, and every stroke here is solid.
 * - A dark halo behind the stroke. Around a 2-4px border it bought legibility
 *   over bright sky, but at these widths its inner half is thicker than the
 *   stroke it backs and lands ON the smoke. The source colours are high-chroma
 *   hues absent from wildfire scenes, so they carry themselves.
 */

import type { CSSProperties } from 'react';

export interface HairlineStrokeOptions {
  color: string;
  /**
   * Stroke width in screen px, before the zoom division. Values below 1 are
   * anti-aliased to partial alpha and read as missing rather than as thin, so
   * 1 is the practical floor.
   */
  width: number;
  /** The zoom this stroke is rendered inside. */
  scale?: number;
}

/**
 * CSS for one box outline. Returns paint properties only — the caller still
 * owns the box's position and size.
 *
 * The ring is INSET, i.e. painted just inside the box's own rect. An outset
 * ring reads better — it leaves the smoke completely unobscured — but it is
 * painted outside the element, and the stage clips to `overflow-hidden`, so
 * any box reaching the frame edge lost the stroke on that side. Engine boxes
 * are the loosest of the three and hit the edge most often. A CSS border
 * never had this problem because it is part of the element's own box; that is
 * the one thing borders were doing for us here.
 */
export function hairlineStroke({ color, width, scale = 1 }: HairlineStrokeOptions): CSSProperties {
  return { boxShadow: `inset 0 0 0 ${width / scale}px ${color}` };
}
