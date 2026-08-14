/**
 * The localize object editor's box model.
 *
 * An object has AT MOST ONE box per frame — see
 * docs/specs/2026-08-05-localize-object-editor-revamp-design.md. This module
 * answers, for one object on one frame: which boxes are on offer (manual,
 * auto, engine), which one is currently committed, and which one wins by
 * default.
 *
 * Candidates are modelled as a LIST rather than a fixed three-slot record.
 * Nothing in the pipeline guarantees a model layer returns a single box —
 * object_split.py:208 writes a list, worker.py:109 keeps every box overlapping
 * the lane's anchor — so a layer holding two boxes must render as two rows
 * rather than reach an unhandled branch. It is not hypothetical: 255 of 6,807
 * auto-annotated detections (3.7%) carried more than one auto box as of
 * 2026-08-12, the extras being sub-0.1-confidence noise from a detector run
 * at a 0.01 floor. Only ONE is ever drawn or committed by default — the one
 * anchored to the frame, see `boxCandidates` and `getWinningBoxes`.
 */

import type {
  AlgoPrediction,
  AnnotationOrigin,
  Detection,
  DetectionAnnotation,
  DetectionAnnotationBbox,
  SmokeType,
} from '@/types/api';
import { focusOnMainObject } from './gridCropUtils';

export type BoxSource = 'manual' | 'auto' | 'engine';

export interface BoxCandidate {
  source: BoxSource;
  /** Position within its own source layer; 0 unless a layer returned several. */
  index: number;
  xyxyn: [number, number, number, number];
  /** Model confidence, absent for a manual box. */
  confidence?: number;
}

/** Priority order — the array order `boxCandidates` returns. */
const SOURCE_ORDER: BoxSource[] = ['manual', 'auto', 'engine'];

const ORIGIN_BY_SOURCE: Record<BoxSource, AnnotationOrigin> = {
  manual: 'human',
  auto: 'auto',
  engine: 'engine',
};

/** A committed item with no `origin` predates origin tracking; it was hand-drawn. */
function sourceOfOrigin(origin: AnnotationOrigin | undefined): BoxSource {
  if (origin === 'auto') return 'auto';
  if (origin === 'engine') return 'engine';
  return 'manual';
}

function smokeItems(annotation: DetectionAnnotation | null | undefined): DetectionAnnotationBbox[] {
  return (annotation?.annotation?.annotation ?? []).filter(item => item.smoke_type != null);
}

function fromPredictions(source: BoxSource, predictions: AlgoPrediction[]): BoxCandidate[] {
  return predictions.map((p, index) => ({
    source,
    index,
    xyxyn: p.xyxyn,
    confidence: p.confidence,
  }));
}

/**
 * The box currently written to the database, or null. False-positive items
 * (no `smoke_type`) are not boxes for this object and never surface here.
 */
export function committedBox(
  annotation: DetectionAnnotation | null | undefined
): BoxCandidate | null {
  const [item] = smokeItems(annotation);
  if (!item) return null;
  return { source: sourceOfOrigin(item.origin), index: 0, xyxyn: item.xyxyn };
}

/**
 * Whether this frame carries a committed "no box for this object here" —
 * the annotator's clear, as opposed to a frame nobody has decided yet.
 *
 * Committed stage, no box for this object — the same question
 * `alertLocalizeUtils.ts` asks for its `cleared` timeline status and
 * `collectLaneBoxes` for its preview; the editor needs its own read because
 * it works from a single annotation rather than from the alert model.
 *
 * Those two count boxes as `false_positive_type == null` while `committedBox`
 * counts them as `smoke_type != null`. The two agree on every item the API
 * documents (`DetectionAnnotationBbox` sets exactly one of the pair), and
 * disagree only on a malformed item carrying neither — which would make this
 * report "cleared" while the preview drew a box. Excluded explicitly rather
 * than left to the invariant, so the surfaces cannot drift apart on data no
 * one is validating.
 */
