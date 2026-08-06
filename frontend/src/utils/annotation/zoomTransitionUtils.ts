/**
 * Keyframe math for the localize editor's grow-from-cell open/close
 * transition. Pure: rects in, WAAPI keyframes out. See
 * docs/specs/2026-08-06-localize-editor-zoom-transition-design.md.
 */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const ZOOM_OPEN_MS = 340;
export const ZOOM_CLOSE_MS = 260;
export const ZOOM_OPEN_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
export const ZOOM_CLOSE_EASING = 'cubic-bezier(0.4, 0, 1, 1)';
/** Fallback (reduced motion, or no target rect on close): a fast plain fade. */
export const FADE_MS = 120;

/**
 * The editor root's two poses: shrunk onto a grid cell, and full-screen.
 * The root is `fixed inset-0`, so a cell rect in viewport coordinates (as
 * getBoundingClientRect reports) maps to translate+scale with origin 0 0.
 * The scale is non-uniform on purpose — the cell and the viewport have
 * different aspect ratios, and the brief squish is the macOS-zoom feel the
 * mockup comparison chose.
 */
export function zoomKeyframes(
  cell: RectLike,
  viewport: { width: number; height: number }
): { atCell: Keyframe; full: Keyframe } {
  const sx = cell.width / viewport.width;
  const sy = cell.height / viewport.height;
  return {
    atCell: {
      transform: `translate(${cell.left}px, ${cell.top}px) scale(${sx}, ${sy})`,
      opacity: 0.55,
    },
    full: { transform: 'none', opacity: 1 },
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
