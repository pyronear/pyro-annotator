/**
 * Draw-on-a-gap-frame orchestration (issue #287): materialize a Detection in
 * the lane at this recordedAt (idempotent server-side), then commit the drawn
 * box through the ordinary review save. Two calls by design — a failure
 * between them leaves a boxless in-object frame, which is visible, blocks
 * submit, and is retried by simply drawing again.
 */

import { apiClient as defaultApiClient } from '@/services/api';
import { Detection, DetectionAnnotation, DetectionAnnotationBbox } from '@/types/api';
import { saveDetectionReview } from './laneAnnotationSave';

export interface MaterializeGapFrameParams {
  laneId: number;
  recordedAt: string;
  items: DetectionAnnotationBbox[];
  /** Injectable for tests; defaults to the real API client. */
  apiClient?: Pick<
    typeof defaultApiClient,
    'materializeFrame' | 'createDetectionAnnotation' | 'updateDetectionAnnotation'
  >;
}

export async function materializeGapFrame({
  laneId,
  recordedAt,
  items,
  apiClient = defaultApiClient,
}: MaterializeGapFrameParams): Promise<{
  detection: Detection;
  annotation: DetectionAnnotation;
}> {
  const detection = await apiClient.materializeFrame(laneId, recordedAt);
  const annotation = await saveDetectionReview({
    detectionId: detection.id,
    existingAnnotation: null,
    items,
    apiClient,
  });
  return { detection, annotation };
}
