/**
 * Status computation + frame union for the collocated localize screen
 * (LocalizeAlertPage). Turns an alert's lanes (plus their per-lane
 * detections/detection-annotations) into:
 *
 *  - `frames`: the union of every contributing lane's frame timestamps,
 *    chronologically ordered, each carrying one cell per lane present on
 *    that frame (its cell state and the boxes it would display there) —
 *    feeds `AlertFrameGrid`.
 *  - `objectStatus`: one row per contributing lane, in `ObjectStatusStrip`
 *    shape — feeds the page's status strip(s).
 *
 * A lane "contributes" (renders at all, in either the grid or the strip)
 * only when it has an annotation AND `laneNeedsLocalization` is true —
 * unsure lanes and FP-only lanes are excluded entirely, mirroring the
 * queue's own filter (`LocalizeQueueTable`). Among contributing lanes,
 * `workable` distinguishes the ones still open for localization
 * (`processing_stage === 'seq_annotation_done'`) from already-annotated
 * lanes, which still render as read-only context.
 */

import { AlertLane, Detection, DetectionAnnotation } from '@/types/api';
import { CellState, getCellState, getWinningBoxes } from './quickSubmitUtils';
import { focusOnMainObject } from './gridCropUtils';
import { laneNeedsLocalization } from './localizeUtils';
import { getObjectColor } from './objectColors';
import type {
  ObjectStatusStripObject,
  ObjectStatusStripStatus,
} from '@/components/sequence-annotation/ObjectStatusStrip';

export interface AlertFrameBox {
  xyxyn: [number, number, number, number];
  color: string;
}

/** One lane's presence on one frame, feeding `AlertFrameGrid`'s per-cell render. */
export interface AlertFrameCell {
  laneSequenceId: number;
  detectionId: number;
  cellState: CellState;
  boxes: AlertFrameBox[];
}

export interface AlertFrame {
  recordedAt: string;
  cells: AlertFrameCell[];
}

/** `ObjectStatusStripObject` plus the bits `LocalizeAlertPage` needs to route clicks and split rows by workability. */
export interface AlertObjectStatus extends ObjectStatusStripObject {
  laneSequenceId: number;
  /** True when the lane is still open for localization (`seq_annotation_done`); false for already-annotated context lanes. */
  workable: boolean;
}

export interface AlertFrameModel {
  frames: AlertFrame[];
  objectStatus: AlertObjectStatus[];
}

export function buildAlertFrameModel(
  lanes: AlertLane[],
  detectionsByLaneId: Record<number, Detection[]>,
  annotationsByLaneId: Record<number, DetectionAnnotation[]>
): AlertFrameModel {
  const objectStatus: AlertObjectStatus[] = [];
  // recordedAt -> laneSequenceId -> cell, so each lane's later frame keeps
  // updating the same cell slot if it were ever revisited (it won't be —
  // one detection per lane per timestamp — but keying this way also means
  // insertion order across lanes doesn't matter for correctness).
  const frameMap = new Map<string, Map<number, AlertFrameCell>>();

  lanes.forEach((lane, index) => {
    if (!lane.annotation || !laneNeedsLocalization(lane.annotation)) return;

    const laneSequenceId = lane.sequence.id;
    const color = getObjectColor(index);
    const workable = lane.annotation.processing_stage === 'seq_annotation_done';
    const detections = detectionsByLaneId[laneSequenceId] ?? [];
    const annotationByDetectionId = new Map(
      (annotationsByLaneId[laneSequenceId] ?? []).map(a => [a.detection_id, a])
    );

    const statusByTimestamp: Record<string, ObjectStatusStripStatus> = {};

    for (const detection of detections) {
      const annotation = annotationByDetectionId.get(detection.id);
      const cellState = getCellState(detection, annotation);
      statusByTimestamp[detection.recorded_at] = cellState === 'done' ? 'confirmed' : 'pending';

      const rawBoxes =
        cellState === 'done'
          ? (annotation?.annotation?.annotation ?? [])
              .filter(item => item.false_positive_type == null)
              .map(item => ({ xyxyn: item.xyxyn }))
          : cellState === 'auto'
            ? getWinningBoxes(detection).boxes.map(b => ({ xyxyn: b.xyxyn }))
            : [];
      const boxes: AlertFrameBox[] = focusOnMainObject(detection, rawBoxes).map(b => ({
        xyxyn: b.xyxyn,
        color,
      }));

      let cellsByLane = frameMap.get(detection.recorded_at);
      if (!cellsByLane) {
        cellsByLane = new Map();
        frameMap.set(detection.recorded_at, cellsByLane);
      }
      cellsByLane.set(laneSequenceId, {
        laneSequenceId,
        detectionId: detection.id,
        cellState,
        boxes,
      });
    }

    objectStatus.push({
      label: `Object ${index + 1}`,
      color,
      laneSequenceId,
      workable,
      statusByTimestamp,
    });
  });

  const frames: AlertFrame[] = Array.from(frameMap.entries())
    .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    .map(([recordedAt, cellsByLane]) => ({
      recordedAt,
      cells: Array.from(cellsByLane.values()),
    }));

  return { frames, objectStatus };
}

/**
 * Locates the frame (and owning lane) a given detection id belongs to,
 * across every cell of every frame. Feeds LocalizeAlertPage's `?frame=`
 * deep link — the query param carries a detection id (the shown lane's
 * detection at the moment a segment was clicked), and this resolves it back
 * to a scrollable/highlightable frame on load, without involving the
 * `:detectionId` path param the editor modal owns.
 */
export function findFrameByDetectionId(
  frames: AlertFrame[],
  detectionId: number
): { recordedAt: string; laneSequenceId: number } | null {
  for (const frame of frames) {
    const cell = frame.cells.find(c => c.detectionId === detectionId);
    if (cell) return { recordedAt: frame.recordedAt, laneSequenceId: cell.laneSequenceId };
  }
  return null;
}
