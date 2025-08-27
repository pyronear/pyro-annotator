import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Detection } from '@/types/api';

/**
 * Hook to fetch all detections in a sequence, ordered chronologically
 */
export function useSequenceDetections(sequenceId: number | null, enabled: boolean = true) {
  return useQuery({
    queryKey: QUERY_KEYS.SEQUENCE_DETECTIONS(sequenceId!),
    queryFn: async () => {
      if (!sequenceId) throw new Error('Sequence ID is required');
      return await apiClient.getSequenceDetections(sequenceId);
    },
    enabled: enabled && !!sequenceId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch detection image URL
 */
export function useDetectionImage(detectionId: number | null, enabled: boolean = true) {
  return useQuery({
    queryKey: QUERY_KEYS.DETECTION_IMAGE_URL(detectionId!),
    queryFn: async () => {
      if (!detectionId) throw new Error('Detection ID is required');
      return apiClient.getDetectionImageUrl(detectionId);
    },
    enabled: enabled && !!detectionId,
    staleTime: 1000 * 60 * 10, // 10 minutes (images don't change)
  });
}

/**
 * Extended Detection type with image URL for the player
 */
export interface DetectionWithImage extends Detection {
  imageUrl?: string;
  imageLoaded?: boolean;
  imageError?: boolean;
}
