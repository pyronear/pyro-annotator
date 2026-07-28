import { describe, it, expect } from 'vitest';
import { getCellState, buildQuickSubmitPlan } from '@/utils/annotation/quickSubmitUtils';
import type { Detection, DetectionAnnotation } from '@/types/api';

const box = (x1 = 0.1, y1 = 0.1, x2 = 0.3, y2 = 0.3, confidence = 0.9) => ({
  xyxyn: [x1, y1, x2, y2] as [number, number, number, number],
  confidence,
  class_name: 'smoke',
});

const makeDetection = (
  id: number,
  opts: { engine?: ReturnType<typeof box>[]; auto?: ReturnType<typeof box>[] | null } = {}
): Detection =>
  ({
    id,
    sequence_id: 1,
    algo_predictions: { predictions: opts.engine ?? [] },
    auto_predictions: opts.auto === undefined ? null : opts.auto && { predictions: opts.auto },
  }) as unknown as Detection;

const makeAnnotation = (
  detectionId: number,
  stage: DetectionAnnotation['processing_stage'],
  items: DetectionAnnotation['annotation']['annotation'] = []
): DetectionAnnotation =>
  ({
    id: detectionId * 100,
    detection_id: detectionId,
    processing_stage: stage,
    annotation: { annotation: items },
  }) as unknown as DetectionAnnotation;

describe('getCellState', () => {
  it('returns done when the annotation is committed (stage annotated)', () => {
    const d = makeDetection(1, { auto: [box()] });
    expect(getCellState(d, makeAnnotation(1, 'annotated'))).toBe('done');
  });

  it('returns auto when not committed and the auto layer has boxes', () => {
    const d = makeDetection(1, { auto: [box()] });
    expect(getCellState(d, makeAnnotation(1, 'bbox_annotation'))).toBe('auto');
  });

  it('falls back to engine boxes when auto is empty', () => {
    const d = makeDetection(1, { auto: [], engine: [box()] });
    expect(getCellState(d, undefined)).toBe('auto');
  });

  it('returns no-box when neither layer has boxes', () => {
    const d = makeDetection(1, { auto: [], engine: [] });
    expect(getCellState(d, undefined)).toBe('no-box');
  });

  it('a non-annotated stage does not count as done', () => {
    const d = makeDetection(1, { auto: [], engine: [] });
    expect(getCellState(d, makeAnnotation(1, 'visual_check'))).toBe('no-box');
  });
});

describe('buildQuickSubmitPlan', () => {
  it('skips done frames, accepts auto boxes for pending frames', () => {
    const dDone = makeDetection(1, { auto: [box()] });
    const dPending = makeDetection(2, { auto: [box(0.2, 0.2, 0.4, 0.4)] });
    const annotations = new Map([[1, makeAnnotation(1, 'annotated')]]);

    const plan = buildQuickSubmitPlan([dDone, dPending], annotations, 'wildfire');

    expect(plan.payloads).toHaveLength(1);
    expect(plan.payloads[0].detection.id).toBe(2);
    expect(plan.payloads[0].items).toEqual([
      {
        xyxyn: [0.2, 0.2, 0.4, 0.4],
        class_name: 'smoke',
        smoke_type: 'wildfire',
        origin: 'auto',
      },
    ]);
    expect(plan.noBoxCount).toBe(0);
  });

  it('tags engine origin when auto layer is empty', () => {
    const d = makeDetection(1, { auto: [], engine: [box()] });
    const plan = buildQuickSubmitPlan([d], new Map(), 'industrial');
    expect(plan.payloads[0].items[0].origin).toBe('engine');
    expect(plan.payloads[0].items[0].smoke_type).toBe('industrial');
  });

  it('keeps multiple boxes on one frame', () => {
    const d = makeDetection(1, { auto: [box(), box(0.5, 0.5, 0.7, 0.7)] });
    const plan = buildQuickSubmitPlan([d], new Map(), 'wildfire');
    expect(plan.payloads[0].items).toHaveLength(2);
  });

  it('includes no-box frames with empty items and counts them', () => {
    const dEmpty = makeDetection(1, { auto: [], engine: [] });
    const dAuto = makeDetection(2, { auto: [box()] });
    const plan = buildQuickSubmitPlan([dEmpty, dAuto], new Map(), 'wildfire');
    expect(plan.payloads).toHaveLength(2);
    expect(plan.payloads.find(p => p.detection.id === 1)?.items).toEqual([]);
    expect(plan.noBoxCount).toBe(1);
  });

  it('empty lane: no payloads, no warning', () => {
    const plan = buildQuickSubmitPlan([], new Map(), 'wildfire');
    expect(plan.payloads).toEqual([]);
    expect(plan.noBoxCount).toBe(0);
  });
});
