/**
 * Clickable-segment object timeline for the collocated localize screens. One
 * row per object — a color swatch + label button ("Go to Object N") plus a
 * per-frame status bar across the union of the alert's frame timestamps,
 * where each frame is its own button reporting that object's status at that
 * timestamp: `confirmed` (solid fill), `pending` (reduced-opacity fill — a
 * model box waiting to be accepted), `empty` (outline only — on this frame
 * but with nothing on it yet), or `absent` (neutral track, no fill — not on
 * this frame at all).
 *
 * `empty` is deliberately distinct from `pending`: collapsing the two made a
 * frame with nothing on it look identical to one with a box to accept, which
 * painted a just-added object's whole timeline as if it were already full.
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
 * `variant="bare"` drops the card chrome, title, and per-row label cluster
 * so the strip can embed inside another surface (the accept popover) that
 * already names the object. `playhead` highlights the frame an external
 * animation is currently showing — full-strength fill with an inset
 * marker, since the overflow-hidden track clips outer rings.
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

export type ObjectStatusStripStatus = 'confirmed' | 'pending' | 'empty' | 'absent';

export interface ObjectStatusStripObject {
  /** e.g. "Object 2" — same numbering as the object's card. */
  label: string;
  /** Stable per-object color (hex) — matches the object's card accent. */
  color: string;
  /** This object's status per frame timestamp (ISO string); frames absent from the map render as `absent`. */
  statusByTimestamp: Record<string, ObjectStatusStripStatus>;
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
  /** `bare` drops the card chrome, title, and per-row label cluster so the strip can embed inside another surface (the accept popover) that already names the object. */
  variant?: 'card' | 'bare';
  /** Highlights one object's segment at one timestamp — the frame an external animation is currently showing. */
  playhead?: { objectIndex: number; timestamp: string };
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

// The playhead marker lives INSIDE the segment (inset, merged into the same
// boxShadow as the status styling): the track is `overflow-hidden`, so an
// outer ring or outline would be clipped away at this 6px height.
const PLAYHEAD_SHADOW = 'inset 0 0 0 1px rgba(255,255,255,0.85)';

function segmentAppearance(
  status: ObjectStatusStripStatus,
  color: string,
  playhead: boolean
): { className: string; style?: React.CSSProperties } {
  if (status === 'confirmed') {
    return {
      className: SEGMENT_BASE_CLASS,
      style: { backgroundColor: color, ...(playhead ? { boxShadow: PLAYHEAD_SHADOW } : {}) },
    };
  }
  if (status === 'pending') {
    // The playhead frame is the one an external animation is showing right
    // now — it reads at full strength even though its box is still pending.
    return {
      className: playhead ? SEGMENT_BASE_CLASS : `${SEGMENT_BASE_CLASS} opacity-40`,
      style: { backgroundColor: color, ...(playhead ? { boxShadow: PLAYHEAD_SHADOW } : {}) },
    };
  }
  if (status === 'empty') {
    // Present on this frame, but nothing to show yet — no committed box and
    // no model prediction to accept. An outline in the object's own color
    // keeps it legible as "this object's frame" without the fill that would
    // imply content (a just-added object's whole timeline is this state).
    return {
      className: `${SEGMENT_BASE_CLASS} opacity-50`,
      style: {
        boxShadow: playhead
          ? `inset 0 0 0 1px ${color}, ${PLAYHEAD_SHADOW}`
          : `inset 0 0 0 1px ${color}`,
      },
    };
  }
  // absent — neutral track, no fill; the row's track background shows through.
  return {
    className: SEGMENT_BASE_CLASS,
    style: playhead ? { boxShadow: PLAYHEAD_SHADOW } : undefined,
  };
}

export const ObjectStatusStrip: React.FC<ObjectStatusStripProps> = ({
  objects,
  onSegmentClick,
  onObjectClick,
  title = 'Object timeline',
  variant = 'card',
  playhead,
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
    <div
      className={
        variant === 'card'
          ? 'space-y-2.5 rounded-lg border border-line bg-paper p-4'
          : 'space-y-2.5'
      }
    >
      {variant === 'card' && (
        <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-2">
          {title}
        </div>
      )}

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
            {variant === 'card' && (
              <ObjectLabelButton
                objectIndex={objectIndex}
                label={object.label}
                color={object.color}
                onClick={() => onObjectClick?.(objectIndex)}
              />
            )}
            <div className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full bg-ash">
              {frameUnion.map((timestamp, frameIndex) => {
                const status = object.statusByTimestamp[timestamp] ?? 'absent';
                const isPlayhead =
                  playhead?.objectIndex === objectIndex && playhead.timestamp === timestamp;
                const { className, style } = segmentAppearance(status, object.color, isPlayhead);
                return (
                  <button
                    key={timestamp}
                    type="button"
                    data-testid={`status-segment-${objectIndex}-${frameIndex}`}
                    data-playhead={isPlayhead ? 'true' : undefined}
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
    </div>
  );
};
