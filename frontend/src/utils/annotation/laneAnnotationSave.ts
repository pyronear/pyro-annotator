/**
 * Create-or-update save for a single detection's smoke annotation, with
 * false-positive item preservation. Extracted from
 * `DetectionSequenceAnnotatePage`'s inline `annotateIndividualDetection`
 * mutation (PATCH-preserving-FP-items vs POST) so the collocated
 * LocalizeAlertPage (Task 4) and the legacy per-lane page share one tested
 * implementation. The legacy page keeps its own inline copy for now
 * (deliberate temporary duplication, pending a later cleanup).
 */

import { apiClient as defaultApiClient } from '@/services/api';
import { DetectionAnnotation, DetectionAnnotationBbox } from '@/types/api';

export interface SaveDetectionReviewParams {
  detectionId: number;
  /** The detection's current committed annotation, or null/undefined to create one. */
  existingAnnotation: DetectionAnnotation | null | undefined;
  /** The reviewed smoke boxes to commit (excludes false-positive items — those are preserved separately). */
  items: DetectionAnnotationBbox[];
  /** Injectable for tests; defaults to the real API client. */
  apiClient?: Pick<
    typeof defaultApiClient,
    'createDetectionAnnotation' | 'updateDetectionAnnotation'
  >;
}

export async function saveDetectionReview({
  detectionId,
  existingAnnotation,
  items,
  apiClient = defaultApiClient,
}: SaveDetectionReviewParams): Promise<DetectionAnnotation> {
  if (existingAnnotation) {
    // False-positive items are not editable smoke rectangles (filtered out of
    // the modal) and must survive a smoke-box edit.
    const falsePositiveItems = (existingAnnotation.annotation?.annotation ?? []).filter(
      item => item.false_positive_type != null
    );
    return apiClient.updateDetectionAnnotation(existingAnnotation.id, {
      annotation: { annotation: [...items, ...falsePositiveItems] },
      processing_stage: 'annotated',
    });
  }

  return apiClient.createDetectionAnnotation({
    detection_id: detectionId,
    annotation: { annotation: items },
    processing_stage: 'annotated',
  });
}
