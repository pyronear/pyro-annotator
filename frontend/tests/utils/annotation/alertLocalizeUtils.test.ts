import { describe, it, expect } from 'vitest';
import {
  buildAlertFrameModel,
  objectLocalizeProgress,
  timelineLegendStatuses,
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

    const { frames } = buildAlertFrameModel(
      [laneA, laneB],
      detectionsByLaneId,
      annotationsByLaneId
    );

    expect(frames.map(f => f.recordedAt)).toEqual([t1, t3, t2]);
    // t2 is shared by both lanes -> two cells there.
    expect(frames.find(f => f.recordedAt === t2)?.cells).toHaveLength(2);
    // t1 is lane A only, t3 is lane B only.
    expect(frames.find(f => f.recordedAt === t1)?.cells).toHaveLength(1);
    expect(frames.find(f => f.recordedAt === t3)?.cells).toHaveLength(1);
  });

  it('orders same-second fractional timestamps chronologically, not lexicographically', () => {
    // Real data serializes the same second both as "...:00Z" and
    // "...:00.500000Z", and "." sorts before "Z" — a string sort would put
    // the later fractional timestamp ahead of the earlier whole-second one.
    // This axis feeds the grid AND every rail row's timeline strip, so pin
    // the numeric sort here, where the ordering now lives. (Guard inherited
    // from the deleted ObjectStatusStrip, which sorted its own frame union.)
    const zeroSeconds = '2026-01-01T10:00:00Z';
    const halfSecond = '2026-01-01T10:00:00.500000Z';
    const oneSecond = '2026-01-01T10:00:01Z';

    const { frames } = buildAlertFrameModel(
      [makeLane(1)],
      { 1: [makeDetection(11, halfSecond), makeDetection(12, oneSecond), makeDetection(13, zeroSeconds)] },
      { 1: [] }
    );

    expect(frames.map(f => f.recordedAt)).toEqual([zeroSeconds, halfSecond, oneSecond]);
  });

  it('maps per-frame status: annotated -> confirmed, auto winning boxes -> pending, no-box -> empty', () => {
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
      // Distinct from 'pending': nothing committed AND no model box to
      // accept, so the strip must not paint it as if it had content.
      [tNoBox]: 'empty',
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

  it('draws only the priority pick when the winning layer holds several boxes', () => {
    // The sensitive model runs at a 0.01 confidence floor and the worker
    // keeps EVERY prediction overlapping the lane's engine anchor
    // (worker.py:107), so a pending frame's auto layer routinely carries two
    // or three boxes — 3.7% of auto-annotated detections at the time of
    // writing. The object still has at most one box (see
    // objectBoxCandidates.ts), and the editor draws exactly the one Enter
    // would commit, so the grid must not stack the runners-up on top of it.
    const t1 = '2026-01-01T10:00:00Z';
    const best = box(0.4, 0.3, 0.49, 0.4);
    const runnerUp = box(0.43, 0.38, 0.45, 0.4);

    const { frames } = buildAlertFrameModel(
      [makeLane(1)],
      // Engine box spans both, so `focusOnMainObject` keeps both — the
      // overlap filter is not what limits the cell to one box.
      { 1: [makeDetection(1, t1, { engine: [box(0.37, 0.29, 0.49, 0.41)], auto: [best, runnerUp] })] },
      { 1: [] }
    );

    const cell = frames[0].cells[0];
    expect(cell.cellState).toBe('auto');
    expect(cell.boxes.map(b => b.xyxyn)).toEqual([best.xyxyn]);
  });

  it('draws only the first committed box when an annotation holds several', () => {
    // Same invariant on the committed side: nothing validates one box per
    // object per frame in the database, and the editor's `committedBox`
    // reads the first smoke item, so the grid must agree with it.
    const t1 = '2026-01-01T10:00:00Z';
    const first: [number, number, number, number] = [0.2, 0.2, 0.4, 0.4];

    const { frames } = buildAlertFrameModel(
      [makeLane(1)],
      { 1: [makeDetection(1, t1, { engine: [box()] })] },
      {
        1: [
          makeDetAnnotation(1, 'annotated', [
            { xyxyn: first, class_name: 'smoke', smoke_type: 'wildfire' },
            // Inside the engine anchor, so `focusOnMainObject` keeps it and
            // the cap is what has to drop it.
            { xyxyn: [0.15, 0.15, 0.25, 0.25], class_name: 'smoke', smoke_type: 'wildfire' },
          ]),
        ],
      }
    );

    const cell = frames[0].cells[0];
    expect(cell.cellState).toBe('done');
    expect(cell.boxes.map(b => b.xyxyn)).toEqual([first]);
  });

  it('maps a committed annotation with zero smoke boxes to cleared, not confirmed', () => {
    const t1 = '2026-01-01T10:00:00Z';
    // Evidence-bearing frame (engine box) cleared by the annotator: the
    // editor's Clear saves an empty annotation ("object not visible here").
    const detectionsByLaneId = { 1: [makeDetection(1, t1, { engine: [box()], auto: [] })] };
    const annotationsByLaneId = { 1: [makeDetAnnotation(1, 'annotated', [])] };

    const { objectStatus, frames } = buildAlertFrameModel(
      [makeLane(1)],
      detectionsByLaneId,
      annotationsByLaneId
    );

    expect(objectStatus[0].statusByTimestamp[t1]).toBe('cleared');
    const cell = frames[0].cells[0];
    expect(cell.cellState).toBe('done');
    expect(cell.boxes).toHaveLength(0);
  });

  it('maps a committed annotation with only false-positive items to cleared', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const detectionsByLaneId = { 1: [makeDetection(1, t1, { engine: [box()], auto: [] })] };
    const annotationsByLaneId = {
      1: [
        makeDetAnnotation(1, 'annotated', [
          { xyxyn: [0.2, 0.2, 0.4, 0.4], class_name: 'smoke', false_positive_type: 'antenna' },
        ]),
      ],
    };

    const { objectStatus } = buildAlertFrameModel(
      [makeLane(1)],
      detectionsByLaneId,
      annotationsByLaneId
    );

    expect(objectStatus[0].statusByTimestamp[t1]).toBe('cleared');
  });

  it('carries the lane color on every cell, boxes or not', () => {
    const t1 = '2026-01-01T10:00:00Z';
    const { frames } = buildAlertFrameModel(
      [makeLane(1)],
      { 1: [makeDetection(1, t1, { engine: [box()], auto: [] })] },
      { 1: [makeDetAnnotation(1, 'annotated', [])] }
    );

    expect(frames[0].cells[0].color).toBe(getObjectColor(0));
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
    // Present at t1 but with no boxes at all -> 'empty', not 'pending'.
    expect(objectA.statusByTimestamp[t1]).toBe('empty');
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
      1: [
        makeDetAnnotation(1, 'annotated', [{ xyxyn: [0.1, 0.1, 0.2, 0.2], class_name: 'smoke' }]),
      ],
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

  describe('false-positive context lanes (includeFalsePositives)', () => {
    /**
     * The real shape of an FP-only lane: the backend writes its detection
     * annotations as `{"annotation": []}` at stage `annotated` (the human
     * said "no smoke here"), leaving the object's actual location in
     * `algo_predictions`. Reading the committed boxes gives the lane
     * nothing to draw, which is the bug this suite pins down.
     */
    const fpLane = () => makeLane(1, { has_smoke: false, has_missed_smoke: false });

    it('shows the engine track for an FP lane whose committed annotation is empty', () => {
      const t1 = '2026-01-01T10:00:00Z';
      const engineBox = box(0.4, 0.4, 0.5, 0.5);

      const { frames, objectStatus } = buildAlertFrameModel(
        [fpLane()],
        { 1: [makeDetection(1, t1, { engine: [engineBox], auto: [] })] },
        { 1: [makeDetAnnotation(1, 'annotated', [])] },
        { includeFalsePositives: true }
      );

      const cell = frames[0].cells[0];
      expect(cell.isFalsePositive).toBe(true);
      expect(cell.boxes).toEqual([{ xyxyn: [0.4, 0.4, 0.5, 0.5], color: getObjectColor(0) }]);
      // The timeline row can only read 'confirmed' once boxes exist.
      expect(objectStatus[0].statusByTimestamp[t1]).toBe('confirmed');
    });

    it('prefers the engine track over auto_predictions for an FP lane', () => {
      const t1 = '2026-01-01T10:00:00Z';

      const { frames } = buildAlertFrameModel(
        [fpLane()],
        {
          1: [
            makeDetection(1, t1, {
              engine: [box(0.4, 0.4, 0.5, 0.5)],
              auto: [box(0.7, 0.7, 0.8, 0.8)],
            }),
          ],
        },
        { 1: [makeDetAnnotation(1, 'annotated', [])] },
        { includeFalsePositives: true }
      );

      expect(frames[0].cells[0].boxes.map(b => b.xyxyn)).toEqual([[0.4, 0.4, 0.5, 0.5]]);
    });

    it('reads empty for an FP frame with no engine box at all', () => {
      const t1 = '2026-01-01T10:00:00Z';

      const { frames, objectStatus } = buildAlertFrameModel(
        [fpLane()],
        { 1: [makeDetection(1, t1, { engine: [], auto: [] })] },
        { 1: [makeDetAnnotation(1, 'annotated', [])] },
        { includeFalsePositives: true }
      );

      expect(frames[0].cells[0].boxes).toEqual([]);
      expect(objectStatus[0].statusByTimestamp[t1]).toBe('empty');
    });

    it('leaves a smoke lane reading its committed boxes, not the engine track', () => {
      const t1 = '2026-01-01T10:00:00Z';

      const { frames } = buildAlertFrameModel(
        [makeLane(1)],
        { 1: [makeDetection(1, t1, { engine: [box(0.4, 0.4, 0.5, 0.5)], auto: [] })] },
        {
          1: [
            makeDetAnnotation(1, 'annotated', [
              { xyxyn: [0.2, 0.2, 0.3, 0.3], class_name: 'smoke', smoke_type: 'wildfire' },
            ]),
          ],
        },
        { includeFalsePositives: true }
      );

      expect(frames[0].cells[0].boxes.map(b => b.xyxyn)).toEqual([[0.2, 0.2, 0.3, 0.3]]);
    });
  });
});

describe('timelineLegendStatuses', () => {
  it('returns the union of statuses across rows, in display order', () => {
    expect(
      timelineLegendStatuses([
        { t1: 'empty', t2: 'confirmed' },
        { t1: 'pending', t2: 'absent', t3: 'cleared' },
      ])
    ).toEqual(['confirmed', 'cleared', 'pending', 'empty']);
  });

  it('lists only statuses actually present', () => {
    expect(timelineLegendStatuses([{ t1: 'confirmed', t2: 'confirmed' }])).toEqual(['confirmed']);
  });

  it('never lists absent, and returns nothing for no rows or all-absent rows', () => {
    expect(timelineLegendStatuses([])).toEqual([]);
    expect(timelineLegendStatuses([{ t1: 'absent' }])).toEqual([]);
  });
});

describe('objectLocalizeProgress', () => {
  it('counts cleared as settled: all confirmed-or-cleared reads complete', () => {
    expect(objectLocalizeProgress({ t1: 'confirmed', t2: 'cleared' })).toEqual({
      presentCount: 2,
      confirmedCount: 2,
    });
  });

  it('counts pending and empty as outstanding, absent as neither', () => {
    expect(
      objectLocalizeProgress({
        t1: 'confirmed',
        t2: 'pending',
        t3: 'empty',
        t4: 'cleared',
        t5: 'absent',
      })
    ).toEqual({ presentCount: 4, confirmedCount: 2 });
  });
});
