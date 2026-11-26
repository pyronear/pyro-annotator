import type { AlgoPredictions, Detection, FalsePositiveType, SmokeType } from '@/types/api';
import type { DetectionMediaSource } from '@/hooks/useDetectionMediaSource';
import { CLASSIFICATION_ALERT_DATA } from '@/components/guide/classificationExerciseData';

/**
 * The classification training set: five alerts whose classification is known.
 *
 * Taken from the pinned sample dataset (`.sample-data/sample-data-v1`, see
 * annotation_api/docs/sample-data.md): every object's expected answer is its
 * exported label, and every alert's missed-smoke answer is the dataset's
 * `has_missed_smoke` (No for all five). The frames are copied into
 * frontend/public/guide/classification/ and the alert data is generated into
 * classificationExerciseData.ts, so the exercise needs no API and no seeded
 * database. The five cover the classify decisions: distant wildfire smoke, a
 * static false positive, industrial smoke, two low clouds, and a two-object
 * alert mixing wildfire smoke with a building.
 */

export type ExpectedClassification =
  | { kind: 'smoke'; smokeType: SmokeType }
  | { kind: 'false_positive'; falsePositiveTypes: FalsePositiveType[] };

export interface TrainingFrame {
  detectionId: number;
  recordedAt: string;
  /** Served from frontend/public/guide/classification/. */
  src: string;
  /** The object's track box on this frame, or null when the track has none. */
  box: [number, number, number, number] | null;
  algoPredictions: AlgoPredictions | null;
  othersBboxes: AlgoPredictions | null;
}

export interface TrainingObject {
  /** The lane's sequence id in the sample dataset — only an identity here. */
  sequenceId: number;
  expected: ExpectedClassification;
  frames: TrainingFrame[];
}

/** One alert as generated from the sample dataset. */
export interface TrainingAlertData {
  /** Where it comes from in the sample dataset, for whoever regenerates it. */
  source: string;
  organisationName: string;
  cameraName: string;
  recordedAt: string;
  objects: TrainingObject[];
}

export interface TrainingAlert extends TrainingAlertData {
  expectedMissedSmoke: 'yes' | 'no';
  /** Shown once the alert is submitted, never before: it would give it away. */
  note: string;
}

export const PASS_MARK = 4;

const NOTES = [
  'A small plume rising from the far hills and drifting with the wind: wildfire smoke. Distant smoke is tiny on the full frame — read the crop loop.',
  'A pale patch on the ridge that never moves or changes shape between frames: bare rock, a cliff. Smoke rises, spreads and drifts.',
  'Smoke coming out of a fixed point among buildings, the same from frame to frame: a chimney. Smoke, but industrial — not wildfire.',
  'Wisps hanging on the hilltops at dawn, both objects: low clouds. They sit in the relief instead of rising from a point on the ground.',
  'Two objects, two answers: object 1 is a thin wildfire plume above the treeline, object 2 is a rooftop the model mistook for smoke. Classify each object on its own.',
];

export const CLASSIFICATION_EXERCISES: TrainingAlert[] = CLASSIFICATION_ALERT_DATA.map(
  (alert, i) => ({ ...alert, expectedMissedSmoke: 'no', note: NOTES[i] })
);

/** Matches the generated JSON (number[] arrays) onto the stricter types. */
function asDetection(frame: TrainingFrame, sequenceId: number): Detection {
  return {
    id: frame.detectionId,
    sequence_id: sequenceId,
    alert_api_id: frame.detectionId,
    created_at: frame.recordedAt,
    recorded_at: frame.recordedAt,
    algo_predictions: frame.algoPredictions ?? { predictions: [] },
    others_bboxes: frame.othersBboxes,
    last_modified_at: null,
  };
}

/**
 * Serves the training alerts' frames to the real players: every detection
 * id resolves to its copied image, every lane to its frames.
 */
export function trainingMediaSource(alerts: TrainingAlertData[]): DetectionMediaSource {
  const urls = new Map<number, string>();
  const detections = new Map<number, Detection[]>();
  alerts.forEach(alert =>
    alert.objects.forEach(object => {
      object.frames.forEach(frame => urls.set(frame.detectionId, frame.src));
      detections.set(
        object.sequenceId,
        object.frames.map(frame => asDetection(frame, object.sequenceId))
      );
    })
  );
  return {
    scope: 'guide-training',
    getDetectionImageUrl: async detectionId => {
      const url = urls.get(detectionId);
      if (!url) throw new Error(`No training frame for detection ${detectionId}`);
      return { url };
    },
    getSequenceDetections: async sequenceId => detections.get(sequenceId) ?? [],
  };
}

/** What the trainee answered for one object. */
export interface ObjectAnswer {
  classification: 'smoke' | 'false_positive' | 'unselected';
  unsure: boolean;
  smokeType?: SmokeType;
  falsePositiveTypes: FalsePositiveType[];
}

/**
 * Right when it matches the reference label: the smoke type for smoke, and
 * for a false positive every expected type ticked (an extra type is
 * tolerated — several can apply). Unsure is never right: every training
 * object has a known answer.
 */
export function isObjectAnswerRight(answer: ObjectAnswer, expected: ExpectedClassification) {
  if (answer.unsure) return false;
  if (expected.kind === 'smoke') {
    return answer.classification === 'smoke' && answer.smokeType === expected.smokeType;
  }
  return (
    answer.classification === 'false_positive' &&
    expected.falsePositiveTypes.every(type => answer.falsePositiveTypes.includes(type))
  );
}
