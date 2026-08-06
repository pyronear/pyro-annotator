import { describe, it, expect, vi } from 'vitest';
import { materializeGapFrame } from '@/utils/annotation/gapFrameMaterialize';
import type { Detection, DetectionAnnotationBbox } from '@/types/api';

const item: DetectionAnnotationBbox = {
  xyxyn: [0.1, 0.1, 0.2, 0.2],
  class_name: 'smoke',
  smoke_type: 'wildfire',
  origin: 'human',
} as DetectionAnnotationBbox;

const newDetection = { id: 5001, sequence_id: 27 } as Detection;

describe('materializeGapFrame', () => {
  it('materializes the frame, then creates the annotation on the new detection', async () => {
    const apiClient = {
      materializeFrame: vi.fn().mockResolvedValue(newDetection),
      createDetectionAnnotation: vi.fn().mockResolvedValue({ id: 1 }),
      updateDetectionAnnotation: vi.fn(),
    };
    const result = await materializeGapFrame({
      laneId: 27,
      recordedAt: '2026-08-05T12:00:00Z',
      items: [item],
      apiClient,
    });
    expect(apiClient.materializeFrame).toHaveBeenCalledWith(27, '2026-08-05T12:00:00Z');
    expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith({
      detection_id: 5001,
      annotation: { annotation: [item] },
      processing_stage: 'annotated',
    });
    expect(apiClient.updateDetectionAnnotation).not.toHaveBeenCalled();
    expect(result.detection).toBe(newDetection);
  });

  it('does not touch annotations when the materialize call fails', async () => {
    const apiClient = {
      materializeFrame: vi.fn().mockRejectedValue(new Error('boom')),
      createDetectionAnnotation: vi.fn(),
      updateDetectionAnnotation: vi.fn(),
    };
    await expect(
      materializeGapFrame({ laneId: 27, recordedAt: 't', items: [item], apiClient })
    ).rejects.toThrow('boom');
    expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalled();
  });
});
