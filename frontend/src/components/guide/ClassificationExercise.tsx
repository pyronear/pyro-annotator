import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Keyboard, RotateCcw, Upload, X } from 'lucide-react';
import {
  ClassifyMediaPanel,
  ClassifyShortcutsModal,
  DecisionRail,
  ObjectRow,
} from '@/components/classify';
import { formatFalsePositiveLabel } from '@/components/classify/status';
import { TimelineLegend } from '@/components/annotation/TimelineLegend';
import type { SeekRequest } from '@/components/annotation/FullImageSequence';
import type { CardClassification } from '@/components/sequence-annotation';
import { ProgressDots, VerdictBadge } from '@/components/guide/ExerciseProgress';
import { TrainingDone } from '@/components/guide/ReadConfirmation';
import { celebrate } from '@/components/guide/celebrate';
import {
  CLASSIFICATION_EXERCISES,
  PASS_MARK,
  isObjectAnswerRight,
  trainingMediaSource,
  type ExpectedClassification,
  type TrainingAlert,
} from '@/components/guide/classificationExercises';
import { DetectionMediaSourceContext } from '@/hooks/useDetectionMediaSource';
import type { SequenceBbox } from '@/types/api';
import { hasUserAnnotations } from '@/utils/annotation/sequenceUtils';
import { createKeyboardHandler } from '@/utils/annotation/keyboardUtils';
import { getObjectColor, type ObjectOverlay } from '@/utils/annotation/objectColors';
import type { ObjectFrameStatus } from '@/utils/annotation/alertLocalizeUtils';
import { formatSmokeType } from '@/utils/modelAccuracy';
import { formatDateTime } from '@/utils/datetime';

interface ObjectVerdict {
  right: boolean;
  /** What the trainee answered, in the rail's own words. */
  answered: string;
}

interface AlertResult {
  /** The whole alert is right: every object and the missed-smoke answer. */
  matched: boolean;
  objects: ObjectVerdict[];
  missedSmokeRight: boolean;
  missedSmokeAnswer: 'yes' | 'no';
}

interface Answers {
  bboxes: Record<string, SequenceBbox>;
  classification: Record<string, CardClassification>;
  unsure: Record<string, boolean>;
  missedSmokeReview: 'yes' | 'no' | null;
}

const cardKeyOf = (sequenceId: number) => `${sequenceId}:0`;

function freshAnswers(alert: TrainingAlert): Answers {
  const bboxes: Record<string, SequenceBbox> = {};
  alert.objects.forEach(object => {
    bboxes[cardKeyOf(object.sequenceId)] = {
      is_smoke: false,
      false_positive_types: [],
      bboxes: object.frames.flatMap(frame =>
        frame.box ? [{ detection_id: frame.detectionId, xyxyn: frame.box }] : []
      ),
    };
  });
  return { bboxes, classification: {}, unsure: {}, missedSmokeReview: null };
}

function describeExpected(expected: ExpectedClassification): string {
  if (expected.kind === 'smoke') return `Smoke · ${formatSmokeType(expected.smokeType)}`;
  return `False positive · ${expected.falsePositiveTypes.map(formatFalsePositiveLabel).join(', ')}`;
}

function describeAnswer(bbox: SequenceBbox, classification: CardClassification, unsure: boolean) {
  if (unsure) return 'Unsure';
  if (classification === 'smoke' && bbox.smoke_type) {
    return `Smoke · ${formatSmokeType(bbox.smoke_type)}`;
  }
  return `False positive · ${bbox.false_positive_types.map(formatFalsePositiveLabel).join(', ')}`;
}

const MISSED_SMOKE_LABEL = { yes: 'Yes', no: 'No' } as const;

/**
 * The classification training: five reference alerts in a replica of the
 * classify cockpit — the same media panel, decision rail, object rows,
 * chips and keyboard shortcuts as `ClassifyAlertPage`, fed by static frames
 * through `DetectionMediaSourceContext` instead of the API.
 *
 * The trainee classifies every object and answers "Missed smoke?", then
 * submits, exactly as in the queue. Submitting grades the alert instead of
 * saving it: an alert is validated when every object and the missed-smoke
 * answer match the reference. Each object row then shows the expected
 * answer. `PASS_MARK` validated alerts out of five passes: confetti, then
 * `afterPass`; fewer offers a fresh attempt.
 */
