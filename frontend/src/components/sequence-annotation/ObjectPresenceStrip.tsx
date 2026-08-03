/**
 * Slim per-object presence strip for the collocated classify screen
 * (ClassifyAlertPage). Temporal context + color legend, not an editor: one
 * thin row per object — color swatch + label + a presence bar across the
 * union of the alert's frame timestamps, filled where that object's lane
 * has a detection at that timestamp, gap otherwise — plus a shared
 * frame-number axis beneath the rows, numbering the same columns 1..N in
 * chronological order. Pure presentational — the union is computed from
 * props, no data fetching or app state.
 *
 * Renders nothing for fewer than 2 objects (single-object alerts have no
 * legend to disambiguate).
 */

import React from 'react';

export interface ObjectPresenceStripObject {
  /** e.g. "Object 2" — same numbering as the object's card. */
  label: string;
  /** Stable per-object color (hex) — matches the object's card accent. */
  color: string;
  /** This object's detection `recorded_at` values (ISO strings). */
  timestamps: string[];
}

interface ObjectPresenceStripProps {
  objects: ObjectPresenceStripObject[];
}

// Leading columns every row (object rows and the axis row alike) shares, so
// the axis's tick columns line up under the presence bars' frame columns:
// the color swatch's width, then the label's width, matching the `gap-2`
// rhythm of an object row exactly (see the swatch/label spans below).
const LEADING_SPACER = (
  <>
    <span className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
    <span className="w-20 shrink-0" aria-hidden="true" />
  </>
);

/**
 * Which frame indices (0-based) get a tick label: the first and last frame
 * always, plus intermediate ticks at a step that grows with the frame count
 * — so labels stay legible instead of crowding at typical strip widths.
 * The last tick before the final one is dropped if it would land within one
 * step of it (avoids two labels touching at the right edge).
 */
function computeAxisTickIndices(frameCount: number): number[] {
  if (frameCount <= 0) return [];
  if (frameCount === 1) return [0];

  const maxTicks = 8;
  const step = Math.max(1, Math.ceil((frameCount - 1) / (maxTicks - 1)));
  const indices: number[] = [];
  for (let i = 0; i < frameCount - 1; i += step) indices.push(i);

  const last = frameCount - 1;
  if (indices.length > 0 && last - indices[indices.length - 1] < step) {
    indices.pop();
  }
  indices.push(last);
  return indices;
}

export const ObjectPresenceStrip: React.FC<ObjectPresenceStripProps> = ({ objects }) => {
  if (objects.length < 2) return null;

  // Numeric (chronological) sort, not string sort: same-second timestamps
  // can be serialized both as "...:00Z" and "...:00.500000Z" — the "." in
  // the fractional form sorts before "Z" lexicographically, which would
  // put later, fractional timestamps ahead of earlier, whole-second ones.
  const frameUnion = Array.from(new Set(objects.flatMap(o => o.timestamps))).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );
  const tickIndices = new Set(computeAxisTickIndices(frameUnion.length));

  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-paper p-3">
      <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-1">
        Object timeline
      </div>

      {objects.map((object, objectIndex) => {
        const presentAt = new Set(object.timestamps);
        return (
          <div key={object.label} className="flex items-center gap-2">
            <span
              data-testid={`object-presence-swatch-${objectIndex}`}
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: object.color }}
            />
            <span className="w-20 shrink-0 truncate font-body text-detail text-haze">
              {object.label}
            </span>
            <div className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full bg-ash">
              {frameUnion.map((timestamp, frameIndex) => (
                <div
                  key={timestamp}
                  data-testid={`presence-segment-${objectIndex}-${frameIndex}`}
                  className="h-full flex-1"
                  style={presentAt.has(timestamp) ? { backgroundColor: object.color } : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Frame-number axis — same column layout as the object rows above. */}
      <div data-testid="presence-axis" className="flex items-center gap-2">
        {LEADING_SPACER}
        <div className="flex flex-1 gap-px">
          {frameUnion.map((timestamp, frameIndex) => (
            <div key={timestamp} className="flex-1 text-center">
              {tickIndices.has(frameIndex) && (
                <span
                  data-testid={`presence-axis-tick-${frameIndex}`}
                  className="font-data text-[10px] leading-none text-haze"
                >
                  {frameIndex + 1}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
