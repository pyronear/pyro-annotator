/**
 * The added object's track: two anchor boxes, one per end of the selected
 * range, tweened across every frame between them.
 *
 * Weighted by elapsed TIME, not by position in the list. Alert frames are not
 * evenly spaced — `ObjectFilmstrip`'s own docs note cells "can sit anywhere
 * from two seconds to two minutes apart" — so index weighting would put the
 * middle boxes in the wrong place whenever the gaps are uneven, which on these
 * alerts is often.
 *
 * This runs on the client and the full per-frame result is what the
 * add-object request carries, so the strip's preview and the stored data are
 * identical by construction: there is no second interpolation implementation
 * on the server to drift from this one.
 */

export interface RangeBox {
  recordedAt: string;
  xyxyn: [number, number, number, number];
}

export function interpolateRangeBoxes(
  /** The in-range frames' `recorded_at`, chronological. */
  recordedAts: string[],
  /** The box drawn on the first frame of the range. */
  first: [number, number, number, number],
  /** The box drawn on the last frame of the range. */
  last: [number, number, number, number]
): RangeBox[] {
  if (recordedAts.length === 0) return [];
  if (recordedAts.length === 1) return [{ recordedAt: recordedAts[0], xyxyn: first }];

  const times = recordedAts.map(t => new Date(t).getTime());
  const start = times[0];
  const span = times[times.length - 1] - start;

  return recordedAts.map((recordedAt, i) => {
    // A zero span means every frame shares a timestamp — impossible in real
    // data, but dividing by it would yield NaN coordinates, which would be
    // written to the database as a box rather than failing loudly.
    const weight = span === 0 ? 0 : (times[i] - start) / span;
    return {
      recordedAt,
      xyxyn: [
        first[0] + (last[0] - first[0]) * weight,
        first[1] + (last[1] - first[1]) * weight,
        first[2] + (last[2] - first[2]) * weight,
        first[3] + (last[3] - first[3]) * weight,
      ],
    };
  });
}
