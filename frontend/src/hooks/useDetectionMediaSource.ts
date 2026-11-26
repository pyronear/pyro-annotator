import { createContext, useContext } from 'react';
import { apiClient } from '@/services/api';
import type { Detection } from '@/types/api';

/**
 * Where the alert players (FullImageSequence, CroppedImageSequence, the
 * whole-alert SequencePlayer) get their frames from. The API by default; the
 * classification training swaps in static frames from public/guide/, so it
 * can run the real cockpit components without an API or a seeded database.
 */
export interface DetectionMediaSource {
  /**
   * Appended to the TanStack Query keys of a non-API source, so its fake
   * detections never share a cache entry with the API's real ones.
   */
  scope: string | null;
  getDetectionImageUrl: (detectionId: number) => Promise<{ url: string }>;
  getSequenceDetections: (sequenceId: number) => Promise<Detection[]>;
}

/** Reads through `apiClient` at call time, so tests that mock it still apply. */
export const API_MEDIA_SOURCE: DetectionMediaSource = {
  scope: null,
  getDetectionImageUrl: detectionId => apiClient.getDetectionImageUrl(detectionId),
  getSequenceDetections: sequenceId => apiClient.getSequenceDetections(sequenceId),
};

export const DetectionMediaSourceContext = createContext<DetectionMediaSource>(API_MEDIA_SOURCE);

export function useDetectionMediaSource(): DetectionMediaSource {
  return useContext(DetectionMediaSourceContext);
}

/** A query key, scoped to the media source when it is not the API. */
export function scopedQueryKey(
  source: DetectionMediaSource,
  key: readonly unknown[]
): readonly unknown[] {
  return source.scope ? [...key, source.scope] : key;
}
