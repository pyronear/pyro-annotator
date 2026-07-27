/**
 * Seed-at-submit detection review.
 *
 * The reviewer works against the read-only winning model layer (auto if it has
 * boxes, else engine). Each winning box is pending-accept by default; the
 * reviewer can reject it, or adjust it (reject the original + draw a human copy)
 * or add a new human box. At submit the committed annotation is materialized:
 *   accepted winning boxes (origin auto/engine, sequence smoke_type)
 * + human boxes (origin human, their own smoke_type)
 * The immutable algo_predictions / auto_predictions are never touched.
 */

import {
  AlgoPrediction,
  DetectionAnnotationBbox,
  SequenceAnnotation,
  SmokeType,
} from '@/types/api';
import { DrawnRectangle } from './drawingUtils';
import { ModelLayer } from './referenceLayerUtils';

/**
 * The sequence's classified smoke type, used as the type for accepted model
 * boxes (a model box carries no type of its own). Falls back to 'wildfire' for
 * a smoke sequence that somehow has no recorded type.
 */
export function sequenceSmokeType(
  sequenceAnnotation: SequenceAnnotation | undefined | null
): SmokeType {
  const types = sequenceAnnotation?.smoke_types ?? [];
  return (types[0] as SmokeType) ?? 'wildfire';
}

/**
 * Build the committed detection annotation from the review state.
 * Winning boxes not in `rejected` are accepted (origin = winning layer);
 * human rectangles (added + adjusted copies) are appended (origin = human).
 */
export function materializeReviewAnnotation(params: {
  winningBoxes: AlgoPrediction[];
  winningLayer: ModelLayer;
  rejected: Set<number>;
  humanRects: DrawnRectangle[];
  smokeType: SmokeType;
}): DetectionAnnotationBbox[] {
  const { winningBoxes, winningLayer, rejected, humanRects, smokeType } = params;

  const accepted: DetectionAnnotationBbox[] = winningBoxes
    .filter((_, i) => !rejected.has(i))
    .map(box => ({
      xyxyn: box.xyxyn,
      class_name: 'smoke',
      smoke_type: smokeType,
      origin: winningLayer,
    }));

  const human: DetectionAnnotationBbox[] = humanRects.map(rect => ({
    xyxyn: rect.xyxyn,
    class_name: 'smoke',
    smoke_type: rect.smokeType,
    origin: 'human' as const,
  }));

  return [...accepted, ...human];
}
