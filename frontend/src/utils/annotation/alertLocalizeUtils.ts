/**
 * Status computation + frame union for the collocated localize screen
 * (LocalizeAlertPage). Turns an alert's lanes (plus their per-lane
 * detections/detection-annotations) into:
 *
 *  - `frames`: the union of every contributing lane's frame timestamps,
 *    chronologically ordered, each carrying one cell per lane present on
 *    that frame (its cell state and the boxes it would display there) —
 *    feeds `AlertFrameGrid`.
 *  - `objectStatus`: one row per contributing lane — identity plus
 *    per-frame statuses — feeds the rail's rows and their timeline strips.
 *
 * A lane "contributes" (renders at all, in either the grid or the strip)
 * only when it has an annotation AND `laneNeedsLocalization` is true,
 * mirroring the queue's own filter (`LocalizeQueueTable`). Among
 * contributing lanes, `workable` distinguishes the ones still open for
 * localization (`processing_stage === 'seq_annotation_done'`) from
 * already-annotated lanes, which still render as read-only context.
 *
 * Two kinds of lane fall outside that rule. Unsure lanes are excluded
 * unconditionally. False-positive lanes are excluded by default too, but
 * `options.includeFalsePositives` opts them in as read-only context
 * (`isFalsePositive`, never `workable`) — enough to answer "is that plume
 * already accounted for?" without offering to re-box it.
 */

import {
  AlertLane,
  Detection,
  DetectionAnnotation,
  SequenceAnnotation,
  SmokeType,
} from '@/types/api';
import {
  CellState,
  falsePositiveContextBoxes,
  getCellState,
  getWinningBoxes,
} from './quickSubmitUtils';
import { focusOnMainObject } from './gridCropUtils';
import { laneNeedsLocalization } from './localizeUtils';
import { getObjectColor } from './objectColors';
import { sequenceSmokeType } from './reviewUtils';
import { parseFalsePositiveTypes } from '@/utils/modelAccuracy';

export interface AlertFrameBox {
  xyxyn: [number, number, number, number];
  color: string;
}

/** One lane's presence on one frame, feeding `AlertFrameGrid`'s per-cell render. */
export interface AlertFrameCell {
  laneSequenceId: number;
  detectionId: number;
  cellState: CellState;
  /** The lane's object color — tints markers that don't ride on a box (the cleared chip). */
  color: string;
  /**
   * The object's box on this frame. At most one — see the cap in
   * `buildAlertFrameModel`. Kept as a list because the crop helpers take
   * one, and because an empty cell is a real state (cleared, or no model
   * evidence yet).
   */
  boxes: AlertFrameBox[];
  /** Read-only false-positive context (opt-in) — visible, never openable in the editor. */
  isFalsePositive?: boolean;
}

export interface AlertFrame {
  recordedAt: string;
  cells: AlertFrameCell[];
}

/**
 * One object's state on one alert frame, as its rail-row strip renders it:
 * `confirmed` (committed box), `cleared` (committed with no smoke box — the
 * annotator recorded "object not visible here", e.g. the editor's Clear on
 * an evidence-bearing frame), `pending` (model box waiting to be accepted),
 * `empty` (on the frame with nothing on it yet), `absent` (not on this frame).
 */
export type ObjectFrameStatus = 'confirmed' | 'cleared' | 'pending' | 'empty' | 'absent';

/** Statuses the rail's shared legend can name — every encoding except the neutral track. */
export type TimelineLegendStatus = Exclude<ObjectFrameStatus, 'absent'>;

const LEGEND_STATUS_ORDER: TimelineLegendStatus[] = ['confirmed', 'cleared', 'pending', 'empty'];

/**
 * The union of statuses present across the rail's rows, in the legend's
 * display order. `absent` is the track showing through rather than an
 * encoding, so it is never returned — the legend must not explain the
 * background, and must not name a state no row on screen is in.
 */
export function timelineLegendStatuses(
  statusMaps: Record<string, ObjectFrameStatus>[]
): TimelineLegendStatus[] {
  const present = new Set<ObjectFrameStatus>();
  for (const map of statusMaps) {
    for (const status of Object.values(map)) present.add(status);
  }
  return LEGEND_STATUS_ORDER.filter(status => present.has(status));
}

/** One rail row: the object's identity, its per-frame statuses, and the bits `LocalizeAlertPage` needs to route clicks and split rows by workability. */
export interface AlertObjectStatus {
  /** e.g. "Object 2" — same numbering as the object's rail row and grid overlays. */
  label: string;
  /** Stable per-object color (hex) — matches the row's dot, segment fills, and box color. */
  color: string;
  /** This object's status per frame timestamp (ISO string); frames absent from the map render as `absent`. */
  statusByTimestamp: Record<string, ObjectFrameStatus>;
  laneSequenceId: number;
  /** True when the lane is still open for localization (`seq_annotation_done`); false for already-annotated context lanes. */
  workable: boolean;
  /** What classify decided this object is — shown on its row so you know what you're boxing. */
  smokeType?: SmokeType;
  /** Set on opt-in false-positive context rows; they are never workable. */
  isFalsePositive?: boolean;
  /** The false-positive types classify recorded, for the row's label. */
  falsePositiveTypes?: string[];
}

export interface AlertFrameModel {
  frames: AlertFrame[];
  objectStatus: AlertObjectStatus[];
}

/**
 * A lane classify settled as a false positive: no smoke and no missed smoke,
 * but a definite answer (an unsure lane is a different thing — "don't know",
 * not "confirmed not smoke" — and stays excluded either way).
 */
function isFalsePositiveLane(annotation: SequenceAnnotation): boolean {
  return !laneNeedsLocalization(annotation) && !annotation.is_unsure;
}

