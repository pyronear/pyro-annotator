import { describe, it, expect } from 'vitest';
import {
  getCellState,
  getIsAnnotated,
  buildQuickSubmitPlan,
  collectLaneBoxes,
} from '@/utils/annotation/quickSubmitUtils';
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

describe('getIsAnnotated', () => {
  it('queue mode: reflects the committed stage', () => {
    expect(getIsAnnotated(makeAnnotation(1, 'annotated'))).toBe(true);
    expect(getIsAnnotated(makeAnnotation(1, 'bbox_annotation'))).toBe(false);
    expect(getIsAnnotated(undefined)).toBe(false);
  });

  it('done mode: unchanged optimistic behavior', () => {
    expect(getIsAnnotated(undefined, 'done')).toBe(true);
    expect(getIsAnnotated(makeAnnotation(1, 'annotated'), 'done')).toBe(true);
    expect(getIsAnnotated(makeAnnotation(1, 'bbox_annotation'), 'done')).toBe(true);
    expect(getIsAnnotated(makeAnnotation(1, 'visual_check'), 'done')).toBe(false);
  });
});

describe('collectLaneBoxes', () => {
  it('uses committed boxes for done frames, winning boxes for pending, skips no-box and FP items', () => {
    const fpItem = {
      xyxyn: [0.6, 0.6, 0.7, 0.7],
      class_name: 'smoke',
      false_positive_type: 'antenna',
      origin: 'human',
    } as unknown as DetectionAnnotation['annotation']['annotation'][number];
    const committedItem = {
      xyxyn: [0.3, 0.3, 0.4, 0.4],
      class_name: 'smoke',
      smoke_type: 'wildfire',
      origin: 'human',
    } as unknown as DetectionAnnotation['annotation']['annotation'][number];

    const dDone = makeDetection(1, { auto: [box()] });
    const dPending = makeDetection(2, { auto: [box(0.2, 0.2, 0.4, 0.4)] });
    const dEmpty = makeDetection(3, { auto: [], engine: [] });
    const annotations = new Map([[1, makeAnnotation(1, 'annotated', [committedItem, fpItem])]]);

    const result = collectLaneBoxes([dDone, dPending, dEmpty], annotations);

    expect(result).toEqual([
      { detection_id: 1, xyxyn: [0.3, 0.3, 0.4, 0.4] },
      { detection_id: 2, xyxyn: [0.2, 0.2, 0.4, 0.4] },
    ]);
  });

  it('drops boxes away from the frame engine anchor (sibling strays)', () => {
    const d = makeDetection(1, {
      engine: [box(0.2, 0.2, 0.4, 0.4)],
      auto: [box(0.25, 0.25, 0.35, 0.35), box(0.8, 0.8, 0.9, 0.9)],
    });

    const result = collectLaneBoxes([d], new Map());

    expect(result).toEqual([{ detection_id: 1, xyxyn: [0.25, 0.25, 0.35, 0.35] }]);
  });

  it('reads the engine track for a false-positive lane, whose committed annotation is empty', () => {
    // The production shape: an `annotated` detection annotation with an
    // empty box list, and the object's real location in the engine track.
    const detection = makeDetection(1, {
      engine: [box(0.5, 0.5, 0.7, 0.7)],
      auto: [box(0.1, 0.1, 0.2, 0.2)],
    });
    const annotations = new Map([[1, makeAnnotation(1, 'annotated', [])]]);

    // Without the flag, the empty committed annotation wins and the lane
    // contributes nothing — the bug this fixes.
    expect(collectLaneBoxes([detection], annotations)).toEqual([]);

    // With it, the engine track shows through — and beats auto_predictions,
    // because the lane was object-split on the engine track.
    expect(collectLaneBoxes([detection], annotations, { falsePositive: true })).toEqual([
      { detection_id: 1, xyxyn: [0.5, 0.5, 0.7, 0.7] },
    ]);
  });
});

