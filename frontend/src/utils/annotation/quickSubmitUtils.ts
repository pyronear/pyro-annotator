/**
 * Localize quick submit: per-frame cell state for the grid glance-check and
 * the batch payloads for one-click lane submit. Every model-layer read in
 * here and in the grid goes through `getWinningBoxes`, so what the grid
 * shows is what submit records — the property this module exists to hold,
 * and the reason that function picks the frame's box itself rather than
 * leaving each caller to choose. Committed boxes are a different matter:
 * those are read straight from the annotation, all of them, because they are
 * already stored and already exported.
 */

import {
  BoundingBox,
  Detection,
  DetectionAnnotation,
  DetectionAnnotationBbox,
  SmokeType,
} from '@/types/api';
import { focusOnMainObject } from './gridCropUtils';
import { getWinningModelLayer } from './referenceLayerUtils';
import { materializeReviewAnnotation } from './reviewUtils';

export type CellState = 'done' | 'auto' | 'no-box';

/**
 * Context-aware annotation status for the sequence grid and modal badge.
 * Done mode (/localize/done/…) is optimistic (assume complete unless
 * explicitly not); queue mode (/localize/…) reflects the committed stage so
 * done frames stay marked.
 */
export function getIsAnnotated(
  annotation: DetectionAnnotation | undefined,
  mode?: 'done'
): boolean {
  if (mode === 'done') {
    if (!annotation) return true; // Loading state: assume completed
    return (
      annotation.processing_stage === 'annotated' ||
      annotation.processing_stage === 'bbox_annotation'
    );
  }
  // Queue mode: the grid needs a persistent done state per frame
  return annotation?.processing_stage === 'annotated';
}

/**
 * The winning model layer's box for a detection (auto if ≥1 box, else
 * engine), as a list of AT MOST ONE.
 *
 * The layer itself can hold several: the sensitive model runs at a 0.01
 * confidence floor and the worker keeps every prediction overlapping the
 * lane's engine anchor, so a frame's auto layer routinely carries two or
 * three boxes, the runners-up being sub-0.1-confidence noise. But an object
 * has at most one box per frame (`objectBoxCandidates.ts`), and everything
 * downstream of here either DRAWS this box (the grid cell, the preview loop)
 * or COMMITS it (`buildQuickSubmitPlan`). Returning the whole layer meant
 * accept-remaining wrote boxes to the database that no surface had ever
 * shown, and that the export would then ship.
 *
 * The winner is the first box ANCHORED TO THIS FRAME — which for the auto
 * layer means the most confident such box, since the model emits its
 * predictions in descending confidence. (The engine layer carries no
 * ordering guarantee: it arrives from the alert API. No detection in the
 * data has ever had more than one engine box, so which one "first" means
 * there has never mattered; if that changes, sort before slicing.)
 *
 * Anchoring is the point. The head of the list looks like the obvious pick
 * on confidence alone — but the worker's
 * anchor is sequence-wide (`engine_seed_boxes` aggregates the engine boxes
 * of every detection in the lane), so a box survives by matching where the
 * object was on some OTHER frame. On 77 of the 255 multi-box detections in
 * the 2026-08-12 data, the top-confidence box does not overlap its own
 * frame's engine box while a runner-up does; taking the head there would
 * draw and commit a box sitting where the plume isn't. `focusOnMainObject`
 * falls back to the whole list when nothing is anchored, so a frame the
 * engine never boxed still gets its most confident candidate.
 *
 * `boxCandidates` deliberately does NOT go through this function — the
 * editor's rail offers every candidate, which is where a runner-up can still
 * be chosen deliberately — but it orders its own auto candidates the same
 * way, so `priorityPick` and this agree on the default.
 */
export function getWinningBoxes(detection: Detection) {
  const layer = getWinningModelLayer(detection);
  const boxes =
    layer === 'auto'
      ? (detection.auto_predictions?.predictions ?? [])
      : (detection.algo_predictions?.predictions ?? []);
  return { layer, boxes: focusOnMainObject(detection, boxes).slice(0, 1) };
}

/**
 * The boxes to SHOW for a false-positive lane. Its committed annotation is
 * deliberately empty — the backend writes `{"annotation": []}` at ANNOTATED
 * for FP-only lanes, since the human's answer was "no smoke here" — so the
 * engine track the lane was object-split on is the only record of where the
 * object actually is. Deliberately `algo_predictions` rather than
 * `getWinningBoxes`: the split ran on the engine track, so that track is the
 * lane's identity, and a later auto-model box is not.
 *
 * Read-only context only — these are never committed, offered for
 * acceptance, or submitted.
 */
export function falsePositiveContextBoxes(
  detection: Detection
): { xyxyn: [number, number, number, number] }[] {
  return (detection.algo_predictions?.predictions ?? []).map(p => ({ xyxyn: p.xyxyn }));
}

