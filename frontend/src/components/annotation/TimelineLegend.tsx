/**
 * Shared swatch+label legend for the rails' object timelines (localize's
 * rail via `LocalizeTimelineLegend`, classify's rail directly). One
 * wrap-capable line of chips explaining the segment encodings the rows use.
 * The swatches mirror `segmentAppearance` in `ObjectRowTimeline`, in pine —
 * the legend explains the treatment (solid / faded / outline / bare track),
 * not the per-object color.
 *
 * Callers pass only the statuses actually on screen, each with their own
 * page's wording — the legend never names a state no row is in, and the
 * same status can read "committed" on localize and "Detected" on classify.
 * An empty list renders nothing.
 */

import type { CSSProperties } from 'react';
import type { ObjectFrameStatus } from '@/utils/annotation/alertLocalizeUtils';

const SWATCH_CLASS: Record<ObjectFrameStatus, string> = {
  confirmed: 'bg-pine',
  cleared: '',
  pending: 'bg-pine opacity-40',
  empty: 'ring-1 ring-inset ring-pine',
  // The bare track: classify's rows can be absent on union frames and its
  // legend names that; localize treats absent as background and never
  // passes it.
  absent: 'bg-ash ring-1 ring-inset ring-line',
};

// The cleared swatch hatches in pine exactly as the row segment hatches in
// the object color — Tailwind has no hatch utility, so inline style.
const SWATCH_STYLE: Partial<Record<ObjectFrameStatus, CSSProperties>> = {
  cleared: {
    backgroundImage:
      'repeating-linear-gradient(45deg, #166A5D 0px, #166A5D 2px, transparent 2px, transparent 4px)',
  },
};

export interface TimelineLegendEntry {
  status: ObjectFrameStatus;
  label: string;
}

export interface TimelineLegendProps {
  /** Statuses present across the rail's rows, already ordered and filtered, with page-specific wording. */
  entries: TimelineLegendEntry[];
  /** Root testid — each page keeps its own (`localize-timeline-legend`, `classify-timeline-legend`). */
  testid: string;
}

export function TimelineLegend({ entries, testid }: TimelineLegendProps) {
  if (entries.length === 0) return null;
  return (
    <div data-testid={testid} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {entries.map(({ status, label }) => (
        <span
          key={status}
          data-testid={`legend-chip-${status}`}
          className="flex items-center gap-1.5 font-data text-detail text-haze"
        >
          <span
            aria-hidden
            className={`h-1.5 w-4 rounded-full ${SWATCH_CLASS[status]}`}
            style={SWATCH_STYLE[status]}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
