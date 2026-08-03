/**
 * Slim per-object presence strip for the collocated classify screen
 * (ClassifyAlertPage). Temporal context + color legend, not an editor: one
 * clickable row per object — color swatch + label + a presence bar across
 * the union of the alert's frame timestamps, filled where that object's
 * lane has a detection at that timestamp, gap otherwise — plus a real axis
 * beneath the rows: a hairline axis line with a directional arrowhead,
 * tick marks + frame numbers at the same adaptive columns, and a "Frame"
 * axis label. The axis is deliberately recessive (all `line`/`haze`
 * tokens, never an object color) so the presence bars stay the dominant
 * layer. Pure presentational — the union is computed from props, no data
 * fetching or app state; clicking a row calls back to the page rather than
 * navigating itself, so this component never touches page internals like
 * card refs or active-card state. Presence bar segments are not
 * individually interactive — only the row as a whole.
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
  /** Called with an object's position in `objects` when its row is clicked — the caller (ClassifyAlertPage) owns turning that into "scroll to and activate that object's card." Omit to render rows non-interactively. */
  onObjectClick?: (objectIndex: number) => void;
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

export const ObjectPresenceStrip: React.FC<ObjectPresenceStripProps> = ({
  objects,
  onObjectClick,
}) => {
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
    <div className="space-y-2.5 rounded-lg border border-line bg-paper p-4">
      <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-2">
        Object timeline
      </div>

      {objects.map((object, objectIndex) => {
        const presentAt = new Set(object.timestamps);
        return (
          <button
            key={object.label}
            type="button"
            aria-label={`Go to ${object.label}`}
            onClick={() => onObjectClick?.(objectIndex)}
            className="flex w-full items-center gap-2 rounded py-1 text-left transition-colors hover:bg-ash focus:outline-none focus:ring-2 focus:ring-ember"
          >
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
          </button>
        );
      })}

      {/* Frame axis — hairline + arrowhead + ticks + numbers share the
          object rows' column layout; the "Frame" caption centers under the
          plot area only (excludes the swatch/label spacer, standard
          axis-label placement). Every stroke and label is a recessive
          line/haze token — never an object color — so the presence bars
          above stay the dominant layer. */}
      <div data-testid="presence-axis" className="pt-2">
        <div className="flex items-center gap-2">
          {LEADING_SPACER}
          <div
            data-testid="presence-axis-line"
            className="h-px flex-1 bg-line"
            aria-hidden="true"
          />
          {/* Directional arrowhead — a CSS border-triangle, not an image,
              kept a few px so it stays subordinate to the data bars. */}
          <span
            data-testid="presence-axis-arrow"
            aria-hidden="true"
            className="block h-0 w-0 shrink-0 border-y-[3px] border-l-[4px] border-y-transparent border-l-line"
          />
        </div>
        <div className="flex items-start gap-2 mt-1">
          {LEADING_SPACER}
          <div className="flex flex-1">
            {frameUnion.map((timestamp, frameIndex) => (
              <div key={timestamp} className="flex flex-1 flex-col items-center">
                {tickIndices.has(frameIndex) && (
                  <>
                    <span className="h-[3px] w-px bg-line" aria-hidden="true" />
                    <span
                      data-testid={`presence-axis-tick-${frameIndex}`}
                      className="mt-0.5 font-data text-[10px] leading-none text-haze"
                    >
                      {frameIndex + 1}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {LEADING_SPACER}
          <div
            data-testid="presence-axis-label"
            className="flex-1 text-center font-data text-[9px] leading-none text-haze"
          >
            Frame
          </div>
        </div>
      </div>
    </div>
  );
};
