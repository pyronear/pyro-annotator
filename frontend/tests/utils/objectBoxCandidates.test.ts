import { describe, it, expect } from 'vitest';
import {
  boxCandidates,
  committedBox,
  hasModelEvidence,
  isCleared,
  priorityPick,
  previousShownBox,
  candidateToBbox,
} from '@/utils/annotation/objectBoxCandidates';
import type { Detection, DetectionAnnotation } from '@/types/api';

const detection = (over: Partial<Detection> = {}): Detection =>
  ({
    id: 1,
    sequence_id: 27,
    recorded_at: '2026-07-30T06:53:41Z',
    bucket_key: 'k.jpg',
    algo_predictions: { predictions: [] },
    auto_predictions: { predictions: [] },
    ...over,
  }) as Detection;

const annotation = (items: DetectionAnnotation['annotation']['annotation']): DetectionAnnotation =>
  ({ id: 9, detection_id: 1, annotation: { annotation: items } }) as DetectionAnnotation;

/** A committed annotation — what every editor write produces. */
const annotated = (items: DetectionAnnotation['annotation']['annotation']): DetectionAnnotation =>
  ({ ...annotation(items), processing_stage: 'annotated' }) as DetectionAnnotation;

describe('boxCandidates', () => {
  it('orders manual, then auto, then engine', () => {
    const result = boxCandidates(
      detection({
        auto_predictions: {
          predictions: [{ xyxyn: [0.2, 0.2, 0.3, 0.3], confidence: 0.87, class_name: 'smoke' }],
        },
        algo_predictions: {
          predictions: [{ xyxyn: [0.1, 0.1, 0.4, 0.4], confidence: 0.5, class_name: 'smoke' }],
        },
      }),
      annotation([
        {
          xyxyn: [0.25, 0.25, 0.35, 0.35],
          class_name: 'smoke',
          smoke_type: 'wildfire',
          origin: 'human',
        },
      ])
    );
    expect(result.map(c => c.source)).toEqual(['manual', 'auto', 'engine']);
  });

  it('offers the auto box anchored to this frame first, keeping the rest', () => {
    // What Enter commits must be the box the grid drew and accept-remaining
    // would write (`getWinningBoxes`), and that is the most confident box
    // overlapping THIS frame's engine box — the worker's anchor is
    // sequence-wide, so the top-confidence box can sit where the object was
    // on another frame. The runners-up stay on the rail: the annotator can
    // still pick one deliberately.
    const stray = { xyxyn: [0.05, 0.05, 0.12, 0.12], confidence: 0.52, class_name: 'smoke' };
    const anchored = { xyxyn: [0.4, 0.3, 0.47, 0.4], confidence: 0.15, class_name: 'smoke' };

    const result = boxCandidates(
      detection({
        auto_predictions: { predictions: [stray, anchored] },
        algo_predictions: {
          predictions: [{ xyxyn: [0.37, 0.29, 0.49, 0.41], confidence: 0.5, class_name: 'smoke' }],
        },
      }),
      null
    );

    expect(priorityPick(result)?.xyxyn).toEqual(anchored.xyxyn);
    // Original positions travel with the candidates — `index` is identity,
    // not display order.
    expect(result.filter(c => c.source === 'auto').map(c => c.index)).toEqual([1, 0]);
  });

  it('omits sources with no box', () => {
    const result = boxCandidates(
      detection({
        auto_predictions: {
          predictions: [{ xyxyn: [0.2, 0.2, 0.3, 0.3], confidence: 0.9, class_name: 'smoke' }],
        },
      }),
      null
    );
    expect(result.map(c => c.source)).toEqual(['auto']);
  });

  it('returns one candidate per box when a layer holds several', () => {
    const result = boxCandidates(
      detection({
        auto_predictions: {
          predictions: [
            { xyxyn: [0.1, 0.1, 0.2, 0.2], confidence: 0.9, class_name: 'smoke' },
            { xyxyn: [0.5, 0.5, 0.6, 0.6], confidence: 0.7, class_name: 'smoke' },
          ],
        },
      }),
      null
    );
    expect(result).toHaveLength(2);
    expect(result.map(c => c.index)).toEqual([0, 1]);
  });

  it('does not treat a committed auto box as a manual candidate', () => {
    const result = boxCandidates(
      detection(),
      annotation([
        { xyxyn: [0.2, 0.2, 0.3, 0.3], class_name: 'smoke', smoke_type: 'wildfire', origin: 'auto' },
      ])
    );
    expect(result).toHaveLength(0);
  });

  it('carries confidence through from the model layer', () => {
    const [candidate] = boxCandidates(
      detection({
        auto_predictions: {
          predictions: [{ xyxyn: [0, 0, 1, 1], confidence: 0.42, class_name: 'smoke' }],
        },
      }),
      null
    );
    expect(candidate.confidence).toBe(0.42);
  });
});

