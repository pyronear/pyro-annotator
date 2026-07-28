import { describe, it, expect } from 'vitest';
import { getIsAnnotated } from '@/pages/DetectionSequenceAnnotatePage';
import type { DetectionAnnotation } from '@/types/api';

const ann = (stage: DetectionAnnotation['processing_stage']): DetectionAnnotation =>
  ({
    id: 1,
    detection_id: 1,
    processing_stage: stage,
    annotation: { annotation: [] },
  }) as unknown as DetectionAnnotation;

describe('getIsAnnotated', () => {
  it('localize: reflects the committed stage', () => {
    expect(getIsAnnotated(ann('annotated'), 'localize')).toBe(true);
    expect(getIsAnnotated(ann('bbox_annotation'), 'localize')).toBe(false);
    expect(getIsAnnotated(undefined, 'localize')).toBe(false);
  });

  it('detections-review: unchanged optimistic behavior', () => {
    expect(getIsAnnotated(undefined, 'detections-review')).toBe(true);
    expect(getIsAnnotated(ann('annotated'), 'detections-review')).toBe(true);
    expect(getIsAnnotated(ann('bbox_annotation'), 'detections-review')).toBe(true);
    expect(getIsAnnotated(ann('visual_check'), 'detections-review')).toBe(false);
  });

  it('other contexts: still always editable (false)', () => {
    expect(getIsAnnotated(ann('annotated'), null)).toBe(false);
    expect(getIsAnnotated(ann('annotated'), 'something-else')).toBe(false);
  });
});
