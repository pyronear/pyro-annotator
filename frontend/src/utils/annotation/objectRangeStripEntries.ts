/**
 * The add-object range strip's model: one entry per ALERT frame, flagged by
 * whether the object being added covers it.
 *
 * Deliberately NOT `buildFilmstripEntries`. That builder derives its runs from
 * a lane's detected span and its states from box provenance (manual / auto /
 * engine, committed versus merely offered) — and the object being added has no
 * lane and no sources at all, so nearly every state it can express is
 * unreachable here. This is the two-state version: in range or out, plus the
 * two anchors the human draws on and, once both are drawn, the interpolated
 * box each in-range frame will receive.
 */

import type { AlertFrame } from './alertLocalizeUtils';
import { fillRangeBoxes } from './objectRangeBoxes';

export interface RangeStripEntry {
  recordedAt: string;
  /**
   * Any lane's detection at this timestamp — they are all the same
   * photograph. -1 when no lane is on this frame, which the thumbnail
   * renders as a blank rather than fetching.
   */
  detectionId: number;
  inRange: boolean;
  /** The first or last frame of the range — the ends, shown more heavily. */
  isAnchor: boolean;
  /** The box this frame would receive; null until one has been drawn. */
  xyxyn: [number, number, number, number] | null;
}

export interface RangeSelection {
  firstRecordedAt: string;
  lastRecordedAt: string;
}

export function buildRangeStripEntries(
  frames: AlertFrame[],
  range: RangeSelection | null,
  /** The box drawn on the first frame, copied across the range. */
  box: [number, number, number, number] | null
): RangeStripEntry[] {
  // ISO-8601 UTC strings compare correctly lexicographically, and
  // `buildAlertFrameModel` passes them through from the API untouched, so
  // string comparison is safe here and avoids parsing every frame twice.
  const inRange = (recordedAt: string) =>
    range != null && recordedAt >= range.firstRecordedAt && recordedAt <= range.lastRecordedAt;

  const rangeStamps = frames.map(f => f.recordedAt).filter(inRange);
  const boxByTime = new Map<string, [number, number, number, number]>(
    box ? fillRangeBoxes(rangeStamps, box).map(b => [b.recordedAt, b.xyxyn] as const) : []
  );

  return frames.map(frame => ({
    recordedAt: frame.recordedAt,
    detectionId: frame.cells[0]?.detectionId ?? -1,
    inRange: inRange(frame.recordedAt),
    isAnchor:
      range != null &&
      (frame.recordedAt === range.firstRecordedAt || frame.recordedAt === range.lastRecordedAt),
    xyxyn: boxByTime.get(frame.recordedAt) ?? null,
  }));
}
