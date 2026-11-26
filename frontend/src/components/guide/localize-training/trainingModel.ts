/**
 * The localization training, run on the real localize components without the
 * API.
 *
 * A training alert becomes exactly what `LocalizeAlertPage` loads for a real
 * one — one `AlertLane` waiting for localization and a `Detection` per frame
 * carrying the engine and auto model boxes — so `buildAlertFrameModel`, the
 * frame grid, the rail and the object editor all run unchanged. What the
 * annotator commits is kept in local state as ordinary `DetectionAnnotation`s
 * instead of being written to the server.
 *
 * The images come from a training-only query client seeded with each frame's
 * static URL under the key `useDetectionImage` reads, marked as never stale,
 * so no component ever asks the API for a training frame.
 */

import { QueryClient } from '@tanstack/react-query';
import type {
  AlertLane,
  Detection,
  DetectionAnnotation,
  DetectionAnnotationBbox,
  SmokeType,
} from '@/types/api';
import { QUERY_KEYS } from '@/utils/constants';
import { committedBox } from '@/utils/annotation/objectBoxCandidates';
import {
  MATCH_IOU,
  boxIoU,
  boxMismatch,
  type BoxMismatch,
  type NormalizedBox,
} from '@/utils/annotation/boxOverlap';
import {
  LOCALIZE_TRAINING_ALERTS,
  type TrainingAlert,
  type TrainingPrediction,
} from './trainingAlerts';

export const TRAINING_SMOKE_TYPE = 'wildfire' as SmokeType;

/** Ids in a range of their own, so a training frame is never mistaken for a real one. */
const ID_BASE = 900_000;
export const trainingLaneId = (alertIndex: number) => ID_BASE + alertIndex;
export const trainingDetectionId = (alertIndex: number, frameIndex: number) =>
  ID_BASE + (alertIndex + 1) * 1000 + frameIndex + 1;

const toPredictions = (predictions: TrainingPrediction[]) => ({
  predictions: predictions.map(([x1, y1, x2, y2, confidence]) => ({
    xyxyn: [x1, y1, x2, y2] as NormalizedBox,
    confidence,
    class_name: 'smoke',
  })),
});

export interface TrainingAlertModel {
  laneId: number;
  lane: AlertLane;
  /** One per frame, chronological — the frame order of `alert.frames`. */
  detections: Detection[];
}

/** The alert as the localize page would load it: one wildfire object, classified and waiting. */
export function buildTrainingAlert(alert: TrainingAlert, alertIndex: number): TrainingAlertModel {
  const laneId = trainingLaneId(alertIndex);
  const detections: Detection[] = alert.frames.map((frame, frameIndex) => ({
    id: trainingDetectionId(alertIndex, frameIndex),
    sequence_id: laneId,
    alert_api_id: 0,
    created_at: frame.recordedAt,
    recorded_at: frame.recordedAt,
    algo_predictions: toPredictions(frame.engine),
    auto_predictions: frame.auto.length > 0 ? toPredictions(frame.auto) : null,
    others_bboxes: null,
    last_modified_at: null,
  }));
  const lastSeen = alert.frames[alert.frames.length - 1]?.recordedAt ?? alert.recordedAt;
  return {
    laneId,
    detections,
    lane: {
      sequence: {
        id: laneId,
        source_api: 'training',
        alert_api_id: 0,
        created_at: alert.recordedAt,
        recorded_at: alert.recordedAt,
        last_seen_at: lastSeen,
        camera_name: alert.camera,
        camera_id: 0,
        lat: 0,
        lon: 0,
        azimuth: null,
        is_wildfire_alertapi: null,
        organisation_name: alert.organisation,
        organisation_id: 0,
        platform_alert_id: 0,
      },
      annotation: {
        id: laneId,
        sequence_id: laneId,
        has_smoke: true,
        has_false_positives: false,
        false_positive_types: '',
        smoke_types: [TRAINING_SMOKE_TYPE],
        has_missed_smoke: false,
        is_unsure: false,
        annotation: { sequences_bbox: [] },
        processing_stage: 'seq_annotation_done',
        created_at: alert.recordedAt,
        updated_at: null,
      },
    },
  };
}

