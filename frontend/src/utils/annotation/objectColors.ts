/**
 * Stable per-object color identity for the collocated classify screen
 * (ClassifyAlertPage). One color per object (lane-track), assigned by its
 * position in the page's flattened, stably-ordered render list, reused
 * everywhere that object shows up: the card's accent swatch, the shared
 * player's track overlay, and every other card's dimmed sibling overlay in
 * its full-frame view.
 */

// Categorical identity palette — distinct from (never reused as) the app's
// ember/pine/signal semantic accent tokens in DESIGN.md, since those mark
// specific meanings (CTA, positive, attention) rather than arbitrary object
// identity. Order and hues are colorblind-validated (adjacent-pair CVD +
// normal-vision ΔE floors, OKLab) via the dataviz skill's palette
// methodology, one hue swapped for an earthy sienna in place of a pure red
// so no object color reads as the reserved signal/error hue.
const OBJECT_COLOR_PALETTE = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // amber
  '#e87ba4', // rose
  '#008300', // green
  '#4a3aa7', // violet
  '#a0522d', // sienna
];

export function getObjectColor(index: number): string {
  return OBJECT_COLOR_PALETTE[index % OBJECT_COLOR_PALETTE.length];
}

/** One object's track boxes, keyed by frame `recorded_at`, for rendering on any surface. */
export interface ObjectOverlay {
  /** Stable per-object color (hex) — matches the object's card accent. */
  color: string;
  /** e.g. "Object 2" — shown as a small overlay label. */
  label: string;
  /** Detection `recorded_at` (ISO string) -> this object's box on that frame. Frames the object is absent from are simply missing keys. */
  boxesByRecordedAt: Record<string, [number, number, number, number]>;
  /** Shared player only: the active card's object renders full-strength, others dimmed. Ignored by a card's own sibling overlay list (always dimmed there). */
  isActive?: boolean;
}