describe('committedBox', () => {
  it('reads the committed item origin', () => {
    const result = committedBox(
      annotation([
        {
          xyxyn: [0.2, 0.2, 0.3, 0.3],
          class_name: 'smoke',
          smoke_type: 'wildfire',
          origin: 'engine',
        },
      ])
    );
    expect(result).toEqual({ source: 'engine', index: 0, xyxyn: [0.2, 0.2, 0.3, 0.3] });
  });

  it('defaults a missing origin to manual', () => {
    const result = committedBox(
      annotation([{ xyxyn: [0, 0, 1, 1], class_name: 'smoke', smoke_type: 'wildfire' }])
    );
    expect(result?.source).toBe('manual');
  });

  it('returns null for an annotation holding only false-positive items', () => {
    const result = committedBox(
      annotation([{ xyxyn: [0, 0, 1, 1], class_name: 'smoke', false_positive_type: 'antenna' }])
    );
    expect(result).toBeNull();
  });

  it('returns null for a null annotation', () => {
    expect(committedBox(null)).toBeNull();
  });
});

describe('priorityPick', () => {
  it('prefers manual over auto over engine', () => {
    const candidates = boxCandidates(
      detection({
        auto_predictions: {
          predictions: [{ xyxyn: [0.2, 0.2, 0.3, 0.3], confidence: 0.9, class_name: 'smoke' }],
        },
        algo_predictions: {
          predictions: [{ xyxyn: [0.1, 0.1, 0.4, 0.4], confidence: 0.5, class_name: 'smoke' }],
        },
      }),
      annotation([
        {
          xyxyn: [0.25, 0.25, 0.35, 0.35],
          class_name: 'smoke',
          smoke_type: 'wildfire',
          origin: 'human',
        },
      ])
    );
    expect(priorityPick(candidates)?.source).toBe('manual');
  });

  it('falls back to engine when only engine has a box', () => {
    const candidates = boxCandidates(
      detection({
        algo_predictions: {
          predictions: [{ xyxyn: [0, 0, 1, 1], confidence: 0.5, class_name: 'smoke' }],
        },
      }),
      null
    );
    expect(priorityPick(candidates)?.source).toBe('engine');
  });

  it('returns null on an empty frame', () => {
    expect(priorityPick([])).toBeNull();
  });
});

describe('candidateToBbox', () => {
  it('stamps the smoke type and maps the source to an origin', () => {
    expect(candidateToBbox({ source: 'auto', index: 0, xyxyn: [0, 0, 1, 1] }, 'wildfire')).toEqual({
      xyxyn: [0, 0, 1, 1],
      class_name: 'smoke',
      smoke_type: 'wildfire',
      origin: 'auto',
    });
  });

  it('maps manual to the human origin', () => {
    expect(candidateToBbox({ source: 'manual', index: 0, xyxyn: [0, 0, 1, 1] }, 'other').origin).toBe(
      'human'
    );
  });
});

describe('hasModelEvidence', () => {
  it('is true when the engine track has a box', () => {
    expect(
      hasModelEvidence({
        algo_predictions: {
          predictions: [{ xyxyn: [0, 0, 1, 1], confidence: 1, class_name: 'smoke' }],
        },
        auto_predictions: null,
      } as unknown as Detection)
    ).toBe(true);
  });

  it('is true when only the auto track has a box', () => {
    expect(
      hasModelEvidence({
        algo_predictions: { predictions: [] },
        auto_predictions: {
          predictions: [{ xyxyn: [0, 0, 1, 1], confidence: 1, class_name: 'smoke' }],
        },
      } as unknown as Detection)
    ).toBe(true);
  });

  it('is false when both tracks are empty or absent', () => {
    expect(
      hasModelEvidence({
        algo_predictions: { predictions: [] },
        auto_predictions: null,
      } as unknown as Detection)
    ).toBe(false);
  });
});

