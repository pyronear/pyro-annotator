/**
 * Localize quick submit: per-frame cell state for the grid glance-check and
 * the batch payloads for one-click lane submit. Reuses the modal's exact
 * submit semantics (getWinningModelLayer + materializeReviewAnnotation with
 * every box accepted) so what the grid shows is what submit records.
 */

import {
  Detection,
  DetectionAnnotation,
  DetectionAnnotationBbox,
  SmokeType,
} from '@/types/api';
import { getWinningModelLayer } from './referenceLayerUtils';
import { materializeReviewAnnotation } from './reviewUtils';

export type CellState = 'done' | 'auto' | 'no-box';

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

export interface QuickSubmitPlan {
  payloads: { detection: Detection; items: DetectionAnnotationBbox[] }[];
  noBoxCount: number;
}

export function buildQuickSubmitPlan(
  detections: Detection[],
  annotations: Map<number, DetectionAnnotation>,
  smokeType: SmokeType
): QuickSubmitPlan {
  const payloads: QuickSubmitPlan['payloads'] = [];
  let noBoxCount = 0;

  for (const detection of detections) {
    const state = getCellState(detection, annotations.get(detection.id));
    if (state === 'done') continue;
    if (state === 'no-box') noBoxCount += 1;

    const { layer, boxes } = getWinningBoxes(detection);
    payloads.push({
      detection,
      items: materializeReviewAnnotation({
        winningBoxes: boxes,
        winningLayer: layer,
        rejected: new Set(),
        humanRects: [],
        smokeType,
      }),
    });
  }

  return { payloads, noBoxCount };
}
