import { describe, it, expect } from 'vitest';
import {
  boxCandidates,
  committedBox,
  priorityPick,
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
