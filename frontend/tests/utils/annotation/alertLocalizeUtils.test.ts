import { describe, it, expect } from 'vitest';
import {
  buildAlertFrameModel,
  findCarrierLaneId,
  buildMissedRowStatus,
} from '@/utils/annotation/alertLocalizeUtils';
import { getObjectColor } from '@/utils/annotation/objectColors';
import type { AlertLane, Detection, DetectionAnnotation, SequenceAnnotation } from '@/types/api';

const box = (x1 = 0.1, y1 = 0.1, x2 = 0.3, y2 = 0.3) => ({
  xyxyn: [x1, y1, x2, y2] as [number, number, number, number],
  confidence: 0.9,
  class_name: 'smoke',
});

const makeDetection = (
  id: number,
  recordedAt: string,
  opts: { engine?: ReturnType<typeof box>[]; auto?: ReturnType<typeof box>[] | null } = {}
): Detection =>
  ({
    id,
    recorded_at: recordedAt,
    algo_predictions: { predictions: opts.engine ?? [] },
    auto_predictions: opts.auto === undefined ? null : opts.auto && { predictions: opts.auto },
  }) as unknown as Detection;

const makeDetAnnotation = (
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

const makeLane = (
  sequenceId: number,
  overrides: Partial<SequenceAnnotation> | null = {}
): AlertLane =>
  ({
    sequence: { id: sequenceId } as AlertLane['sequence'],
    annotation:
      overrides === null
        ? null
        : ({
            id: sequenceId * 10,
            sequence_id: sequenceId,
            has_smoke: true,
            has_missed_smoke: false,
            is_unsure: false,
            processing_stage: 'seq_annotation_done',
            ...overrides,
          } as SequenceAnnotation),
  }) as AlertLane;

describe('buildAlertFrameModel', () => {
  it('unions two lanes with partially disjoint frames in chronological order', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const t2 = '2026-01-01T10:00:10Z';
    const t3 = '2026-01-01T10:00:05Z'; // between t1 and t2, but inserted after both via lane B

    const laneA = makeLane(1);
    const laneB = makeLane(2);

    const detectionsByLaneId = {
      1: [makeDetection(11, t1), makeDetection(12, t2)],
      2: [makeDetection(21, t3), makeDetection(22, t2)],
    };
    const annotationsByLaneId = { 1: [], 2: [] };

    const { frames } = buildAlertFrameModel([laneA, laneB], detectionsByLaneId, annotationsByLaneId);

    expect(frames.map(f => f.recordedAt)).toEqual([t1, t3, t2]);
    // t2 is shared by both lanes -> two cells there.
    expect(frames.find(f => f.recordedAt === t2)?.cells).toHaveLength(2);
    // t1 is lane A only, t3 is lane B only.
    expect(frames.find(f => f.recordedAt === t1)?.cells).toHaveLength(1);
    expect(frames.find(f => f.recordedAt === t3)?.cells).toHaveLength(1);
  });

  it('maps per-frame status: annotated -> confirmed, auto winning boxes -> pending, no-box -> pending', () => {
    const tDone = '2026-01-01T10:00:00Z';
    const tAuto = '2026-01-01T10:00:10Z';
    const tNoBox = '2026-01-01T10:00:20Z';

    const lane = makeLane(1);
    const detectionsByLaneId = {
      1: [
        makeDetection(1, tDone, { auto: [box()] }),
        makeDetection(2, tAuto, { auto: [box()] }),
        makeDetection(3, tNoBox, { auto: [], engine: [] }),
      ],
    };
    const annotationsByLaneId = {
      1: [
        makeDetAnnotation(1, 'annotated', [
          { xyxyn: [0.2, 0.2, 0.4, 0.4], class_name: 'smoke', smoke_type: 'wildfire' },
        ]),
      ],
    };

    const { objectStatus, frames } = buildAlertFrameModel(
      [lane],
      detectionsByLaneId,
      annotationsByLaneId
    );

    expect(objectStatus).toHaveLength(1);
    expect(objectStatus[0].statusByTimestamp).toEqual({
      [tDone]: 'confirmed',
      [tAuto]: 'pending',
      [tNoBox]: 'pending',
    });

    const doneCell = frames.find(f => f.recordedAt === tDone)!.cells[0];
    expect(doneCell.cellState).toBe('done');
    expect(doneCell.boxes).toHaveLength(1);

    const autoCell = frames.find(f => f.recordedAt === tAuto)!.cells[0];
    expect(autoCell.cellState).toBe('auto');
    expect(autoCell.boxes).toHaveLength(1);

    const noBoxCell = frames.find(f => f.recordedAt === tNoBox)!.cells[0];
    expect(noBoxCell.cellState).toBe('no-box');
    expect(noBoxCell.boxes).toHaveLength(0);
  });

  it('treats a frame the lane has no detection on as absent (no entry in statusByTimestamp)', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const t2 = '2026-01-01T10:00:10Z';

    const laneA = makeLane(1); // only present at t1
    const laneB = makeLane(2); // present at t1 and t2

    const detectionsByLaneId = {
      1: [makeDetection(11, t1, { engine: [] })],
      2: [makeDetection(21, t1, { engine: [] }), makeDetection(22, t2, { engine: [] })],
    };
    const annotationsByLaneId = { 1: [], 2: [] };

    const { objectStatus, frames } = buildAlertFrameModel(
      [laneA, laneB],
      detectionsByLaneId,
      annotationsByLaneId
    );

    const objectA = objectStatus.find(o => o.laneSequenceId === 1)!;
    expect(objectA.statusByTimestamp[t1]).toBe('pending');
    expect(objectA.statusByTimestamp[t2]).toBeUndefined();

    // Frame t2's only cell belongs to lane B; lane A contributes nothing there.
    const frameT2 = frames.find(f => f.recordedAt === t2)!;
    expect(frameT2.cells.map(c => c.laneSequenceId)).toEqual([2]);
  });

  it('includes an already-annotated rule-matching lane as context (workable: false)', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const lane = makeLane(1, { processing_stage: 'annotated' });
    const detectionsByLaneId = { 1: [makeDetection(1, t1, { engine: [] })] };
    const annotationsByLaneId = {
      1: [makeDetAnnotation(1, 'annotated', [{ xyxyn: [0.1, 0.1, 0.2, 0.2], class_name: 'smoke' }])],
    };

    const { objectStatus, frames } = buildAlertFrameModel(
      [lane],
      detectionsByLaneId,
      annotationsByLaneId
    );

    expect(objectStatus).toHaveLength(1);
    expect(objectStatus[0].workable).toBe(false);
    expect(frames).toHaveLength(1);
  });

  it('excludes an unsure lane entirely, even though it has smoke', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const lane = makeLane(1, { is_unsure: true });
    const detectionsByLaneId = { 1: [makeDetection(1, t1)] };
    const annotationsByLaneId = { 1: [] };

    const { objectStatus, frames } = buildAlertFrameModel(
      [lane],
      detectionsByLaneId,
      annotationsByLaneId
    );

    expect(objectStatus).toHaveLength(0);
    expect(frames).toHaveLength(0);
  });

  it('excludes an FP-only lane entirely (no smoke, no missed smoke)', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const lane = makeLane(1, { has_smoke: false, has_missed_smoke: false });
    const detectionsByLaneId = { 1: [makeDetection(1, t1)] };
    const annotationsByLaneId = { 1: [] };

    const { objectStatus, frames } = buildAlertFrameModel(
      [lane],
      detectionsByLaneId,
      annotationsByLaneId
    );

    expect(objectStatus).toHaveLength(0);
    expect(frames).toHaveLength(0);
  });

  it('excludes a lane with no annotation at all (not yet imported)', () => {
    const lane = makeLane(1, null);
    const { objectStatus, frames } = buildAlertFrameModel([lane], { 1: [] }, { 1: [] });

    expect(objectStatus).toHaveLength(0);
    expect(frames).toHaveLength(0);
  });

  it('numbers and colors objects by their original position in `lanes`, not the filtered position', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const excludedLane = makeLane(1, { is_unsure: true }); // index 0, excluded
    const includedLane = makeLane(2); // index 1, included

    const { objectStatus } = buildAlertFrameModel(
      [excludedLane, includedLane],
      { 1: [], 2: [makeDetection(1, t1)] },
      { 1: [], 2: [] }
    );

    expect(objectStatus).toHaveLength(1);
    expect(objectStatus[0].label).toBe('Object 2');
    expect(objectStatus[0].color).toBe(getObjectColor(1));
  });
});

