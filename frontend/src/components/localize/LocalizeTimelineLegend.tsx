/**
 * The rail's shared key to the object timelines: one wrap-capable line of
 * swatch+label chips explaining the segment encodings the rows above use.
 * Shared rather than per-row because every row speaks the same vocabulary —
 * only the hue changes per object — so the swatches are a single pine and
 * the legend explains the treatment (solid / faded / outline), not the
 * color.
 *
 * The caller passes only the statuses actually on screen (see
 * `timelineLegendStatuses`), so the legend never names a state no row is in
 * — the same filtering the accept popover's legend established. The labels
 * are that popover's, verbatim, so both surfaces teach the same words.
 * `absent` is deliberately not representable here: it is the track showing
 * through, and explaining the background is noise.
 */

import type { CSSProperties } from 'react';
import type { TimelineLegendStatus } from '@/utils/annotation/alertLocalizeUtils';

const CHIP_LABELS: Record<TimelineLegendStatus, string> = {
  confirmed: 'committed',
  cleared: 'cleared',
  pending: 'model box to accept',
  empty: 'no box',
};

// Mirrors `segmentAppearance` in LocalizeObjectRow, in pine: solid fill,
// hatch, 40% fill, inset 1px outline.
const SWATCH_CLASS: Record<TimelineLegendStatus, string> = {
  confirmed: 'bg-pine',
  cleared: '',
  pending: 'bg-pine opacity-40',
  empty: 'ring-1 ring-inset ring-pine',
};

// The cleared swatch hatches in pine exactly as the row segment hatches in
// the object color — Tailwind has no hatch utility, so inline style.
const SWATCH_STYLE: Partial<Record<TimelineLegendStatus, CSSProperties>> = {
  cleared: {
    backgroundImage:
      'repeating-linear-gradient(45deg, #166A5D 0px, #166A5D 2px, transparent 2px, transparent 4px)',
  },
};

export interface LocalizeTimelineLegendProps {
  /** Statuses present across the rail's rows, already ordered and filtered. */
  statuses: TimelineLegendStatus[];
}

export function LocalizeTimelineLegend({ statuses }: LocalizeTimelineLegendProps) {
  if (statuses.length === 0) return null;
  return (
    <div
      data-testid="localize-timeline-legend"
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      {statuses.map(status => (
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
          {CHIP_LABELS[status]}
        </span>
      ))}
    </div>
  );
}