describe('previousShownBox', () => {
  const laneDetection = (id: number, autoBox?: [number, number, number, number]): Detection =>
    detection({
      id,
      auto_predictions: {
        predictions: autoBox ? [{ xyxyn: autoBox, confidence: 0.8, class_name: 'smoke' }] : [],
      },
    });

  const committedFor = (
    detectionId: number,
    xyxyn: [number, number, number, number]
  ): DetectionAnnotation =>
    ({
      id: detectionId * 10,
      detection_id: detectionId,
      annotation: {
        annotation: [{ xyxyn, class_name: 'smoke', smoke_type: 'wildfire', origin: 'auto' }],
      },
    }) as DetectionAnnotation;

  const clearedFor = (detectionId: number): DetectionAnnotation =>
    ({
      id: detectionId * 10,
      detection_id: detectionId,
      annotation: { annotation: [] },
      processing_stage: 'annotated',
    }) as unknown as DetectionAnnotation;

  it("returns the previous frame's committed box", () => {
    const lane = [laneDetection(1, [0.1, 0.1, 0.2, 0.2]), laneDetection(2, [0.5, 0.5, 0.6, 0.6])];
    const result = previousShownBox(2, lane, [committedFor(1, [0.3, 0.3, 0.4, 0.4])]);
    expect(result).toEqual([0.3, 0.3, 0.4, 0.4]);
  });

  it("falls back to the previous frame's winning pick when it is undecided", () => {
    const lane = [laneDetection(1, [0.1, 0.1, 0.2, 0.2]), laneDetection(2)];
    expect(previousShownBox(2, lane, [])).toEqual([0.1, 0.1, 0.2, 0.2]);
  });

  it('skips cleared and boxless frames to the nearest earlier shown box', () => {
    const lane = [
      laneDetection(1, [0.1, 0.1, 0.2, 0.2]),
      laneDetection(2), // boxless, undecided — shows nothing
      laneDetection(3, [0.7, 0.7, 0.8, 0.8]), // cleared — shows nothing
      laneDetection(4),
    ];
    expect(previousShownBox(4, lane, [clearedFor(3)])).toEqual([0.1, 0.1, 0.2, 0.2]);
  });

  it('returns null when no earlier frame shows a box', () => {
    const lane = [laneDetection(1), laneDetection(2)];
    expect(previousShownBox(2, lane, [])).toBeNull();
  });

  it('returns null on the first frame of the lane', () => {
    const lane = [laneDetection(1, [0.1, 0.1, 0.2, 0.2]), laneDetection(2)];
    expect(previousShownBox(1, lane, [])).toBeNull();
  });
});

describe('isCleared', () => {
  it('is true for a committed annotation holding no box — the annotator said "not visible here"', () => {
    expect(isCleared(annotated([]))).toBe(true);
  });

  it("is true when only false-positive items remain — those are not this object's box", () => {
    expect(
      isCleared(
        annotated([{ xyxyn: [0, 0, 1, 1], class_name: 'smoke', false_positive_type: 'antenna' }])
      )
    ).toBe(true);
  });

  it('is false when a smoke box is committed', () => {
    expect(
      isCleared(
        annotated([
          {
            xyxyn: [0.2, 0.2, 0.3, 0.3],
            class_name: 'smoke',
            smoke_type: 'wildfire',
            origin: 'auto',
          },
        ])
      )
    ).toBe(false);
  });

  it('is false with no annotation at all — that frame is undecided, not cleared', () => {
    expect(isCleared(null)).toBe(false);
    expect(isCleared(undefined)).toBe(false);
  });

  it('is false while the annotation is not yet committed', () => {
    expect(isCleared({ ...annotated([]), processing_stage: 'bbox_annotation' })).toBe(false);
  });

  it('is false for a malformed item with neither smoke nor false-positive type', () => {
    // `collectLaneBoxes` counts that item as a real box and draws it. If this
    // reported cleared, the editor would show "no box on this frame" while
    // the accept preview drew one.
    expect(isCleared(annotated([{ xyxyn: [0.1, 0.1, 0.3, 0.3], class_name: 'smoke' }]))).toBe(
      false
    );
  });
});
