/**
 * Stable per-object color identity for the collocated classify screen
 * (ClassifyAlertPage). One color per object (lane-track), assigned by its
 * position in the page's flattened, stably-ordered render list, reused
 * everywhere that object shows up: the card's accent swatch, the shared
 * player's track overlay, and every other card's dimmed sibling overlay in
 * its full-frame view.
 */

const OBJECT_COLOR_PALETTE = [
  '#3b82f6', // blue
  '#f97316', // orange
  '#a855f7', // purple
  '#14b8a6', // teal
  '#ec4899', // pink
  '#eab308', // yellow
  '#6366f1', // indigo
  '#22c55e', // green
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
