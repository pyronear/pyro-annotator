/**
 * Slim per-object presence strip for the collocated classify screen
 * (ClassifyAlertPage). Temporal context + color legend, not an editor: one
 * clickable row per object — color swatch + label + a presence bar across
 * the union of the alert's frame timestamps, filled where that object's
 * lane has a detection at that timestamp, gap otherwise. Pure
 * presentational — the union is computed from props, no data fetching or
 * app state; clicking a row calls back to the page rather than navigating
 * itself, so this component never touches page internals like card refs or
 * active-card state. Presence bar segments are not individually
 * interactive — only the row as a whole.
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
  /** Position in `objects` of the currently active object — its row renders highlighted, mirroring the rail's active row. Omit/null for no highlight. */
  activeIndex?: number | null;
}

export const ObjectPresenceStrip: React.FC<ObjectPresenceStripProps> = ({
  objects,
  onObjectClick,
  activeIndex = null,
}) => {
  if (objects.length < 2) return null;

  // Numeric (chronological) sort, not string sort: same-second timestamps
  // can be serialized both as "...:00Z" and "...:00.500000Z" — the "." in
  // the fractional form sorts before "Z" lexicographically, which would
  // put later, fractional timestamps ahead of earlier, whole-second ones.
  const frameUnion = Array.from(new Set(objects.flatMap(o => o.timestamps))).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );

  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-paper p-4">
      <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-2">
        Object timeline
      </div>

      {objects.map((object, objectIndex) => {
        const presentAt = new Set(object.timestamps);
        const isRowActive = objectIndex === activeIndex;
        return (
          <button
            key={object.label}
            type="button"
            aria-label={`Go to ${object.label}`}
            aria-current={isRowActive || undefined}
            onClick={() => onObjectClick?.(objectIndex)}
            className={`flex w-full items-center gap-2 rounded py-1 pr-1.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ember ${
              isRowActive ? 'bg-ash' : 'hover:bg-ash'
            }`}
          >
            <span
              data-testid={`object-presence-swatch-${objectIndex}`}
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${isRowActive ? 'ring-2 ring-char/20' : ''}`}
              style={{ backgroundColor: object.color }}
            />
            <span
              className={`w-20 shrink-0 truncate font-body text-detail ${
                isRowActive ? 'font-medium text-char' : 'text-haze'
              }`}
            >
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
    </div>
  );
};
