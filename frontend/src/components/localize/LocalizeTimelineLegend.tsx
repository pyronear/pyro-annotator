/**
 * The localize rail's legend wording over the shared `TimelineLegend`
 * (which owns the swatches and chip markup). The labels are the accept
 * popover's, verbatim, so both surfaces teach the same words. The caller
 * passes only the statuses actually on screen (see
 * `timelineLegendStatuses`); `absent` is deliberately not representable
 * here — it is the track showing through, and explaining the background is
 * noise.
 */

import type { TimelineLegendStatus } from '@/utils/annotation/alertLocalizeUtils';
import { TimelineLegend } from '@/components/annotation/TimelineLegend';

const CHIP_LABELS: Record<TimelineLegendStatus, string> = {
  confirmed: 'committed',
  cleared: 'cleared',
  pending: 'model box to accept',
  empty: 'no box',
};

export interface LocalizeTimelineLegendProps {
  /** Statuses present across the rail's rows, already ordered and filtered. */
  statuses: TimelineLegendStatus[];
}

export function LocalizeTimelineLegend({ statuses }: LocalizeTimelineLegendProps) {
  return (
    <TimelineLegend
      testid="localize-timeline-legend"
      entries={statuses.map(status => ({ status, label: CHIP_LABELS[status] }))}
    />
  );
}