export default function ClassificationExercise({
  afterPass,
  onPass,
  exercises = CLASSIFICATION_EXERCISES,
}: {
  afterPass: React.ReactNode;
  /** Called once the exercise is passed: records the module as done. */
  onPass?: () => void;
  exercises?: TrainingAlert[];
}) {
  const mediaSource = useMemo(() => trainingMediaSource(exercises), [exercises]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<AlertResult[]>([]);
  const [answers, setAnswers] = useState<Answers>(() => freshAnswers(exercises[0]));
  const [activeCardKey, setActiveCardKey] = useState(() =>
    cardKeyOf(exercises[0].objects[0].sequenceId)
  );
  const [activeSection, setActiveSection] = useState<'detections' | 'sequence'>('detections');
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null);
  const [showKeyboardModal, setShowKeyboardModal] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  const finished = index >= exercises.length;
  const alert = exercises[Math.min(index, exercises.length - 1)];
  const result: AlertResult | undefined = results[index];
  const answered = result !== undefined;

  const cardKeys = alert.objects.map(o => cardKeyOf(o.sequenceId));
  const getBbox = (cardKey: string) => answers.bboxes[cardKey];
  const isClassified = (cardKey: string) =>
    !!answers.unsure[cardKey] || hasUserAnnotations(getBbox(cardKey));
  const classifiedCount = cardKeys.filter(isClassified).length;
  const canSubmit =
    !answered && classifiedCount === cardKeys.length && answers.missedSmokeReview !== null;

  // --- Media, as the classify page builds it: one color per object, the
  // frame union across objects, own box solid and siblings dimmed.
  const overlays = alert.objects.map((object, i) => {
    const boxesByRecordedAt: Record<string, [number, number, number, number]> = {};
    object.frames.forEach(frame => {
      if (frame.box) boxesByRecordedAt[frame.recordedAt] = frame.box;
    });
    return {
      cardKey: cardKeyOf(object.sequenceId),
      color: getObjectColor(i),
      label: `Object ${i + 1}`,
      boxesByRecordedAt,
    };
  });
  const unionFrames: { detectionId: number; recordedAt: string }[] = [];
  {
    const seen = new Set<string>();
    alert.objects
      .flatMap(o => o.frames)
      .forEach(frame => {
        if (seen.has(frame.recordedAt)) return;
        seen.add(frame.recordedAt);
        unionFrames.push({ detectionId: frame.detectionId, recordedAt: frame.recordedAt });
      });
    unionFrames.sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  }
  const unionTimestamps = unionFrames.map(f => f.recordedAt);
  const activeIndex = cardKeys.indexOf(activeCardKey);
  const activeObject = alert.objects[activeIndex];
  const activeOverlay = overlays[activeIndex];
  const activeMediaObject = activeObject
    ? {
        label: activeOverlay.label,
        bboxes: unionFrames.map(f => ({
          detection_id: f.detectionId,
          xyxyn: activeOverlay.boxesByRecordedAt[f.recordedAt] ?? null,
        })),
        croppedBboxes: getBbox(activeCardKey).bboxes,
        sequenceId: activeObject.sequenceId,
        color: activeOverlay.color,
        siblingOverlays: overlays
          .filter(o => o.cardKey !== activeCardKey)
          .map(o => ({ color: o.color, label: o.label, boxesByRecordedAt: o.boxesByRecordedAt })),
        frameRecordedAt: unionTimestamps,
      }
    : null;
  const playerObjectOverlays: ObjectOverlay[] = overlays.map(o => ({
    color: o.color,
    label: o.label,
    boxesByRecordedAt: o.boxesByRecordedAt,
    isActive: true,
  }));
  const statusByObject = alert.objects.map(object => {
    const statuses: Record<string, ObjectFrameStatus> = {};
    object.frames.forEach(frame => (statuses[frame.recordedAt] = 'confirmed'));
    return statuses;
  });
  const anyAbsent = statusByObject.some(statuses => unionTimestamps.some(ts => !statuses[ts]));
  const legendEntries = [
    { status: 'confirmed' as const, label: 'Detected' },
    ...(anyAbsent ? [{ status: 'absent' as const, label: 'Not on this frame' }] : []),
  ];

  // --- Answer handlers: the same mutations the classify page applies.
  const setBbox = (cardKey: string, bbox: SequenceBbox) => {
    if (answered) return;
    setAnswers(prev => ({ ...prev, bboxes: { ...prev.bboxes, [cardKey]: bbox } }));
  };
  const setClassification = (cardKey: string, classification: CardClassification) => {
    if (answered) return;
    setAnswers(prev => ({
      ...prev,
      classification: { ...prev.classification, [cardKey]: classification },
    }));
  };
  const setUnsure = (cardKey: string, unsure: boolean) => {
    if (answered) return;
    setAnswers(prev => ({ ...prev, unsure: { ...prev.unsure, [cardKey]: unsure } }));
  };
  const setMissedSmokeReview = (review: 'yes' | 'no') => {
    if (answered) return;
    setAnswers(prev => ({ ...prev, missedSmokeReview: review }));
  };
  const activate = (cardKey: string) => {
    setActiveCardKey(cardKey);
    setActiveSection('detections');
  };

  const submit = () => {
    const missedSmokeAnswer = answers.missedSmokeReview;
    if (!canSubmit || missedSmokeAnswer === null) return;
    const objects = alert.objects.map(object => {
      const key = cardKeyOf(object.sequenceId);
      const bbox = getBbox(key);
      const classification = answers.classification[key] ?? 'unselected';
      const unsure = !!answers.unsure[key];
      return {
        right: isObjectAnswerRight(
          {
            classification,
            unsure,
            smokeType: bbox.smoke_type,
            falsePositiveTypes: bbox.false_positive_types,
          },
          object.expected
        ),
        answered: describeAnswer(bbox, classification, unsure),
      };
    });
    const missedSmokeRight = missedSmokeAnswer === alert.expectedMissedSmoke;
    setResults(prev => [
      ...prev,
      {
        matched: missedSmokeRight && objects.every(o => o.right),
        objects,
        missedSmokeRight,
        missedSmokeAnswer,
      },
    ]);
  };

  const goTo = (nextIndex: number, nextResults: AlertResult[]) => {
    setResults(nextResults);
    setIndex(nextIndex);
    const nextAlert = exercises[Math.min(nextIndex, exercises.length - 1)];
    setAnswers(freshAnswers(nextAlert));
    setActiveCardKey(cardKeyOf(nextAlert.objects[0].sequenceId));
    setActiveSection('detections');
    setSeekRequest(null);
    sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const next = () => goTo(index + 1, results);
  const restart = () => goTo(0, []);

  // Keyboard shortcuts, as in the classify cockpit (S/F, types, U, Y/N,
  // Enter to submit, ? for the cheat sheet) — only while an alert is open.
  useEffect(() => {
    if (finished || answered) return;
    const bboxes = cardKeys.map(getBbox);
    const classification: Record<number, CardClassification> = {};
    cardKeys.forEach((key, i) => (classification[i] = answers.classification[key] ?? 'unselected'));
    const handleKeyDown = createKeyboardHandler({
      activeDetectionIndex: activeSection === 'detections' ? activeIndex : null,
      bboxes,
      showKeyboardModal,
      missedSmokeReview: answers.missedSmokeReview,
      primaryClassification: classification,
      setShowKeyboardModal,
      handleReset: () => setAnswers(freshAnswers(alert)),
      handleSave: submit,
      handleMissedSmokeReviewChange: setMissedSmokeReview,
      handleBboxChange: (i, bbox) => setBbox(cardKeys[i], bbox),
      onPrimaryClassificationChange: updates =>
        Object.entries(updates).forEach(([i, value]) => {
          if (value === 'unselected') return;
          setClassification(cardKeys[Number(i)], value);
          setUnsure(cardKeys[Number(i)], false);
        }),
      onUnsureToggle: i => {
        const key = cardKeys[i];
        const nextUnsure = !answers.unsure[key];
        if (nextUnsure) {
          setClassification(key, 'unselected');
          setBbox(key, {
            ...getBbox(key),
            is_smoke: false,
            smoke_type: undefined,
            false_positive_types: [],
          });
        }
        setUnsure(key, nextUnsure);
      },
    });
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
    // Re-registered on every answer change, like the classify page's handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, answered, answers, activeCardKey, activeSection, showKeyboardModal, index]);

  if (finished) {
    return (
      <ExerciseSummary
        exercises={exercises}
        results={results}
        afterPass={afterPass}
        onPass={onPass}
        onRestart={restart}
      />
    );
  }

  return (
    <DetectionMediaSourceContext.Provider value={mediaSource}>
      <section ref={sectionRef} aria-label="Classification exercise" className="scroll-mt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-ember">
            Alert {index + 1} of {exercises.length}
          </span>
          <ProgressDots
            total={exercises.length}
            current={index}
            results={results}
            itemLabel="Alert"
            rightWord="validated"
            wrongWord="not validated"
          />
        </div>

        {/* The classify page's pinned header, in place rather than fixed. */}
        <div className="mb-4 flex h-12 items-center gap-3 rounded-lg border border-line bg-paper px-4">
          <h3 className="truncate font-display text-heading font-semibold text-char">
            {alert.organisationName} · {alert.cameraName}
          </h3>
          <span className="hidden shrink-0 font-data text-detail text-haze sm:inline">
            {formatDateTime(alert.recordedAt)}
          </span>
          <span
            className={`flex-none rounded-full px-2.5 py-0.5 font-data text-xs font-semibold ${
              classifiedCount === cardKeys.length
                ? 'bg-pine-soft text-pine'
                : 'bg-ember-soft text-ember'
            }`}
          >
            {classifiedCount} of {cardKeys.length} objects classified
          </span>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="relative lg:min-w-0 lg:flex-[1.5]">
            {/* Keyed per alert: each alert's players start from frame one. */}
            <ClassifyMediaPanel
              key={index}
              activeSection={activeSection}
              activeObject={activeMediaObject}
              primarySequenceId={alert.objects[0].sequenceId}
              missedSmokeReview={answers.missedSmokeReview}
              onMissedSmokeReviewChange={setMissedSmokeReview}
              missedSmokeDisabled={answered}
              annotationLoading={false}
              objectOverlays={playerObjectOverlays}
              seekRequest={seekRequest}
            />
            {answered && (
              <VerdictBadge
                matched={result.matched}
                rightLabel="Alert validated"
                wrongLabel="Alert not validated"
              />
            )}
          </div>
          <div className="lg:min-w-0 lg:flex-1">
            <DecisionRail
              missedSmokeReview={answers.missedSmokeReview}
              onMissedSmokeReviewChange={setMissedSmokeReview}
              missedSmokeActive={activeSection === 'sequence'}
              onMissedSmokeActivate={() => setActiveSection('sequence')}
              missedSmokeDisabled={answered}
              legend={<TimelineLegend testid="training-timeline-legend" entries={legendEntries} />}
              headerAction={
                <button
                  type="button"
                  onClick={() => setShowKeyboardModal(true)}
                  className="rounded-lg border border-line bg-paper p-1.5 text-haze hover:bg-ash"
                  title="Show keyboard shortcuts (?)"
                >
                  <Keyboard className="h-4 w-4" />
                </button>
              }
              footer={
                answered ? (
                  <MissedSmokeVerdict result={result} expected={alert.expectedMissedSmoke} />
                ) : (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!canSubmit}
                    data-testid="training-submit"
                    title={
                      answers.missedSmokeReview === null && classifiedCount === cardKeys.length
                        ? 'Answer "Missed smoke?" to submit'
                        : canSubmit
                          ? 'Submit alert (Enter)'
                          : 'Classify every object to submit'
                    }
                    className="flex w-full items-center justify-center rounded-lg bg-pine px-5 py-2.5 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Submit
                    <kbd
                      aria-hidden="true"
                      className="ml-2 rounded bg-white/20 px-1 py-0.5 font-data text-[10px] font-medium text-white"
                    >
                      Enter
                    </kbd>
                  </button>
                )
              }
            >
              {alert.objects.map((object, i) => {
                const key = cardKeyOf(object.sequenceId);
                const verdict = result?.objects[i];
                return (
                  <div key={key}>
                    <ObjectRow
                      objectNumber={i + 1}
                      cardKey={key}
                      color={overlays[i].color}
                      bbox={getBbox(key)}
                      classification={answers.classification[key] ?? 'unselected'}
                      unsure={!!answers.unsure[key]}
                      isActive={activeCardKey === key && activeSection === 'detections'}
                      locked={answered}
                      onRowClick={activate}
                      timeline={{
                        frameTimestamps: unionTimestamps,
                        statusByTimestamp: statusByObject[i],
                        onFrameClick: (_ts, frameIndex) => {
                          activate(key);
                          setSeekRequest(prev => ({
                            index: frameIndex,
                            nonce: (prev?.nonce ?? 0) + 1,
                          }));
                        },
                      }}
                      onBboxChange={setBbox}
                      onClassificationChange={setClassification}
                      onUnsureChange={setUnsure}
                    />
                    {verdict && <ObjectVerdictLine verdict={verdict} expected={object.expected} />}
                  </div>
                );
              })}
            </DecisionRail>
          </div>
        </div>

        {answered ? (
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1" role="status">
              <p
                className={`font-body text-body font-semibold ${result.matched ? 'text-pine' : 'text-signal'}`}
              >
                {result.matched ? 'Alert validated' : 'Not quite'}
              </p>
              <p className="mt-1 font-body text-detail text-haze">{alert.note}</p>
            </div>
            <button
              type="button"
              onClick={next}
              autoFocus
              className="inline-flex items-center gap-1.5 rounded-lg bg-pine px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
            >
              {index + 1 < exercises.length ? 'Next alert' : 'See my result'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <p className="mt-4 font-body text-detail text-haze">
            Classify every object, answer “Missed smoke?”, then submit — exactly as in the Classify
            queue. Click an object to see it, click “Missed smoke?” to watch the whole alert.
          </p>
        )}

        {showKeyboardModal && (
          <ClassifyShortcutsModal onClose={() => setShowKeyboardModal(false)} />
        )}
      </section>
    </DetectionMediaSourceContext.Provider>
  );
}

function ObjectVerdictLine({
  verdict,
  expected,
}: {
  verdict: ObjectVerdict;
  expected: ExpectedClassification;
}) {
  const Icon = verdict.right ? Check : X;
  return (
    <p
      className={`mt-1 flex items-start gap-1.5 px-1 font-body text-detail ${
        verdict.right ? 'text-pine' : 'text-signal'
      }`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={3} aria-hidden />
      <span>
        {verdict.right ? (
          <>Right — {describeExpected(expected)}</>
        ) : (
          <>
            You said {verdict.answered} · expected{' '}
            <span className="font-semibold">{describeExpected(expected)}</span>
          </>
        )}
      </span>
    </p>
  );
}

function MissedSmokeVerdict({ result, expected }: { result: AlertResult; expected: 'yes' | 'no' }) {
  const Icon = result.missedSmokeRight ? Check : X;
  return (
    <p
      className={`flex items-start gap-1.5 px-1 font-body text-detail ${
        result.missedSmokeRight ? 'text-pine' : 'text-signal'
      }`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={3} aria-hidden />
      <span>
        Missed smoke:{' '}
        {result.missedSmokeRight ? (
          <>right — {MISSED_SMOKE_LABEL[expected]}</>
        ) : (
          <>
            you said {MISSED_SMOKE_LABEL[result.missedSmokeAnswer]} · expected{' '}
            <span className="font-semibold">{MISSED_SMOKE_LABEL[expected]}</span>
          </>
        )}
      </span>
    </p>
  );
}

function ExerciseSummary({
  exercises,
  results,
  afterPass,
  onPass,
  onRestart,
}: {
  exercises: TrainingAlert[];
  results: AlertResult[];
  afterPass: React.ReactNode;
  onPass?: () => void;
  onRestart: () => void;
}) {
  const scoreRef = useRef<HTMLDivElement>(null);
  const validated = results.filter(r => r.matched).length;
  const passed = validated >= PASS_MARK;

  useEffect(() => {
    if (!passed) return;
    celebrate(scoreRef.current);
    onPass?.();
    // Once per pass, not on every new `onPass` identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passed]);

  return (
    <section aria-label="Classification exercise result" className="mx-auto max-w-3xl">
      <div ref={scoreRef} className="mb-6 text-center">
        <p className="font-data text-[38px] font-semibold leading-none text-char">
          {validated}
          <span className="text-haze"> / {exercises.length}</span>
        </p>
        <p className="mt-1 font-body text-detail text-haze">
          alerts validated · {PASS_MARK} needed to pass
        </p>
      </div>

      <ul className="mb-8 grid grid-cols-5 gap-2">
        {exercises.map((alert, i) => {
          const r = results[i];
          const thumb = alert.objects[0].frames[alert.objects[0].frames.length - 1];
          return (
            <li key={alert.source} className="relative">
              <img
                src={thumb.src}
                alt={`Training alert ${i + 1}`}
                className="block aspect-video w-full rounded-lg border border-line object-cover"
              />
              {r && (
                <VerdictBadge
                  matched={r.matched}
                  small
                  rightLabel="Alert validated"
                  wrongLabel="Alert not validated"
                />
              )}
            </li>
          );
        })}
      </ul>

      {passed ? (
        <TrainingDone message="Passed — you're ready to classify!">{afterPass}</TrainingDone>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-signal-soft px-4 py-3">
          <span className="font-body text-body font-semibold text-signal">
            Not yet — you need {PASS_MARK} validated alerts out of {exercises.length}. Have another
            go.
          </span>
          <button
            type="button"
            onClick={onRestart}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-2 font-body text-sm font-medium text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char"
          >
            <RotateCcw className="h-4 w-4" />
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