export function getCellState(
  detection: Detection,
  annotation: DetectionAnnotation | undefined
): CellState {
  if (annotation?.processing_stage === 'annotated') return 'done';
  return getWinningBoxes(detection).boxes.length > 0 ? 'auto' : 'no-box';
}

/** A lane box for the preview loop, with the marker that dims a cleared one. */
export interface LaneBox extends BoundingBox {
  /**
   * True on a frame the annotator cleared. The geometry is the model's — the
   * box they rejected — carried only so the loop still plays the frame and
   * stays framed on the object. The loop draws nothing on a cleared frame.
   */
  cleared?: boolean;
}

/**
 * The lane's committal boxes across all frames, in CroppedImageSequence's
 * input shape: committed smoke boxes for done frames, winning-layer boxes
 * for pending frames, nothing for no-box frames.
 *
 * `options.markCleared` adds the cleared frames: committed but deliberately
 * empty, so they have no box to contribute, and dropping them punched a hole
 * the object's track jumped over. They are emitted carrying the rejected
 * model box's geometry, flagged `cleared` — enough for the loop to play the
 * frame and stay framed on the object, while drawing nothing on it. Nothing
 * downstream of the preview reads these — `buildQuickSubmitPlan` decides what
 * gets written, and it skips committed frames outright.
 *
 * It is opt-in because this function cannot tell a cleared frame from a
 * false-positive lane's frame: BOTH are an annotated-stage annotation with no
 * boxes (see `falsePositiveContextBoxes`). Only the caller knows which lane it
 * is holding, so only the caller may ask for the distinction — a caller that
 * forgot `falsePositive` would otherwise start drawing boxes on an FP lane.
 *
 * `options.falsePositive` switches the whole lane to its engine track
 * instead: an FP lane's committed annotation is empty by construction, so
 * the default path would give the flipbook nothing to show. See
 * `falsePositiveContextBoxes`.
 */
export function collectLaneBoxes(
  detections: Detection[],
  annotations: Map<number, DetectionAnnotation>,
  options: { falsePositive?: boolean; markCleared?: boolean } = {}
): LaneBox[] {
  const out: LaneBox[] = [];
  for (const detection of detections) {
    const existing = annotations.get(detection.id);
    const state = getCellState(detection, existing);
    const committedBoxes = (existing?.annotation?.annotation ?? []).filter(
      item => item.false_positive_type == null
    );
    // Committed with nothing on it. An FP lane's annotation is empty by
    // construction, so it is never "cleared" in this sense — it has its own
    // branch below.
    const cleared =
      Boolean(options.markCleared) &&
      !options.falsePositive &&
      state === 'done' &&
      committedBoxes.length === 0;
    const boxes: { xyxyn: number[] }[] = options.falsePositive
      ? falsePositiveContextBoxes(detection)
      : state === 'done'
        ? cleared
          ? getWinningBoxes(detection).boxes
          : committedBoxes
        : state === 'auto'
          ? getWinningBoxes(detection).boxes
          : [];
    // The flipbook frames the lane's main object; stray boxes near sibling
    // objects would skew its averaged crop window.
    for (const box of focusOnMainObject<{ xyxyn: number[] }>(detection, boxes)) {
      out.push({
        detection_id: detection.id,
        xyxyn: box.xyxyn as BoundingBox['xyxyn'],
        ...(cleared ? { cleared: true } : {}),
      });
    }
  }
  return out;
}

export interface QuickSubmitPayload {
  detection: Detection;
  /** Route: PATCH this annotation id, or POST a new one when null. */
  existingAnnotationId: number | null;
  body: {
    annotation: { annotation: DetectionAnnotationBbox[] };
    processing_stage: 'annotated';
  };
}

export interface QuickSubmitPlan {
  payloads: QuickSubmitPayload[];
  noBoxCount: number;
}

export function buildQuickSubmitPlan(
  detections: Detection[],
  annotations: Map<number, DetectionAnnotation>,
  smokeType: SmokeType
): QuickSubmitPlan {
  const payloads: QuickSubmitPayload[] = [];
  let noBoxCount = 0;

  for (const detection of detections) {
    const existing = annotations.get(detection.id);
    const state = getCellState(detection, existing);
    if (state === 'done') continue;
    if (state === 'no-box') noBoxCount += 1;

    const { layer, boxes } = getWinningBoxes(detection);
    const items = materializeReviewAnnotation({
      winningBoxes: boxes,
      winningLayer: layer,
      rejected: new Set(),
      humanRects: [],
      smokeType,
    });
    // Preserve false-positive items: they are not editable rectangles and
    // must survive the accept (same rule as the modal submit).
    const falsePositiveItems = (existing?.annotation?.annotation ?? []).filter(
      item => item.false_positive_type != null
    );

    payloads.push({
      detection,
      existingAnnotationId: existing?.id ?? null,
      body: {
        annotation: { annotation: [...items, ...falsePositiveItems] },
        processing_stage: 'annotated',
      },
    });
  }

  return { payloads, noBoxCount };
}
