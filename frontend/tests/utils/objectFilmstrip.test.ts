import { describe, it, expect } from 'vitest';
import { buildFilmstripEntries } from '@/utils/annotation/objectFilmstrip';
import type { Detection, DetectionAnnotation } from '@/types/api';
import type { AlertFrame } from '@/utils/annotation/alertLocalizeUtils';

const LANE = 27;

/** `recordedAt` ends in a 3-digit frame number, which the fixture ids encode. */
const frame = (recordedAt: string, laneIds: number[]): AlertFrame => ({
  recordedAt,
  cells: laneIds.map(laneSequenceId => ({
    laneSequenceId,
    detectionId: laneSequenceId * 1000 + Number(recordedAt.slice(-4, -1)),
    cellState: 'auto' as const,
    boxes: [],
  })),
});

const detection = (id: number, recordedAt: string, auto = true): Detection =>
  ({
    id,
    sequence_id: LANE,
    recorded_at: recordedAt,
    bucket_key: 'k.jpg',
    algo_predictions: { predictions: [] },
    auto_predictions: auto
      ? { predictions: [{ xyxyn: [0.2, 0.2, 0.3, 0.3], confidence: 0.9, class_name: 'smoke' }] }
      : { predictions: [] },
  }) as Detection;

describe('buildFilmstripEntries', () => {
  const frames: AlertFrame[] = [
    frame('2026-07-30T06:49:001Z', [99]),
    frame('2026-07-30T06:49:002Z', [99]),
    frame('2026-07-30T06:49:003Z', [99, LANE]),
    frame('2026-07-30T06:49:004Z', [99, LANE]),
    frame('2026-07-30T06:49:005Z', [99]),
  ];

  const detections = [
    detection(27003, '2026-07-30T06:49:003Z'),
    detection(27004, '2026-07-30T06:49:004Z'),
  ];

  it('returns one entry per alert frame, not per object frame', () => {
    const entries = buildFilmstripEntries(frames, LANE, detections, []);
    expect(entries).toHaveLength(5);
  });

  it('marks frames the object is absent from as out of range', () => {
    const entries = buildFilmstripEntries(frames, LANE, detections, []);
    expect(entries.map(e => e.inObject)).toEqual([false, false, true, true, false]);
  });

  it('assigns before / object / after runs', () => {
    const entries = buildFilmstripEntries(frames, LANE, detections, []);
    expect(entries.map(e => e.run)).toEqual(['before', 'before', 'object', 'object', 'after']);
  });

  it('reports the committed source when a box is committed', () => {
    const annotations = [
      {
        id: 1,
        detection_id: 27003,
        annotation: {
          annotation: [
            {
              xyxyn: [0.2, 0.2, 0.3, 0.3],
              class_name: 'smoke',
              smoke_type: 'wildfire',
              origin: 'engine',
            },
          ],
        },
      } as unknown as DetectionAnnotation,
    ];
    const entries = buildFilmstripEntries(frames, LANE, detections, annotations);
    expect(entries[2].committedSource).toBe('engine');
    expect(entries[2].availableSource).toBeNull();
  });

  it('reports the priority source as available when nothing is committed', () => {
    const entries = buildFilmstripEntries(frames, LANE, detections, []);
    expect(entries[2].committedSource).toBeNull();
    expect(entries[2].availableSource).toBe('auto');
  });

  it('reports neither source on an in-object frame with no box at all', () => {
    const entries = buildFilmstripEntries(
      frames,
      LANE,
      [detection(27003, '2026-07-30T06:49:003Z', false), detections[1]],
      []
    );
    expect(entries[2].committedSource).toBeNull();
    expect(entries[2].availableSource).toBeNull();
  });

  it('emits no before or after run when the object covers the whole alert', () => {
    const full: AlertFrame[] = [
      frame('2026-07-30T06:49:003Z', [LANE]),
      frame('2026-07-30T06:49:004Z', [LANE]),
    ];
    const entries = buildFilmstripEntries(full, LANE, detections, []);
    expect(entries.every(e => e.run === 'object')).toBe(true);
  });

  it('carries the sibling detection id for an out-of-range frame so its image can load', () => {
    const entries = buildFilmstripEntries(frames, LANE, detections, []);
    expect(entries[0].detectionId).toBe(99001);
    expect(entries[0].inObject).toBe(false);
  });

  it('carries the box the thumbnail should crop to', () => {
    const entries = buildFilmstripEntries(frames, LANE, detections, []);
    expect(entries[2].xyxyn).toEqual([0.2, 0.2, 0.3, 0.3]);
  });

  it('carries no crop box for a frame that offers nothing', () => {
    const entries = buildFilmstripEntries(frames, LANE, detections, []);
    expect(entries[0].xyxyn).toBeNull();
  });
});
