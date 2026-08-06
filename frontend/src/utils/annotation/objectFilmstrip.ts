/**
 * The object editor's filmstrip model.
 *
 * The strip spans the ALERT's frame range, not the object's. A lane holds
 * Detection rows only for the frames where its object was detected
 * (object_split.py:198), so an object that the detector picked up late has
 * earlier frames it is simply absent from — 35 of 475 lanes in the
 * development database, missing 12.6 frames on average. Those frames are
 * exactly where fainter smoke hides, so the strip surfaces them; drawing on
 * one materializes a Detection row in the lane (issue #287 — see
 * docs/specs/2026-08-05-gap-frame-materialization-design.md).
 */

import type { Detection, DetectionAnnotation } from '@/types/api';
import type { AlertFrame } from './alertLocalizeUtils';
import { boxCandidates, committedBox, priorityPick, type BoxSource } from './objectBoxCandidates';

/** Where a frame sits relative to the object's own detected span. */
export type FilmstripRun = 'before' | 'object' | 'after';

export interface FilmstripEntry {
  recordedAt: string;
  /** This object's detection when `inObject`; otherwise a sibling lane's, for the image only. */
  detectionId: number;
  /** False when the object was never detected on this frame. */
  inObject: boolean;
  run: FilmstripRun;
  /** The source of the committed box, or null when nothing is committed. */
  committedSource: BoxSource | null;
  /** The source that WOULD be committed, when nothing is yet. Null if no candidate. */
  availableSource: BoxSource | null;
  /**
   * The box the thumbnail crops to — committed if there is one, else the
   * priority pick. Null when the frame offers nothing, in which case the
   * thumbnail shows the uncropped frame.
   */
  xyxyn: [number, number, number, number] | null;
}

/**
 * One entry per alert frame, in the order `frames` gives (chronological, as
 * `buildAlertFrameModel` builds them).
 */
export function buildFilmstripEntries(
  frames: AlertFrame[],
  laneSequenceId: number,
  laneDetections: Detection[],
  laneAnnotations: DetectionAnnotation[]
): FilmstripEntry[] {
  const detectionByTime = new Map(laneDetections.map(d => [d.recorded_at, d]));
  const annotationByDetectionId = new Map(laneAnnotations.map(a => [a.detection_id, a]));

  const objectIndices = frames
    .map((f, i) => (detectionByTime.has(f.recordedAt) ? i : -1))
    .filter(i => i >= 0);
  const first = objectIndices[0] ?? -1;
  const last = objectIndices[objectIndices.length - 1] ?? -1;

  return frames.map((frame, index) => {
    const detection = detectionByTime.get(frame.recordedAt);
    const run: FilmstripRun =
      first < 0 || index < first ? 'before' : index > last ? 'after' : 'object';

    if (!detection) {
      // Any lane's detection at this timestamp is the same photograph.
      const sibling = frame.cells.find(c => c.laneSequenceId !== laneSequenceId);
      return {
        recordedAt: frame.recordedAt,
        detectionId: sibling?.detectionId ?? -1,
        inObject: false,
        run,
        committedSource: null,
        availableSource: null,
        xyxyn: null,
      };
    }

    const annotation = annotationByDetectionId.get(detection.id) ?? null;
    const committed = committedBox(annotation);
    const available = committed ? null : priorityPick(boxCandidates(detection, annotation));

    return {
      recordedAt: frame.recordedAt,
      detectionId: detection.id,
      inObject: true,
      run,
      committedSource: committed?.source ?? null,
      availableSource: available?.source ?? null,
      xyxyn: (committed ?? available)?.xyxyn ?? null,
    };
  });
}
