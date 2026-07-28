/**
 * Localize quick submit: per-frame cell state for the grid glance-check and
 * the batch payloads for one-click lane submit. Reuses the modal's exact
 * submit semantics (getWinningModelLayer + materializeReviewAnnotation with
 * every box accepted) so what the grid shows is what submit records.
 */

import {
  BoundingBox,
  Detection,
  DetectionAnnotation,
  DetectionAnnotationBbox,
  SmokeType,
} from '@/types/api';
import { getWinningModelLayer } from './referenceLayerUtils';
import { materializeReviewAnnotation } from './reviewUtils';

export type CellState = 'done' | 'auto' | 'no-box';

/**
 * Context-aware annotation status for the sequence grid and modal badge.
 * detections-review is optimistic (assume complete unless explicitly not);
 * localize reflects the committed stage so done frames stay marked; the
 * generic annotate context always allows edits.
 */
export function getIsAnnotated(
  annotation: DetectionAnnotation | undefined,
  fromContext: string | null
): boolean {
  if (fromContext === 'detections-review') {
    if (!annotation) return true; // Loading state: assume completed
    return (
      annotation.processing_stage === 'annotated' ||
      annotation.processing_stage === 'bbox_annotation'
    );
  }
  if (fromContext === 'localize') {
    // Localize context: the grid needs a persistent done state per frame
    return annotation?.processing_stage === 'annotated';
  }
  // Annotate context: always allow edits regardless of stage
  return false;
}

/** The winning model layer's boxes for a detection (auto if ≥1 box, else engine). */
export function getWinningBoxes(detection: Detection) {
  const layer = getWinningModelLayer(detection);
  const boxes =
    layer === 'auto'
      ? (detection.auto_predictions?.predictions ?? [])
      : (detection.algo_predictions?.predictions ?? []);
  return { layer, boxes };
}

export function getCellState(
  detection: Detection,
  annotation: DetectionAnnotation | undefined
): CellState {
  if (annotation?.processing_stage === 'annotated') return 'done';
  return getWinningBoxes(detection).boxes.length > 0 ? 'auto' : 'no-box';
}

/**
 * The lane's committal boxes across all frames, in CroppedImageSequence's
 * input shape: committed smoke boxes for done frames, winning-layer boxes
 * for pending frames, nothing for no-box frames.
 */
export function collectLaneBoxes(
  detections: Detection[],
  annotations: Map<number, DetectionAnnotation>
): BoundingBox[] {
  const out: BoundingBox[] = [];
  for (const detection of detections) {
    const existing = annotations.get(detection.id);
    const state = getCellState(detection, existing);
    const boxes =
      state === 'done'
        ? (existing?.annotation?.annotation ?? []).filter(item => item.false_positive_type == null)
        : state === 'auto'
          ? getWinningBoxes(detection).boxes
          : [];
    for (const box of boxes) {
      out.push({ detection_id: detection.id, xyxyn: box.xyxyn as BoundingBox['xyxyn'] });
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