describe('buildQuickSubmitPlan', () => {
  it('keeps a cleared frame in the preview loop, marked rather than dropped', () => {
    // Dropping it made the loop jump a hole in the object's track. It plays,
    // carrying the model box the annotator rejected, flagged so the loop can
    // draw it as not part of the track.
    const cleared = makeDetection(1, { auto: [box()] });
    const pending = makeDetection(2, { auto: [box(0.2, 0.2, 0.4, 0.4)] });
    const annotations = new Map([[1, makeAnnotation(1, 'annotated', [])]]);

    const boxes = collectLaneBoxes([cleared, pending], annotations, { markCleared: true });

    expect(boxes.map(b => b.detection_id)).toEqual([1, 2]);
    expect(boxes[0].cleared).toBe(true);
    expect(boxes[0].xyxyn).toEqual(box().xyxyn);
    // The frames that ARE the track carry no marker.
    expect(boxes[1].cleared).toBeUndefined();
  });

  it('marks nothing on a cleared frame no model boxed — there is no box to show', () => {
    const cleared = makeDetection(1);
    const annotations = new Map([[1, makeAnnotation(1, 'annotated', [])]]);

    expect(collectLaneBoxes([cleared], annotations, { markCleared: true })).toEqual([]);
  });

  it('leaves a committed box unmarked, so a real box never draws as cleared', () => {
    const committed = makeDetection(1, { auto: [box()] });
    const annotations = new Map([
      [
        1,
        makeAnnotation(1, 'annotated', [
          { xyxyn: [0.1, 0.1, 0.3, 0.3], class_name: 'smoke', smoke_type: 'wildfire' },
        ]),
      ],
    ]);

    const boxes = collectLaneBoxes([committed], annotations, { markCleared: true });

    expect(boxes).toHaveLength(1);
    expect(boxes[0].cleared).toBeUndefined();
  });

  it('never marks a false-positive lane cleared — its annotation is empty by construction', () => {
    // The two states are identical in the data (annotated stage, no boxes),
    // so only the caller can tell them apart. Asking for both at once must
    // leave the FP lane on its engine track, unmarked.
    const detection = makeDetection(1, {
      engine: [box(0.5, 0.5, 0.7, 0.7)],
      auto: [box(0.1, 0.1, 0.2, 0.2)],
    });
    const annotations = new Map([[1, makeAnnotation(1, 'annotated', [])]]);

    const boxes = collectLaneBoxes([detection], annotations, {
      falsePositive: true,
      markCleared: true,
    });

    expect(boxes).toEqual([{ detection_id: 1, xyxyn: [0.5, 0.5, 0.7, 0.7] }]);
  });

  it('never re-adds a box to a frame the annotator cleared', () => {
    // The clear leaves the predictions untouched (re-picking one is the
    // undo), so the frame still LOOKS acceptable. Accepting it would
    // silently reinstate the box the annotator just rejected.
    const cleared = makeDetection(1, { auto: [box()], engine: [box()] });
    const pending = makeDetection(2, { auto: [box(0.2, 0.2, 0.4, 0.4)] });
    const annotations = new Map([[1, makeAnnotation(1, 'annotated', [])]]);

    const plan = buildQuickSubmitPlan([cleared, pending], annotations, 'wildfire');

    expect(plan.payloads.map(p => p.detection.id)).toEqual([2]);
  });

  it('leaves a cleared frame empty when it is the only frame', () => {
    const cleared = makeDetection(1, { auto: [box()] });
    const annotations = new Map([[1, makeAnnotation(1, 'annotated', [])]]);

    const plan = buildQuickSubmitPlan([cleared], annotations, 'wildfire');

    expect(plan.payloads).toHaveLength(0);
  });

  it('skips done frames, accepts auto boxes for pending frames', () => {
    const dDone = makeDetection(1, { auto: [box()] });
    const dPending = makeDetection(2, { auto: [box(0.2, 0.2, 0.4, 0.4)] });
    const annotations = new Map([[1, makeAnnotation(1, 'annotated')]]);

    const plan = buildQuickSubmitPlan([dDone, dPending], annotations, 'wildfire');

    expect(plan.payloads).toHaveLength(1);
    expect(plan.payloads[0].detection.id).toBe(2);
    expect(plan.payloads[0].body).toEqual({
      annotation: {
        annotation: [
          {
            xyxyn: [0.2, 0.2, 0.4, 0.4],
            class_name: 'smoke',
            smoke_type: 'wildfire',
            origin: 'auto',
          },
        ],
      },
      processing_stage: 'annotated',
    });
    expect(plan.noBoxCount).toBe(0);
  });

  it('routes to update when an annotation exists, create when missing', () => {
    const dExisting = makeDetection(1, { auto: [box()] });
    const dMissing = makeDetection(2, { auto: [box()] });
    const annotations = new Map([[1, makeAnnotation(1, 'bbox_annotation')]]);

    const plan = buildQuickSubmitPlan([dExisting, dMissing], annotations, 'wildfire');

    expect(plan.payloads[0].existingAnnotationId).toBe(100);
    expect(plan.payloads[1].existingAnnotationId).toBeNull();
  });

  it('preserves false-positive items from the existing annotation', () => {
    const fpItem = {
      xyxyn: [0.6, 0.6, 0.7, 0.7],
      class_name: 'smoke',
      smoke_type: null,
      false_positive_type: 'antenna',
      origin: 'human',
    } as unknown as DetectionAnnotation['annotation']['annotation'][number];
    const smokeItem = {
      xyxyn: [0.1, 0.1, 0.2, 0.2],
      class_name: 'smoke',
      smoke_type: 'wildfire',
      origin: 'human',
    } as unknown as DetectionAnnotation['annotation']['annotation'][number];
    const d = makeDetection(1, { auto: [box()] });
    const annotations = new Map([[1, makeAnnotation(1, 'bbox_annotation', [smokeItem, fpItem])]]);

    const plan = buildQuickSubmitPlan([d], annotations, 'wildfire');

    const items = plan.payloads[0].body.annotation.annotation;
    // Accepted winning box first, then the preserved FP item; the existing
    // smoke item is replaced by the accept (same rule as the modal submit).
    expect(items).toHaveLength(2);
    expect(items[0].origin).toBe('auto');
    expect(items[1]).toEqual(fpItem);
  });

  it('tags engine origin when auto layer is empty', () => {
    const d = makeDetection(1, { auto: [], engine: [box()] });
    const plan = buildQuickSubmitPlan([d], new Map(), 'industrial');
    const items = plan.payloads[0].body.annotation.annotation;
    expect(items[0].origin).toBe('engine');
    expect(items[0].smoke_type).toBe('industrial');
  });

  it('keeps multiple boxes on one frame', () => {
    const d = makeDetection(1, { auto: [box(), box(0.5, 0.5, 0.7, 0.7)] });
    const plan = buildQuickSubmitPlan([d], new Map(), 'wildfire');
    expect(plan.payloads[0].body.annotation.annotation).toHaveLength(2);
  });

  it('includes no-box frames with empty items and counts them', () => {
    const dEmpty = makeDetection(1, { auto: [], engine: [] });
    const dAuto = makeDetection(2, { auto: [box()] });
    const plan = buildQuickSubmitPlan([dEmpty, dAuto], new Map(), 'wildfire');
    expect(plan.payloads).toHaveLength(2);
    expect(
      plan.payloads.find(p => p.detection.id === 1)?.body.annotation.annotation
    ).toEqual([]);
    expect(plan.noBoxCount).toBe(1);
  });

  it('empty lane: no payloads, no warning', () => {
    const plan = buildQuickSubmitPlan([], new Map(), 'wildfire');
    expect(plan.payloads).toEqual([]);
    expect(plan.noBoxCount).toBe(0);
  });
});