/** A frame's committed decision, as the server would store it: the box, or none (cleared). */
export function committedAnnotation(
  detectionId: number,
  items: DetectionAnnotationBbox[]
): DetectionAnnotation {
  return {
    id: detectionId,
    detection_id: detectionId,
    annotation: { annotation: items },
    processing_stage: 'annotated',
    created_at: new Date().toISOString(),
    updated_at: null,
  };
}

/** Later than any clock will read, so the seeded image URLs are never refetched. */
const NEVER_STALE = Number.MAX_SAFE_INTEGER;

export function createTrainingQueryClient(alerts: TrainingAlert[] = LOCALIZE_TRAINING_ALERTS) {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime Infinity: an unobserved seed must not be collected, or the
      // next component to read it would fall through to the API.
      queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false },
    },
  });
  alerts.forEach((alert, alertIndex) =>
    alert.frames.forEach((frame, frameIndex) =>
      client.setQueryData(
        [...QUERY_KEYS.DETECTION_IMAGE, trainingDetectionId(alertIndex, frameIndex)],
        { url: frame.src },
        { updatedAt: NEVER_STALE }
      )
    )
  );
  return client;
}

/**
 * What went wrong on a frame: a box kept where there is no smoke, no box
 * where there is, or a box that does not fit the plume (see `boxMismatch`).
 */
export type FrameMistake = 'box-without-smoke' | 'no-box-on-smoke' | BoxMismatch;

export interface FrameGrade {
  recordedAt: string;
  right: boolean;
  mistake?: FrameMistake;
  /** Overlap with the expected box, when both exist. */
  iou?: number;
}

export interface AlertGrade {
  right: boolean;
  frames: FrameGrade[];
  wrongFrameCount: number;
  /** Answered Yes to "Missed smoke?" — none of the training alerts has any. */
  missedSmokeWrong: boolean;
}

/**
 * Grade one submitted alert. A frame is right when its decision matches the
 * validated one: no box where there is no smoke, or a box overlapping the
 * expected one by at least `MATCH_IOU`. The alert is right when every frame
 * is, and the missed-smoke question was answered No.
 */
export function gradeTrainingAlert(
  alert: TrainingAlert,
  decisions: (NormalizedBox | null)[],
  missedSmoke: boolean
): AlertGrade {
  const frames = alert.frames.map((frame, i): FrameGrade => {
    const drawn = decisions[i] ?? null;
    const expected = frame.expected;
    if (!expected) {
      return drawn
        ? { recordedAt: frame.recordedAt, right: false, mistake: 'box-without-smoke' }
        : { recordedAt: frame.recordedAt, right: true };
    }
    if (!drawn) return { recordedAt: frame.recordedAt, right: false, mistake: 'no-box-on-smoke' };
    const iou = boxIoU(drawn, expected);
    return iou >= MATCH_IOU
      ? { recordedAt: frame.recordedAt, right: true, iou }
      : { recordedAt: frame.recordedAt, right: false, iou, mistake: boxMismatch(drawn, expected) };
  });
  const wrongFrameCount = frames.filter(f => !f.right).length;
  return {
    frames,
    wrongFrameCount,
    missedSmokeWrong: missedSmoke,
    right: wrongFrameCount === 0 && !missedSmoke,
  };
}

/** Each frame's committed box, or null where it was cleared or never decided. */
export function decisionsFor(
  detections: Detection[],
  annotations: Record<number, DetectionAnnotation>
): (NormalizedBox | null)[] {
  return detections.map(d => committedBox(annotations[d.id])?.xyxyn ?? null);
}