describe('findCarrierLaneId', () => {
  it('picks the first still-open (seq_annotation_done) lane, primary-first', () => {
    const primary = makeLane(1, { processing_stage: 'seq_annotation_done' });
    const sibling = makeLane(2, { processing_stage: 'seq_annotation_done' });

    expect(findCarrierLaneId([primary, sibling])).toBe(1);
  });

  it('falls back to the next still-open lane when the primary already exited', () => {
    const primary = makeLane(1, { processing_stage: 'annotated' });
    const sibling = makeLane(2, { processing_stage: 'seq_annotation_done' });

    expect(findCarrierLaneId([primary, sibling])).toBe(2);
  });

  it('returns null when no lane is still open', () => {
    const primary = makeLane(1, { processing_stage: 'annotated' });
    const noAnnotation = makeLane(2, null);

    expect(findCarrierLaneId([primary, noAnnotation])).toBeNull();
  });
});

describe('buildMissedRowStatus', () => {
  it('spans every frame, defaulting to pending', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const t2 = '2026-01-01T10:00:10Z';
    const lane = makeLane(1);
    const { frames } = buildAlertFrameModel(
      [lane],
      { 1: [makeDetection(1, t1), makeDetection(2, t2)] },
      { 1: [] }
    );

    expect(buildMissedRowStatus(frames, 1)).toEqual({ [t1]: 'pending', [t2]: 'pending' });
  });

  it('marks a frame confirmed once the carrier lane has a committed box there', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const t2 = '2026-01-01T10:00:10Z';
    const lane = makeLane(1);
    const { frames } = buildAlertFrameModel(
      [lane],
      { 1: [makeDetection(1, t1), makeDetection(2, t2)] },
      { 1: [makeDetAnnotation(1, 'annotated', [{ xyxyn: [0.1, 0.1, 0.2, 0.2], class_name: 'smoke' }])] }
    );

    expect(buildMissedRowStatus(frames, 1)).toEqual({ [t1]: 'confirmed', [t2]: 'pending' });
  });

  it('stays pending everywhere when the carrier lane has no cell on any frame (not contributing yet)', () => {
    const t1 = '2026-01-01T10:00:00Z';
    // Lane 1 is unsure (excluded from frameModel entirely); lane 2 contributes the frame.
    const excludedCarrier = makeLane(1, { is_unsure: true });
    const other = makeLane(2);
    const { frames } = buildAlertFrameModel(
      [excludedCarrier, other],
      { 1: [], 2: [makeDetection(1, t1)] },
      { 1: [], 2: [] }
    );

    expect(buildMissedRowStatus(frames, 1)).toEqual({ [t1]: 'pending' });
  });

  it('is entirely pending when there is no carrier lane at all', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const lane = makeLane(1);
    const { frames } = buildAlertFrameModel([lane], { 1: [makeDetection(1, t1)] }, { 1: [] });

    expect(buildMissedRowStatus(frames, null)).toEqual({ [t1]: 'pending' });
  });
});
