/**
 * Tri-state, clickable-segment object timeline for the collocated localize
 * screens. One row per object — a color swatch + label button ("Go to
 * Object N") plus a per-frame status bar across the union of the alert's
 * frame timestamps, where each frame is its own button reporting that
 * object's status at that timestamp: `confirmed` (solid fill), `pending`
 * (reduced-opacity fill), or `absent` (neutral track, no fill).
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
 * `selected` gives a row an unmistakable accent treatment (fill + left
 * border) — LocalizeAlertPage's object-focus mode uses it to mark whichever
 * object is currently focused.
 *
 * No frame axis here (dropped — the strip's segments read fine without tick
 * labels at this scale); `ObjectPresenceStrip` (classify) is unaffected and
 * keeps its own axis.
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
  /** This object's status per frame timestamp (ISO string); frames absent from the map render as `absent`. */
  statusByTimestamp: Record<string, ObjectStatusStripStatus>;
  /** Optional action (e.g. a quick-accept button) rendered at the row's trailing edge. */
  action?: React.ReactNode;
  /** Renders the row with an accent fill + left border — this object's current "focused" state. */
  selected?: boolean;
}

interface ObjectStatusStripProps {
  objects: ObjectStatusStripObject[];
  /** Called with an object's position in `objects` and the clicked segment's timestamp — the caller owns turning that into navigation. Omit to render segments non-interactively. */
  onSegmentClick?: (objectIndex: number, timestamp: string) => void;
  /** Called with an object's position in `objects` when its label is clicked — the caller owns turning that into "scroll to and activate that object's card." Omit to render labels non-interactively. */
  onObjectClick?: (objectIndex: number) => void;
  title?: string;
}

function ObjectLabelButton({
  objectIndex,
  label,
  color,
  onClick,
}: {
  objectIndex: number;
  label: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Go to ${label}`}
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 rounded py-0.5 pr-1 text-left transition-colors hover:bg-ash focus:outline-none focus:ring-2 focus:ring-ember"
    >
      <span
        data-testid={`object-status-swatch-${objectIndex}`}
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="w-20 shrink-0 truncate font-body text-detail text-haze">{label}</span>
    </button>
  );
}

const SEGMENT_BASE_CLASS =
  'h-full flex-1 rounded-sm p-0 transition-opacity focus:outline-none focus:ring-1 focus:ring-ember';

function segmentAppearance(
  status: ObjectStatusStripStatus,
  color: string
): { className: string; style?: React.CSSProperties } {
  if (status === 'confirmed') {
    return { className: SEGMENT_BASE_CLASS, style: { backgroundColor: color } };
  }
  if (status === 'pending') {
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

  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-paper p-4">
      <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-2">
        {title}
      </div>

      {objects.map((object, objectIndex) => {
        const selected = object.selected ?? false;
        return (
          <div
            key={object.label}
            data-testid={`object-status-row-${objectIndex}`}
            data-selected={selected ? 'true' : undefined}
            className={`flex w-full items-center gap-2 border-l-[3px] py-1 pl-1 transition-colors ${
              selected ? 'border-l-pine bg-pine-soft' : 'border-l-transparent'
            }`}
          >
            <ObjectLabelButton
              objectIndex={objectIndex}
              label={object.label}
              color={object.color}
              onClick={() => onObjectClick?.(objectIndex)}
            />
            <div className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full bg-ash">
              {frameUnion.map((timestamp, frameIndex) => {
                const status = object.statusByTimestamp[timestamp] ?? 'absent';
                const { className, style } = segmentAppearance(status, object.color);
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
            {object.action}
          </div>
        );
      })}
    </div>
  );
};
