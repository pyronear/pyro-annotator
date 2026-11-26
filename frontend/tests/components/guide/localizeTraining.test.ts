import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCALIZE_TRAINING_ALERTS,
  TRAINING_PASS_MARK,
  type TrainingAlert,
} from '@/components/guide/localize-training/trainingAlerts';
import {
  buildTrainingAlert,
  committedAnnotation,
  createTrainingQueryClient,
  decisionsFor,
  gradeTrainingAlert,
  trainingDetectionId,
} from '@/components/guide/localize-training/trainingModel';
import { buildAlertFrameModel } from '@/utils/annotation/alertLocalizeUtils';
import { getWinningBoxes } from '@/utils/annotation/quickSubmitUtils';
import { QUERY_KEYS } from '@/utils/constants';

const frame = (expected: TrainingAlert['frames'][number]['expected']) => ({
  src: '/x.jpg',
  recordedAt: '2026-01-01T00:00:00Z',
  engine: [],
  auto: [],
  expected,
});

const ALERT: TrainingAlert = {
  key: 'k',
  organisation: 'org',
  camera: 'cam',
  recordedAt: '2026-01-01T00:00:00Z',
  lesson: '',
  frames: [frame([0.4, 0.4, 0.6, 0.6]), frame(null)],
};

describe('gradeTrainingAlert', () => {
  it('is right when every frame matches and missed smoke is No', () => {
    const grade = gradeTrainingAlert(ALERT, [[0.41, 0.41, 0.6, 0.6], null], false);
    expect(grade.right).toBe(true);
    expect(grade.wrongFrameCount).toBe(0);
  });

  it('flags a box kept on a frame with no smoke', () => {
    const grade = gradeTrainingAlert(
      ALERT,
      [
        [0.4, 0.4, 0.6, 0.6],
        [0.1, 0.1, 0.2, 0.2],
      ],
      false
    );
    expect(grade.right).toBe(false);
    expect(grade.frames[1]).toMatchObject({ right: false, mistake: 'box-without-smoke' });
  });

  it('flags a frame cleared where there is smoke', () => {
    const grade = gradeTrainingAlert(ALERT, [null, null], false);
    expect(grade.frames[0]).toMatchObject({ right: false, mistake: 'no-box-on-smoke' });
  });

  it('flags a box that does not fit the plume, and says how', () => {
    const grade = gradeTrainingAlert(ALERT, [[0.3, 0.3, 0.7, 0.7], null], false);
    expect(grade.frames[0]).toMatchObject({ right: false, mistake: 'too-loose' });
    expect(grade.frames[0].iou).toBeCloseTo(0.25);
  });

  it('is wrong when missed smoke is answered Yes, even with every frame right', () => {
    const grade = gradeTrainingAlert(ALERT, [[0.4, 0.4, 0.6, 0.6], null], true);
    expect(grade.wrongFrameCount).toBe(0);
    expect(grade.missedSmokeWrong).toBe(true);
    expect(grade.right).toBe(false);
  });
});

describe('buildTrainingAlert', () => {
  const alert = LOCALIZE_TRAINING_ALERTS[0];
  const model = buildTrainingAlert(alert, 0);

  it('loads like a real alert: one workable wildfire object, every frame awaiting a box', () => {
    const frameModel = buildAlertFrameModel(
      [model.lane],
      { [model.laneId]: model.detections },
      { [model.laneId]: [] }
    );
    expect(frameModel.frames).toHaveLength(alert.frames.length);
    expect(frameModel.objectStatus).toHaveLength(1);
    expect(frameModel.objectStatus[0]).toMatchObject({ workable: true, smokeType: 'wildfire' });
    expect(new Set(Object.values(frameModel.objectStatus[0].statusByTimestamp))).toEqual(
      new Set(['pending'])
    );
  });

  it('reads back what was committed, box or none', () => {
    const [first, second] = model.detections;
    const decisions = decisionsFor(model.detections, {
      [first.id]: committedAnnotation(first.id, [
        { xyxyn: [0.1, 0.1, 0.2, 0.2], class_name: 'smoke', smoke_type: 'wildfire' },
      ]),
      [second.id]: committedAnnotation(second.id, []),
    });
    expect(decisions[0]).toEqual([0.1, 0.1, 0.2, 0.2]);
    expect(decisions[1]).toBeNull();
  });
});

describe('createTrainingQueryClient', () => {
  it('serves every training frame from its static image, never stale', () => {
    const client = createTrainingQueryClient();
    LOCALIZE_TRAINING_ALERTS.forEach((alert, a) =>
      alert.frames.forEach((f, i) => {
        const key = [...QUERY_KEYS.DETECTION_IMAGE, trainingDetectionId(a, i)];
        expect(client.getQueryData(key)).toEqual({ url: f.src });
        expect(client.getQueryState(key)?.isInvalidated).toBe(false);
        expect(client.getQueryCache().find({ queryKey: key })?.isStale()).toBe(false);
      })
    );
  });
});

describe('the training set', () => {
  // What accepting every model box would commit, frame by frame.
  const acceptAll = (alert: TrainingAlert, alertIndex: number) =>
    buildTrainingAlert(alert, alertIndex).detections.map(
      d => getWinningBoxes(d).boxes[0]?.xyxyn ?? null
    );

  it('has alerts where the model is right and at least one where it is wrong', () => {
    const blindAccept = LOCALIZE_TRAINING_ALERTS.map(
      (alert, i) => gradeTrainingAlert(alert, acceptAll(alert, i), false).right
    );
    expect(blindAccept).toContain(true);
    expect(blindAccept).toContain(false);
    // Accepting everything blindly must not be enough to pass.
    expect(blindAccept.filter(Boolean).length).toBeLessThan(TRAINING_PASS_MARK);
  });

  it('can be got right: every expected box is reachable', () => {
    for (const alert of LOCALIZE_TRAINING_ALERTS) {
      const grade = gradeTrainingAlert(
        alert,
        alert.frames.map(f => f.expected),
        false
      );
      expect(grade.right).toBe(true);
    }
  });

  it('ships an image for every frame', () => {
    for (const alert of LOCALIZE_TRAINING_ALERTS) {
      for (const f of alert.frames) {
        expect(existsSync(resolve(__dirname, '../../../public', f.src.slice(1)))).toBe(true);
      }
    }
  });
});
