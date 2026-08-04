/**
 * Tests for saveDetectionReview: the create-or-update save for a single
 * detection's smoke annotation, extracted from
 * DetectionSequenceAnnotatePage's inline mutation so the collocated
 * LocalizeAlertPage (Task 4) can share it. Pins the two behaviors that
 * matter most: routing (PATCH vs POST) and false-positive item survival.
 */

import { describe, it, expect, vi } from 'vitest';
import { saveDetectionReview } from '@/utils/annotation/laneAnnotationSave';
import type { DetectionAnnotation, DetectionAnnotationBbox } from '@/types/api';

function makeExistingAnnotation(overrides: Partial<DetectionAnnotation> = {}): DetectionAnnotation {
  return {
    id: 555,
    detection_id: 42,
    annotation: { annotation: [] },
    processing_stage: 'visual_check',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

const smokeItem: DetectionAnnotationBbox = {
  xyxyn: [0.1, 0.1, 0.3, 0.3],
  class_name: 'smoke',
  smoke_type: 'wildfire',
  origin: 'auto',
};

describe('saveDetectionReview', () => {
  it('creates a new annotation (POST) when no existing annotation is present', async () => {
    const createDetectionAnnotation = vi.fn().mockResolvedValue({ id: 999 });
    const updateDetectionAnnotation = vi.fn();

    await saveDetectionReview({
      detectionId: 42,
      existingAnnotation: null,
      items: [smokeItem],
      apiClient: { createDetectionAnnotation, updateDetectionAnnotation },
    });

    expect(createDetectionAnnotation).toHaveBeenCalledWith({
      detection_id: 42,
      annotation: { annotation: [smokeItem] },
      processing_stage: 'annotated',
    });
    expect(updateDetectionAnnotation).not.toHaveBeenCalled();
  });

  it('creates a new annotation when existingAnnotation is undefined', async () => {
    const createDetectionAnnotation = vi.fn().mockResolvedValue({ id: 999 });
    const updateDetectionAnnotation = vi.fn();

    await saveDetectionReview({
      detectionId: 42,
      existingAnnotation: undefined,
      items: [smokeItem],
      apiClient: { createDetectionAnnotation, updateDetectionAnnotation },
    });

    expect(createDetectionAnnotation).toHaveBeenCalledTimes(1);
  });

  it('updates the existing annotation (PATCH) when one is present', async () => {
    const createDetectionAnnotation = vi.fn();
    const updateDetectionAnnotation = vi.fn().mockResolvedValue({ id: 555 });
    const existing = makeExistingAnnotation();

    await saveDetectionReview({
      detectionId: 42,
      existingAnnotation: existing,
      items: [smokeItem],
      apiClient: { createDetectionAnnotation, updateDetectionAnnotation },
    });

    expect(updateDetectionAnnotation).toHaveBeenCalledWith(555, {
      annotation: { annotation: [smokeItem] },
      processing_stage: 'annotated',
    });
    expect(createDetectionAnnotation).not.toHaveBeenCalled();
  });

  it('preserves existing false-positive items alongside the new smoke items on update', async () => {
    const falsePositiveItem: DetectionAnnotationBbox = {
      xyxyn: [0.5, 0.5, 0.6, 0.6],
      class_name: 'smoke',
      false_positive_type: 'antenna',
    };
    const existing = makeExistingAnnotation({
      annotation: { annotation: [falsePositiveItem] },
    });
    const updateDetectionAnnotation = vi.fn().mockResolvedValue({ id: 555 });

    await saveDetectionReview({
      detectionId: 42,
      existingAnnotation: existing,
      items: [smokeItem],
      apiClient: { createDetectionAnnotation: vi.fn(), updateDetectionAnnotation },
    });

    expect(updateDetectionAnnotation).toHaveBeenCalledWith(555, {
      annotation: { annotation: [smokeItem, falsePositiveItem] },
      processing_stage: 'annotated',
    });
  });

  it('drops smoke items being replaced but keeps unrelated false-positive items intact', async () => {
    const fpItem: DetectionAnnotationBbox = {
      xyxyn: [0.9, 0.9, 0.95, 0.95],
      class_name: 'smoke',
      false_positive_type: 'glare',
    };
    const staleSmokeItem: DetectionAnnotationBbox = {
      xyxyn: [0.2, 0.2, 0.4, 0.4],
      class_name: 'smoke',
      smoke_type: 'industrial',
    };
    const existing = makeExistingAnnotation({
      annotation: { annotation: [staleSmokeItem, fpItem] },
    });
    const updateDetectionAnnotation = vi.fn().mockResolvedValue({ id: 555 });

    await saveDetectionReview({
      detectionId: 42,
      existingAnnotation: existing,
      items: [smokeItem],
      apiClient: { createDetectionAnnotation: vi.fn(), updateDetectionAnnotation },
    });

    // items[] passed in already represents the full reviewed smoke set — the
    // stale smoke item is not re-added, only the false-positive one survives.
    expect(updateDetectionAnnotation).toHaveBeenCalledWith(555, {
      annotation: { annotation: [smokeItem, fpItem] },
      processing_stage: 'annotated',
    });
  });

  it('defaults to the real apiClient when none is injected', async () => {
    vi.doMock('@/services/api', () => ({
      apiClient: {
        createDetectionAnnotation: vi.fn().mockResolvedValue({ id: 1 }),
        updateDetectionAnnotation: vi.fn(),
      },
    }));
    vi.resetModules();
    const { saveDetectionReview: saveWithDefault } = await import(
      '@/utils/annotation/laneAnnotationSave'
    );
    const { apiClient } = await import('@/services/api');

    await saveWithDefault({ detectionId: 1, existingAnnotation: null, items: [] });

    expect(apiClient.createDetectionAnnotation).toHaveBeenCalledTimes(1);
    vi.doUnmock('@/services/api');
    vi.resetModules();
  });
});
