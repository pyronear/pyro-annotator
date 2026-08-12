/**
 * The added object's track: one box, drawn on the first frame of the range and
 * copied to every frame in it.
 *
 * A single box is deliberately a FIRST DRAFT, not a finished track. Smoke grows
 * and drifts, so one box copied across a long range is too small at the end and
 * too big at the start; refining frame by frame in the object editor is the
 * second half of the job. Interpolating between a box on the first frame and
 * one on the last was designed and deferred — see
 * docs/specs/2026-08-11-localize-add-object-design.md — so if this comes back,
 * only this module and the overlay's draw phase change: everything downstream
 * already takes an explicit per-frame box list.
 */

export interface RangeBox {
  recordedAt: string;
  xyxyn: [number, number, number, number];
}

export function fillRangeBoxes(
  /** The in-range frames' `recorded_at`, chronological. */
  recordedAts: string[],
  /** The box drawn on the first frame of the range. */
  box: [number, number, number, number]
): RangeBox[] {
  return recordedAts.map(recordedAt => ({ recordedAt, xyxyn: box }));
}
