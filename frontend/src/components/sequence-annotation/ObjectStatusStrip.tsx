/**
 * Tri-state, clickable-segment object timeline for the collocated localize
 * screens. One row per object — a color swatch + label button ("Go to
 * Object N") plus a per-frame status bar across the union of the alert's
 * frame timestamps, where each frame is its own button reporting that
 * object's status at that timestamp: `confirmed` (solid fill), `pending`
 * (reduced-opacity fill), or `absent` (neutral track, no fill). Rows with
 * `flag: true` (the ⚑ Missed row) prefix their label with ⚑ and render
 * `pending` segments as a dashed outline instead of a fill, since there's
 * no per-object color identity for a synthetic "missed" lane.
 *
 * Renders for `objects.length >= 1` — unlike ObjectPresenceStrip's ≥2 gate,
 * a single-object alert still benefits from seeing its own frame statuses.
 *
 * The row wrapper is a `div`, not a `button`: since frame segments are
 * themselves buttons, nesting the whole row in a button would nest
 * interactive controls, which is invalid HTML. Only the swatch+label
 * cluster is a button (row-level navigation); segments are separate
 * buttons (per-frame navigation).
 *
 * Pure presentational — the union is computed from props, no data fetching
 * or app state; clicking calls back to the caller rather than navigating
 * itself.
 */

import React from 'react';

export type ObjectStatusStripStatus = 'confirmed' | 'pending' | 'absent';

export interface ObjectStatusStripObject {
  /** e.g. "Object 2" — same numbering as the object's card. */
  label: string;
  /** Stable per-object color (hex) — matches the object's card accent. */
  color: string;
  /** Renders the label with a ⚑ prefix and gives `pending` a dashed outline instead of a fill (the synthetic ⚑ Missed row). */
  flag?: boolean;
  /** This object's status per frame timestamp (ISO string); frames absent from the map render as `absent`. */
  statusByTimestamp: Record<string, ObjectStatusStripStatus>;
}

interface ObjectStatusStripProps {
  objects: ObjectStatusStripObject[];
  /** Called with an object's position in `objects` and the clicked segment's timestamp — the caller owns turning that into navigation. Omit to render segments non-interactively. */
  onSegmentClick?: (objectIndex: number, timestamp: string) => void;
  /** Called with an object's position in `objects` when its label is clicked — the caller owns turning that into "scroll to and activate that object's card." Omit to render labels non-interactively. */
  onObjectClick?: (objectIndex: number) => void;
  title?: string;
}

// Leading columns every row (object rows and the axis row alike) shares, so
// the axis's tick columns line up under the status bars' frame columns: the
// color swatch's width, then the label's width, matching the `gap-2`
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

const SEGMENT_BASE_CLASS =
  'h-full flex-1 rounded-sm p-0 transition-opacity focus:outline-none focus:ring-1 focus:ring-ember';

function segmentAppearance(
  status: ObjectStatusStripStatus,
  color: string,
  flag: boolean
): { className: string; style?: React.CSSProperties } {
  if (status === 'confirmed') {
    return { className: SEGMENT_BASE_CLASS, style: { backgroundColor: color } };
  }
  if (status === 'pending') {
    if (flag) {
      return {
        className: `${SEGMENT_BASE_CLASS} border border-dashed`,
        style: { borderColor: color },
      };
    }
    return { className: `${SEGMENT_BASE_CLASS} opacity-40`, style: { backgroundColor: color } };
  }
  // absent — neutral track, no fill; the row's track background shows through.
  return { className: SEGMENT_BASE_CLASS };
}

export const ObjectStatusStrip: React.FC<ObjectStatusStripProps> = ({
  objects,
  onSegmentClick,
  onObjectClick,
  title = 'Object timeline',
}) => {
  if (objects.length < 1) return null;

  // Numeric (chronological) sort, not string sort: same-second timestamps
  // can be serialized both as "...:00Z" and "...:00.500000Z" — the "." in
  // the fractional form sorts before "Z" lexicographically, which would
  // put later, fractional timestamps ahead of earlier, whole-second ones.
  const frameUnion = Array.from(
    new Set(objects.flatMap(o => Object.keys(o.statusByTimestamp)))
  ).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const tickIndices = new Set(computeAxisTickIndices(frameUnion.length));

  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-paper p-4">
      <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-2">
        {title}
      </div>

      {objects.map((object, objectIndex) => {
        const flag = object.flag ?? false;
        return (
          <div
            key={object.label}
            data-testid={`object-status-row-${objectIndex}`}
            data-flag={flag ? 'true' : undefined}
            className="flex w-full items-center gap-2 py-1"
          >
            <button
              type="button"
              aria-label={`Go to ${object.label}`}
              onClick={() => onObjectClick?.(objectIndex)}
              className="flex shrink-0 items-center gap-2 rounded py-0.5 pr-1 text-left transition-colors hover:bg-ash focus:outline-none focus:ring-2 focus:ring-ember"
            >
              <span
                data-testid={`object-status-swatch-${objectIndex}`}
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: object.color }}
              />
              <span className="w-20 shrink-0 truncate font-body text-detail text-haze">
                {flag ? `⚑ ${object.label}` : object.label}
              </span>
            </button>
            <div className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full bg-ash">
              {frameUnion.map((timestamp, frameIndex) => {
                const status = object.statusByTimestamp[timestamp] ?? 'absent';
                const { className, style } = segmentAppearance(status, object.color, flag);
                return (
                  <button
                    key={timestamp}
                    type="button"
                    data-testid={`status-segment-${objectIndex}-${frameIndex}`}
                    aria-label={`${object.label}, frame ${frameIndex + 1}: ${status}`}
                    onClick={() => onSegmentClick?.(objectIndex, timestamp)}
                    className={className}
                    style={style}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Frame axis — hairline + arrowhead + ticks + numbers share the
          object rows' column layout; the "Frame" caption centers under the
          plot area only (excludes the swatch/label spacer, standard
          axis-label placement). Every stroke and label is a recessive
          line/haze token — never an object color — so the status bars
          above stay the dominant layer. */}
      <div data-testid="status-axis" className="pt-2">
        <div className="flex items-center gap-2">
          {LEADING_SPACER}
          <div data-testid="status-axis-line" className="h-px flex-1 bg-line" aria-hidden="true" />
          {/* Directional arrowhead — a CSS border-triangle, not an image,
              kept a few px so it stays subordinate to the data bars. */}
          <span
            data-testid="status-axis-arrow"
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
                      data-testid={`status-axis-tick-${frameIndex}`}
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
            data-testid="status-axis-label"
            className="flex-1 text-center font-data text-[9px] leading-none text-haze"
          >
            Frame
          </div>
        </div>
      </div>
    </div>
  );
};
