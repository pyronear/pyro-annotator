/**
 * Slim per-object presence strip for the collocated classify screen
 * (ClassifyAlertPage). Temporal context + color legend, not an editor: one
 * thin row per object — color swatch + label + a presence bar across the
 * union of the alert's frame timestamps, filled where that object's lane
 * has a detection at that timestamp, gap otherwise. Pure presentational —
 * the union is computed from props, no data fetching or app state.
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

export const ObjectPresenceStrip: React.FC<ObjectPresenceStripProps> = ({ objects }) => {
  if (objects.length < 2) return null;

  const frameUnion = Array.from(new Set(objects.flatMap(o => o.timestamps))).sort();

  return (
    <div className="space-y-1.5 rounded-lg border border-gray-200 bg-white p-3">
      {objects.map((object, objectIndex) => {
        const presentAt = new Set(object.timestamps);
        return (
          <div key={object.label} className="flex items-center gap-2">
            <span
              data-testid={`object-presence-swatch-${objectIndex}`}
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: object.color }}
            />
            <span className="w-20 shrink-0 truncate text-xs text-gray-600">{object.label}</span>
            <div className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full bg-gray-100">
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
    </div>
  );
};