export function isCleared(annotation: DetectionAnnotation | null | undefined): boolean {
  if (annotation?.processing_stage !== 'annotated') return false;
  const items = annotation.annotation?.annotation ?? [];
  return items.every(item => item.false_positive_type != null);
}

/**
 * Every box on offer for this object on this frame, in priority order
 * (manual, then auto, then engine). A manual candidate exists only once one
 * has been drawn and saved — drawing commits immediately, so the committed
 * annotation IS where a manual box lives.
 *
 * Within the auto layer, the boxes anchored to THIS frame come first, so the
 * head of the list — what `priorityPick` returns and Enter commits — is the
 * same box `getWinningBoxes` draws in the grid and writes on accept-remaining.
 * The model orders its output by confidence, but the worker's anchor is
 * sequence-wide, so the most confident box is not always the one on this
 * frame's plume.
 *
 * The runners-up are kept, in their original order, but note what that does
 * and does not buy: `BoxSourceRail` renders one row per SOURCE, so only the
 * head of each layer is clickable, and `G` ghosts the rest for comparison
 * without offering them. On a frame whose engine anchor is stale, the more
 * confident box is therefore visible but not selectable — the annotator has
 * to draw it. Acceptable because the anchored box is the better default on
 * the 30% of multi-box frames where the two differ, but it is a real
 * trade, not a free one.
 */
export function boxCandidates(
  detection: Detection,
  annotation: DetectionAnnotation | null | undefined
): BoxCandidate[] {
  const committed = committedBox(annotation);
  const manual: BoxCandidate[] = committed && committed.source === 'manual' ? [committed] : [];

  const auto = fromPredictions('auto', detection.auto_predictions?.predictions ?? []);
  const anchored = new Set(focusOnMainObject(detection, auto));

  return [
    ...manual,
    ...auto.filter(c => anchored.has(c)),
    ...auto.filter(c => !anchored.has(c)),
    ...fromPredictions('engine', detection.algo_predictions?.predictions ?? []),
  ];
}

/** What gets committed if the annotator just says "yes": manual > auto > engine. */
export function priorityPick(candidates: BoxCandidate[]): BoxCandidate | null {
  for (const source of SOURCE_ORDER) {
    const match = candidates.find(c => c.source === source);
    if (match) return match;
  }
  return null;
}

/**
 * The box the nearest earlier lane frame SHOWS for this object — its committed
 * box, or the winning pick it would commit if undecided. What `P` copies onto
 * the current frame. Cleared frames show no box (the annotator said "not
 * visible here") and are skipped, as are frames with nothing on offer.
 */
export function previousShownBox(
  currentDetectionId: number,
  laneDetections: Detection[],
  laneAnnotations: DetectionAnnotation[]
): [number, number, number, number] | null {
  const index = laneDetections.findIndex(d => d.id === currentDetectionId);
  for (let i = index - 1; i >= 0; i--) {
    const det = laneDetections[i];
    const annotation = laneAnnotations.find(a => a.detection_id === det.id) ?? null;
    const committed = committedBox(annotation);
    if (committed) return committed.xyxyn;
    if (isCleared(annotation)) continue;
    const pick = priorityPick(boxCandidates(det, annotation));
    if (pick) return pick.xyxyn;
  }
  return null;
}

/** Whether any model layer put a box on this frame. A frame without model
 *  evidence exists in its lane only because a human boxed it (a materialized
 *  gap frame, or any frame of an added-object lane), so clearing it removes
 *  the frame itself — issue #287's un-materialize. */
export function hasModelEvidence(detection: Detection): boolean {
  return (
    (detection.algo_predictions?.predictions?.length ?? 0) > 0 ||
    (detection.auto_predictions?.predictions?.length ?? 0) > 0
  );
}

/** The single annotation item this candidate commits to. */
export function candidateToBbox(
  candidate: BoxCandidate,
  smokeType: SmokeType
): DetectionAnnotationBbox {
  return {
    xyxyn: candidate.xyxyn,
    class_name: 'smoke',
    smoke_type: smokeType,
    origin: ORIGIN_BY_SOURCE[candidate.source],
  };
}