export function buildAlertFrameModel(
  lanes: AlertLane[],
  detectionsByLaneId: Record<number, Detection[]>,
  annotationsByLaneId: Record<number, DetectionAnnotation[]>,
  /**
   * Opt in to rendering false-positive lanes as read-only context. Off by
   * default, matching the queue's own rule. On, they answer "is that plume
   * already accounted for?" before someone adds a duplicate object for
   * something classify already rejected.
   */
  options: { includeFalsePositives?: boolean } = {}
): AlertFrameModel {
  const objectStatus: AlertObjectStatus[] = [];
  // recordedAt -> laneSequenceId -> cell, so each lane's later frame keeps
  // updating the same cell slot if it were ever revisited (it won't be —
  // one detection per lane per timestamp — but keying this way also means
  // insertion order across lanes doesn't matter for correctness).
  const frameMap = new Map<string, Map<number, AlertFrameCell>>();

  lanes.forEach((lane, index) => {
    if (!lane.annotation) return;
    const needsLocalization = laneNeedsLocalization(lane.annotation);
    const falsePositive = isFalsePositiveLane(lane.annotation);
    // Unsure lanes are neither, so they fall through and stay excluded.
    if (!needsLocalization && !(falsePositive && options.includeFalsePositives)) return;

    const laneSequenceId = lane.sequence.id;
    // Indexed over ALL lanes, so an object's color and number never shift
    // when the false-positive toggle changes which lanes render.
    const color = getObjectColor(index);
    const workable = !falsePositive && lane.annotation.processing_stage === 'seq_annotation_done';
    const detections = detectionsByLaneId[laneSequenceId] ?? [];
    const annotationByDetectionId = new Map(
      (annotationsByLaneId[laneSequenceId] ?? []).map(a => [a.detection_id, a])
    );

    const statusByTimestamp: Record<string, ObjectFrameStatus> = {};

    for (const detection of detections) {
      const annotation = annotationByDetectionId.get(detection.id);
      const cellState = getCellState(detection, annotation);
      // An FP lane's committed annotation is empty by construction (see
      // `falsePositiveContextBoxes`), so reading it would leave this lane
      // with nothing to draw — no mini-boxes, no crop-mode zoom, and a
      // timeline row stuck at 'empty'. Its engine track is what the
      // read-only context view is for.
      //
      // Capped at ONE box, because an object has at most one box per frame
      // (`objectBoxCandidates.ts`) and nothing upstream enforces it. The
      // model layers are capped at source in `getWinningBoxes`; this cap
      // covers the two paths that don't go through it — a committed
      // annotation, which no constraint stops from holding several items,
      // and an FP lane's engine track.
      //
      // Applied BEFORE `focusOnMainObject` below: that filter has no
      // counterpart in the editor, so letting it choose could leave the grid
      // showing a different box from the one the editor would commit.
      const rawBoxes = (
        falsePositive
          ? falsePositiveContextBoxes(detection)
          : cellState === 'done'
            ? (annotation?.annotation?.annotation ?? [])
                .filter(item => item.false_positive_type == null)
                .map(item => ({ xyxyn: item.xyxyn }))
            : cellState === 'auto'
              ? getWinningBoxes(detection).boxes.map(b => ({ xyxyn: b.xyxyn }))
              : []
      ).slice(0, 1);

      // All three cell states stay distinct on the strip. Collapsing 'auto'
      // and 'no-box' into one "pending" fill made a frame with nothing on it
      // look identical to one with a model box waiting to be accepted — most
      // visibly on a just-added object, whose lane has no predictions at all
      // yet still painted a full, colored timeline.
      //
      // A false-positive lane is settled — it needs no localization work, so
      // its frames read as done-or-nothing rather than borrowing the
      // pending/empty vocabulary of frames still awaiting a box.
      statusByTimestamp[detection.recorded_at] = falsePositive
        ? rawBoxes.length > 0
          ? 'confirmed'
          : 'empty'
        : cellState === 'done'
          ? rawBoxes.length > 0
            ? 'confirmed'
            : // Committed with no smoke box: the annotator's "object not
              // visible here". Settled like confirmed, but the grid has
              // nothing to draw — the strip must say which kind of settled.
              'cleared'
          : cellState === 'auto'
            ? 'pending'
            : 'empty';
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
        color,
        boxes,
        isFalsePositive: falsePositive || undefined,
      });
    }

    objectStatus.push({
      label: `Object ${index + 1}`,
      color,
      laneSequenceId,
      workable,
      smokeType: falsePositive ? undefined : sequenceSmokeType(lane.annotation),
      isFalsePositive: falsePositive || undefined,
      falsePositiveTypes: falsePositive
        ? parseFalsePositiveTypes(lane.annotation.false_positive_types)
        : undefined,
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
 * One object's localization progress over the frames it appears on, as the
 * rail row's fraction and the page's Done checks consume it. `cleared`
 * counts as settled alongside `confirmed` — a cleared frame is a recorded
 * answer ("object not visible here"), not outstanding work — so splitting
 * the status out of `confirmed` doesn't reopen settled lanes. `absent`
 * counts toward neither total: an object isn't behind on a frame it never
 * appeared on.
 */
export function objectLocalizeProgress(statusByTimestamp: Record<string, ObjectFrameStatus>): {
  presentCount: number;
  confirmedCount: number;
} {
  const present = Object.values(statusByTimestamp).filter(status => status !== 'absent');
  const settled = present.filter(status => status === 'confirmed' || status === 'cleared');
  return { presentCount: present.length, confirmedCount: settled.length };
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
