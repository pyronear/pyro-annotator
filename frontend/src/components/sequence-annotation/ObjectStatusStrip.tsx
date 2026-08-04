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
 * An object's optional `preview` (e.g. a looping cropped image sequence) is
 * never rendered inline — the row is too narrow to make it legible. Instead
 * it shows in a popover anchored beside the label, on hover (after a short
 * delay) or keyboard focus, and is `pointer-events-none` so it can never
 * intercept a click meant for the row or its segments.
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

import React, { useEffect, useRef, useState } from 'react';

/** Delay before the preview popover appears on hover, matching common tooltip conventions. */
const POPOVER_HOVER_DELAY_MS = 150;

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
  /** Optional bigger preview (e.g. a looping cropped image sequence) shown in a popover on hover/focus of the label — purely decorative, non-interactive. */
  preview?: React.ReactNode;
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

/**
 * The swatch + label cluster, wrapped so a preview popover can anchor beside
 * it. Hover (after a short delay) or focus reveals the popover; leaving or
 * blurring hides it immediately. `pointer-events-none` on the popover means
 * it can never swallow a click meant for the row below/beside it.
 */
function ObjectLabelButton({
  objectIndex,
  label,
  color,
  flag,
  preview,
  onClick,
}: {
  objectIndex: number;
  label: string;
  color: string;
  flag: boolean;
  preview?: React.ReactNode;
  onClick?: () => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShowTimer = () => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  };

  const scheduleShow = () => {
    if (!preview) return;
    clearShowTimer();
    showTimer.current = setTimeout(() => setPopoverOpen(true), POPOVER_HOVER_DELAY_MS);
  };

  const hide = () => {
    clearShowTimer();
    setPopoverOpen(false);
  };

  useEffect(() => clearShowTimer, []);

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={scheduleShow}
      onMouseLeave={hide}
      data-testid={`object-status-label-wrap-${objectIndex}`}
    >
      <button
        type="button"
        aria-label={`Go to ${label}`}
        onClick={onClick}
        onFocus={scheduleShow}
        onBlur={hide}
        className="flex shrink-0 items-center gap-2 rounded py-0.5 pr-1 text-left transition-colors hover:bg-ash focus:outline-none focus:ring-2 focus:ring-ember"
      >
        <span
          data-testid={`object-status-swatch-${objectIndex}`}
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="w-20 shrink-0 truncate font-body text-detail text-haze">
          {flag ? `⚑ ${label}` : label}
        </span>
      </button>

      {popoverOpen && preview && (
        <div
          role="tooltip"
          data-testid={`object-status-preview-popover-${objectIndex}`}
          className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 w-80 -translate-y-1/2 overflow-hidden rounded-card border border-line bg-paper p-2"
        >
          {preview}
        </div>
      )}
    </div>
  );
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

  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-paper p-4">
      <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-2">
        {title}
      </div>

      {objects.map((object, objectIndex) => {
        const flag = object.flag ?? false;
        const selected = object.selected ?? false;
        return (
          <div
            key={object.label}
            data-testid={`object-status-row-${objectIndex}`}
            data-flag={flag ? 'true' : undefined}
            data-selected={selected ? 'true' : undefined}
            className={`flex w-full items-center gap-2 rounded-md border-l-[3px] py-1 pl-1 transition-colors ${
              selected ? 'border-l-pine bg-pine-soft' : 'border-l-transparent'
            }`}
          >
            <ObjectLabelButton
              objectIndex={objectIndex}
              label={object.label}
              color={object.color}
              flag={flag}
              preview={object.preview}
              onClick={() => onObjectClick?.(objectIndex)}
            />
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
            {object.action}
          </div>
        );
      })}
    </div>
  );
};
