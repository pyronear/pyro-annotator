/**
 * /guide/localization/practice — the localization training: the Localize
 * cockpit, on four real alerts, with a verdict after each submit.
 *
 * Everything the annotator touches is the production component — the frame
 * grid with its dashed model boxes, Accept boxes and its confirm popover, the
 * frame editor (Auto / Engine / None / drawing a manual box), the objects rail
 * and its timeline, Missed smoke? and Submit — fed by `trainingModel`, which
 * turns each training alert into the lane and detections the real page loads,
 * and keeps what gets committed in local state. Nothing reaches the API.
 *
 * Submit grades the alert frame by frame against the validated annotation
 * (`gradeTrainingAlert`) and switches the cockpit to review: each frame gets
 * a tick or a cross and the expected box beside the committed one, and the
 * rail says what was wrong and what the alert was about. Three right alerts
 * out of four passes: confetti, the module ticked as done on the guide hub,
 * then off to localize.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, PlayCircle, RotateCcw, Upload, X } from 'lucide-react';
import type { DetectionAnnotation, DetectionAnnotationBbox, Detection } from '@/types/api';
import {
  LocalizeActionPanel,
  LocalizeMissedSmokeRow,
  LocalizeObjectActions,
  LocalizeObjectRow,
  LocalizeRail,
  LocalizeTimelineLegend,
} from '@/components/localize';
import { AcceptRemainingPopover } from '@/components/localize/editor/AcceptRemainingPopover';
import { LocalizeObjectEditor } from '@/components/localize/editor';
import { AlertFrameGrid, ViewToolbar, type CardSize } from '@/components/detection-sequence';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import { Tooltip } from '@/components/ui/Tooltip';
import { TrainingDone } from '@/components/guide/ReadConfirmation';
import { StartAnnotating } from '@/components/guide/NextSteps';
import { celebrate } from '@/components/guide/celebrate';
import {
  LOCALIZE_TRAINING_ALERTS,
  TRAINING_PASS_MARK,
  type TrainingAlert,
} from '@/components/guide/localize-training/trainingAlerts';
import {
  TRAINING_SMOKE_TYPE,
  buildTrainingAlert,
  committedAnnotation,
  createTrainingQueryClient,
  decisionsFor,
  gradeTrainingAlert,
  type AlertGrade,
  type FrameMistake,
} from '@/components/guide/localize-training/trainingModel';
import {
  buildAlertFrameModel,
  objectLocalizeProgress,
  timelineLegendStatuses,
  type AlertFrame,
} from '@/utils/annotation/alertLocalizeUtils';
import { buildQuickSubmitPlan, collectLaneBoxes } from '@/utils/annotation/quickSubmitUtils';
import { buildFilmstripEntries } from '@/utils/annotation/objectFilmstrip';
import { useToastNotifications } from '@/utils/notification/toastUtils';
import { NotificationSystem } from '@/components/ui/NotificationSystem';
import { formatDateTime } from '@/utils/datetime';
import { useAuthStore } from '@/store/useAuthStore';
import { useMarkModuleCompleted } from '@/store/useGuideProgressStore';
import { ROUTES } from '@/utils/routes';

/** Same column widths as the localize page's S/M/L knob. */
const CARD_MIN_WIDTH: Record<CardSize, number> = { sm: 240, md: 340, lg: 500 };

/** The validated box, shown in review: bright green, dashed, apart from the object's own colour. */
const EXPECTED_COLOR = '#22E07A';
/** A pseudo-lane carrying the expected boxes in review, so the grid draws them with the rest. */
const EXPECTED_LANE_ID = -1;

const MISTAKE_TEXT: Record<FrameMistake, string> = {
  'box-without-smoke': 'No smoke on this frame, but a box was kept — choose None.',
  'no-box-on-smoke': 'There is smoke on this frame, but no box.',
  missed: 'The box is not on the smoke.',
  'too-loose': 'The box is too loose — keep it tight around the plume.',
  'too-tight': 'The box is too tight — include the whole plume.',
  'off-centre': 'The box is off to one side of the plume.',
};

export default function LocalizeTrainingPage() {
  const [queryClient] = useState(() => createTrainingQueryClient());
  const [attempt, setAttempt] = useState(0);
  const [alertIndex, setAlertIndex] = useState(0);
  const [grades, setGrades] = useState<AlertGrade[]>([]);

  const alerts = LOCALIZE_TRAINING_ALERTS;
  const finished = alertIndex >= alerts.length;

  const restart = () => {
    setGrades([]);
    setAlertIndex(0);
    setAttempt(a => a + 1);
  };

  return (
    <QueryClientProvider client={queryClient}>
      {finished ? (
        <TrainingSummary alerts={alerts} grades={grades} onRestart={restart} />
      ) : (
        <TrainingAlertCockpit
          // A fresh cockpit per alert (and per attempt): nothing committed on
          // one alert may leak into the next.
          key={`${attempt}-${alertIndex}`}
          alert={alerts[alertIndex]}
          alertIndex={alertIndex}
          alertCount={alerts.length}
          grades={grades}
          onGraded={grade => setGrades(prev => [...prev.slice(0, alertIndex), grade])}
          onNext={() => setAlertIndex(i => i + 1)}
        />
      )}
    </QueryClientProvider>
  );
}

function TrainingAlertCockpit({
  alert,
  alertIndex,
  alertCount,
  grades,
  onGraded,
  onNext,
}: {
  alert: TrainingAlert;
  alertIndex: number;
  alertCount: number;
  grades: AlertGrade[];
  onGraded: (grade: AlertGrade) => void;
  onNext: () => void;
}) {
  const { laneId, lane, detections } = useMemo(
    () => buildTrainingAlert(alert, alertIndex),
    [alert, alertIndex]
  );

  const [annotations, setAnnotations] = useState<Record<number, DetectionAnnotation>>({});
  const [missedSmoke, setMissedSmoke] = useState(false);
  const [grade, setGrade] = useState<AlertGrade | null>(null);
  const [editorDetectionId, setEditorDetectionId] = useState<number | null>(null);
  // The localize page opens an alert focused on its object: cropped, small cards.
  const [cardSize, setCardSize] = useState<CardSize>('sm');
  const [cropMode, setCropMode] = useState(true);
  const [cropExpanded, setCropExpanded] = useState(false);
  const [acceptPopoverOpen, setAcceptPopoverOpen] = useState(false);
  const [highlightedFrame, setHighlightedFrame] = useState<string | null>(null);
  const acceptAnchorRef = useRef<HTMLDivElement>(null);
  const frameRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingEditorOriginRef = useRef<DOMRect | null>(null);

  const { showToast, toastMessage, toastType, showToastNotification, dismissToast } =
    useToastNotifications();

  const reviewing = grade !== null;
  const annotationList = useMemo(() => Object.values(annotations), [annotations]);
  const annotationMap = useMemo(
    () => new Map(annotationList.map(a => [a.detection_id, a])),
    [annotationList]
  );

  const frameModel = buildAlertFrameModel(
    [lane],
    { [laneId]: detections },
    { [laneId]: annotationList }
  );
  const object = frameModel.objectStatus[0];
  const progress = objectLocalizeProgress(object.statusByTimestamp);
  const localized = progress.confirmedCount === progress.presentCount;
  const frameTimestamps = frameModel.frames.map(f => f.recordedAt);
  const legendStatuses = timelineLegendStatuses([object.statusByTimestamp]);

  const laneBoxes = useMemo(
    () => collectLaneBoxes(detections, annotationMap, { markCleared: true }),
    [detections, annotationMap]
  );
  const acceptEntries = buildFilmstripEntries(
    frameModel.frames,
    laneId,
    detections,
    annotationList
  );
  const acceptRemainingCount = acceptEntries.filter(
    e => e.inObject && !e.cleared && !e.committedSource && e.availableSource
  ).length;
  const acceptGapCount = acceptEntries.filter(
    e => e.inObject && !e.cleared && !e.committedSource && !e.availableSource
  ).length;

  const commit = (detection: Detection, items: DetectionAnnotationBbox[]) =>
    setAnnotations(prev => ({ ...prev, [detection.id]: committedAnnotation(detection.id, items) }));

  // Accept the winning model box on every undecided frame — the same plan the
  // localize page sends to the server in one request.
  const acceptRemaining = (onAccepted?: () => void) => {
    const plan = buildQuickSubmitPlan(detections, annotationMap, TRAINING_SMOKE_TYPE);
    setAnnotations(prev => {
      const next = { ...prev };
      for (const payload of plan.payloads) {
        next[payload.detection.id] = committedAnnotation(
          payload.detection.id,
          payload.body.annotation.annotation
        );
      }
      return next;
    });
    showToastNotification("Object's boxes accepted", 'success');
    onAccepted?.();
  };

  const submit = () => {
    const result = gradeTrainingAlert(alert, decisionsFor(detections, annotations), missedSmoke);
    setGrade(result);
    setEditorDetectionId(null);
    setAcceptPopoverOpen(false);
    onGraded(result);
  };

  const scrollToFrame = (recordedAt: string) => {
    setHighlightedFrame(recordedAt);
    requestAnimationFrame(() =>
      frameRefs.current[recordedAt]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    );
  };
  useEffect(() => {
    if (!highlightedFrame) return;
    const timer = setTimeout(() => setHighlightedFrame(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightedFrame]);

  const openEditor = (recordedAt: string, detectionId: number) => {
    if (reviewing) return;
    pendingEditorOriginRef.current = frameRefs.current[recordedAt]?.getBoundingClientRect() ?? null;
    setEditorDetectionId(detectionId);
  };
  const takeEditorOpenRect = () => {
    const rect = pendingEditorOriginRef.current;
    pendingEditorOriginRef.current = null;
    return rect;
  };

  const editorDetection = detections.find(d => d.id === editorDetectionId) ?? null;

  // In review the grid also draws the validated box, as a dashed green pseudo-object.
  const gradeByTimestamp = new Map(grade?.frames.map(f => [f.recordedAt, f]) ?? []);
  const gridFrames: AlertFrame[] = reviewing
    ? frameModel.frames.map((frame, i) => {
        const expected = alert.frames[i]?.expected;
        return {
          ...frame,
          cells: [
            ...frame.cells,
            {
              laneSequenceId: EXPECTED_LANE_ID,
              detectionId: frame.cells[0]?.detectionId ?? 0,
              cellState: 'auto',
              color: EXPECTED_COLOR,
              boxes: expected ? [{ xyxyn: expected, color: EXPECTED_COLOR }] : [],
            },
          ],
        };
      })
    : frameModel.frames;

  const frameNumber = (recordedAt: string) => frameTimestamps.indexOf(recordedAt) + 1;
  const isLast = alertIndex + 1 >= alertCount;

  return (
    <>
      <div className="fixed top-0 left-0 md:left-64 right-0 z-30 flex h-12 items-center gap-3 px-6 bg-paper/85 border-b border-line backdrop-blur-sm">
        <Link
          to={ROUTES.GUIDE_LOCALIZATION}
          className="font-body text-detail text-haze hover:text-char inline-flex shrink-0 items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Guide
        </Link>
        <span className="h-4 w-px shrink-0 bg-line" />
        <span className="shrink-0 font-data text-eyebrow font-medium uppercase tracking-eyebrow text-pine">
          Training · alert {alertIndex + 1} of {alertCount}
        </span>
        <h1 className="font-display text-heading font-semibold text-char truncate">
          {alert.organisation} · {alert.camera}
        </h1>
        <span className="hidden sm:inline font-data text-detail text-haze shrink-0">
          {formatDateTime(alert.recordedAt)}
        </span>
        <span
          className={`flex-none rounded-full px-2.5 py-0.5 font-data text-xs font-semibold ${
            localized ? 'bg-pine-soft text-pine' : 'bg-ember-soft text-ember'
          }`}
        >
          {localized ? 1 : 0} of 1 object localized
        </span>
        <AlertDots count={alertCount} current={alertIndex} grades={grades} />
      </div>

      <div className="flex flex-col gap-4 pt-8 lg:h-[calc(100vh-3rem)] lg:flex-row lg:overflow-hidden">
        <div className="lg:flex lg:min-h-0 lg:flex-[1.5] lg:min-w-0 lg:flex-col">
          <LocalizeActionPanel
            title={`Frames — ${object.label}`}
            color={object.color}
            actions={
              !reviewing && (
                <LocalizeObjectActions
                  label={object.label}
                  onAcceptBoxes={
                    acceptRemainingCount > 0 ? () => setAcceptPopoverOpen(open => !open) : undefined
                  }
                  acceptAnchorRef={acceptAnchorRef}
                  acceptPopover={
                    acceptPopoverOpen ? (
                      <AcceptRemainingPopover
                        objectLabel={object.label}
                        objectColor={object.color}
                        sequenceId={laneId}
                        previewBoxes={laneBoxes}
                        entries={acceptEntries}
                        acceptCount={acceptRemainingCount}
                        gapCount={acceptGapCount}
                        isAccepting={false}
                        onConfirm={() => {
                          acceptRemaining();
                          setAcceptPopoverOpen(false);
                        }}
                        onCancel={() => setAcceptPopoverOpen(false)}
                      />
                    ) : undefined
                  }
                />
              )
            }
            controls={
              <>
                <span className="font-data text-detail text-haze">
                  {frameModel.frames.length} frames
                </span>
                <div className="inline-flex items-center rounded-lg bg-ash p-0.5">
                  <button
                    type="button"
                    title="Cropped view — loop this object's crops across its frames"
                    aria-label="Cropped view"
                    aria-expanded={cropExpanded}
                    onClick={() => setCropExpanded(prev => !prev)}
                    className={`rounded p-1.5 transition-colors ${
                      cropExpanded ? 'bg-pine-soft text-pine' : 'text-haze hover:text-char'
                    }`}
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
                <ViewToolbar
                  cardSize={cardSize}
                  onCardSizeChange={setCardSize}
                  cropMode={cropMode}
                  onToggleCropMode={setCropMode}
                />
              </>
            }
          />

          {cropExpanded && (
            <div className="mb-4 shrink-0">
              <CroppedImageSequence
                bboxes={laneBoxes}
                sequenceId={laneId}
                accentColor={object.color}
                maxSize="min(420px, 40vh)"
                showBoxes
              />
            </div>
          )}

          <div
            data-testid="frame-grid-scroller"
            className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
          >
            <AlertFrameGrid
              frames={gridFrames}
              activeLaneId={laneId}
              onCellClick={(recordedAt, _laneId, detectionId) =>
                openEditor(recordedAt, detectionId)
              }
              cellRef={(recordedAt, el) => {
                frameRefs.current[recordedAt] = el;
              }}
              cardMinWidth={CARD_MIN_WIDTH[cardSize]}
              cropMode={cropMode}
              highlightedFrame={highlightedFrame}
              renderCellOverlay={
                reviewing
                  ? frame => {
                      const frameGrade = gradeByTimestamp.get(frame.recordedAt);
                      return frameGrade ? (
                        <FrameVerdict
                          number={frameNumber(frame.recordedAt)}
                          right={frameGrade.right}
                        />
                      ) : null;
                    }
                  : undefined
              }
            />
          </div>
        </div>

        <div className="lg:flex lg:min-h-0 lg:flex-1 lg:min-w-0 lg:flex-col lg:overflow-y-auto">
          <LocalizeRail
            legend={
              legendStatuses.length > 0 ? (
                <LocalizeTimelineLegend statuses={legendStatuses} />
              ) : undefined
            }
            missedSmoke={
              <LocalizeMissedSmokeRow
                hasMissedSmoke={missedSmoke}
                onChange={setMissedSmoke}
                disabled={reviewing}
              />
            }
            footer={
              reviewing ? (
                <AlertVerdict
                  grade={grade}
                  lesson={alert.lesson}
                  objectColor={object.color}
                  frameNumber={frameNumber}
                  onFrameClick={scrollToFrame}
                  nextLabel={isLast ? 'See my result' : 'Next alert'}
                  onNext={onNext}
                />
              ) : (
                <Tooltip
                  placement="above"
                  className="flex-1"
                  tip={
                    localized
                      ? 'Submit to see whether your boxes match the validated ones.'
                      : '1 object still has frames without a box. Accept or draw them to enable submit.'
                  }
                >
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!localized}
                    className={`flex w-full items-center justify-center rounded-lg bg-pine px-5 py-2.5 text-center font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50${
                      localized
                        ? ' animate-pine-glow focus-visible:animate-none motion-reduce:animate-none'
                        : ''
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                    Submit
                  </button>
                </Tooltip>
              )
            }
          >
            <LocalizeObjectRow
              label={object.label}
              color={object.color}
              confirmedCount={progress.confirmedCount}
              presentCount={progress.presentCount}
              frameTimestamps={frameTimestamps}
              statusByTimestamp={object.statusByTimestamp}
              onFrameClick={scrollToFrame}
              workable
              smokeType={object.smokeType}
              isActive
              onActivate={() => undefined}
            />
          </LocalizeRail>
        </div>
      </div>

      {editorDetection && !reviewing && (
        <LocalizeObjectEditor
          laneSequenceId={laneId}
          objectLabel={object.label}
          objectColor={object.color}
          smokeType={TRAINING_SMOKE_TYPE}
          detection={editorDetection}
          existingAnnotation={annotations[editorDetection.id] ?? null}
          laneDetections={detections}
          laneAnnotations={annotationList}
          alertFrames={frameModel.frames}
          objectOverlays={[]}
          isSaving={false}
          isAccepting={false}
          onCommit={commit}
          // Every training frame belongs to the object and carries a model box,
          // so there are no gap frames to materialize; clearing one just commits
          // "not visible here".
          onCommitGapFrame={() => undefined}
          onUnmaterialize={detection => commit(detection, [])}
          onAcceptRemaining={acceptRemaining}
          onNavigateToDetection={setEditorDetectionId}
          onClose={() => setEditorDetectionId(null)}
          takeOpenOriginRect={takeEditorOpenRect}
          frameCellRect={recordedAt =>
            frameRefs.current[recordedAt]?.getBoundingClientRect() ?? null
          }
        />
      )}

      <NotificationSystem
        showToast={showToast}
        toastMessage={toastMessage}
        toastType={toastType}
        onDismiss={dismissToast}
        // Clear the editor's own top bar while it is open, as on the localize page.
        belowTopBar={editorDetection !== null}
      />
    </>
  );
}

/** One dot per training alert: a tick or a cross once graded, a ring on the current one. */
function AlertDots({
  count,
  current,
  grades,
}: {
  count: number;
  current: number;
  grades: AlertGrade[];
}) {
  return (
    <ol className="ml-auto hidden md:flex items-center gap-1.5" aria-label="Training progress">
      {Array.from({ length: count }, (_, i) => {
        const grade = grades[i];
        return (
          <li
            key={i}
            aria-label={`Alert ${i + 1}: ${grade ? (grade.right ? 'right' : 'wrong') : i === current ? 'current' : 'to do'}`}
            className={`flex h-5 w-5 items-center justify-center rounded-full ${
              grade
                ? grade.right
                  ? 'bg-pine text-white'
                  : 'bg-signal text-white'
                : i === current
                  ? 'border-2 border-pine bg-paper'
                  : 'border border-line bg-paper'
            }`}
          >
            {grade &&
              (grade.right ? (
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
              ) : (
                <X className="h-3 w-3" strokeWidth={3} aria-hidden />
              ))}
          </li>
        );
      })}
    </ol>
  );
}

/** The tick or cross on a frame cell once the alert is graded. */
function FrameVerdict({ number, right }: { number: number; right: boolean }) {
  const Icon = right ? Check : X;
  return (
    <span
      data-testid={right ? 'frame-verdict-right' : 'frame-verdict-wrong'}
      className={`absolute left-1 top-1 z-10 inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 font-data text-[10px] font-semibold text-white pointer-events-none ${
        right ? 'bg-pine' : 'bg-signal'
      }`}
    >
      <span className="flex h-4 w-4 items-center justify-center">
        <Icon className="h-3 w-3" strokeWidth={3} aria-hidden />
      </span>
      {number}
      <span className="sr-only">{right ? 'right' : 'wrong'}</span>
    </span>
  );
}

function AlertVerdict({
  grade,
  lesson,
  objectColor,
  frameNumber,
  onFrameClick,
  nextLabel,
  onNext,
}: {
  grade: AlertGrade;
  lesson: string;
  objectColor: string;
  frameNumber: (recordedAt: string) => number;
  onFrameClick: (recordedAt: string) => void;
  nextLabel: string;
  onNext: () => void;
}) {
  const wrongFrames = grade.frames.filter(f => !f.right);
  return (
    <div role="status" data-testid="alert-verdict">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white animate-tick-pop motion-reduce:animate-none ${
            grade.right ? 'bg-pine' : 'bg-signal'
          }`}
        >
          {grade.right ? (
            <Check className="h-5 w-5" strokeWidth={3} aria-hidden />
          ) : (
            <X className="h-5 w-5" strokeWidth={3} aria-hidden />
          )}
        </span>
        <div>
          <p
            className={`font-body text-body font-semibold ${grade.right ? 'text-pine' : 'text-signal'}`}
          >
            {grade.right ? 'Right — every frame matches' : 'Not quite'}
          </p>
          <p className="font-data text-detail text-haze">
            {grade.frames.length - grade.wrongFrameCount} of {grade.frames.length} frames right
          </p>
        </div>
      </div>

      {(wrongFrames.length > 0 || grade.missedSmokeWrong) && (
        <ul className="mt-3 space-y-1.5">
          {wrongFrames.map(f => (
            <li key={f.recordedAt}>
              <button
                type="button"
                onClick={() => onFrameClick(f.recordedAt)}
                className="w-full rounded-lg bg-signal-soft px-3 py-1.5 text-left font-body text-detail text-signal hover:brightness-95"
              >
                <span className="font-data font-semibold">Frame {frameNumber(f.recordedAt)}</span>
                {' · '}
                {f.mistake ? MISTAKE_TEXT[f.mistake] : ''}
              </button>
            </li>
          ))}
          {grade.missedSmokeWrong && (
            <li className="rounded-lg bg-signal-soft px-3 py-1.5 font-body text-detail text-signal">
              <span className="font-semibold">Missed smoke</span>
              {' · '}
              There is no other smoke on this alert — the answer was No.
            </li>
          )}
        </ul>
      )}

      <p className="mt-3 font-body text-detail leading-relaxed text-char">{lesson}</p>

      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-detail text-haze">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-3.5 rounded-[2px] border-2"
            style={{ borderColor: objectColor }}
          />
          Your box
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-3.5 rounded-[2px] border-2 border-dashed"
            style={{ borderColor: EXPECTED_COLOR }}
          />
          Expected box
        </span>
      </p>

      <button
        type="button"
        onClick={onNext}
        autoFocus
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-pine px-5 py-2.5 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
      >
        {nextLabel}
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function TrainingSummary({
  alerts,
  grades,
  onRestart,
}: {
  alerts: TrainingAlert[];
  grades: AlertGrade[];
  onRestart: () => void;
}) {
  const { canLocalize } = useAuthStore();
  const markCompleted = useMarkModuleCompleted(ROUTES.GUIDE_LOCALIZATION);
  const scoreRef = useRef<HTMLDivElement>(null);
  const rightCount = grades.filter(g => g.right).length;
  const passed = rightCount >= TRAINING_PASS_MARK;

  // Passing finishes the module: the guide hub ticks it.
  useEffect(() => {
    if (!passed) return;
    celebrate(scoreRef.current);
    markCompleted();
    // Once per pass, not on every new `markCompleted` identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passed]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={ROUTES.GUIDE_LOCALIZATION}
        className="font-body text-detail text-haze hover:text-char"
      >
        ← Back to the localization guide
      </Link>
      <p className="mt-4 font-data text-eyebrow font-medium uppercase tracking-eyebrow text-pine">
        Localization training
      </p>
      <h1 className="mt-1 font-display text-title font-semibold tracking-tight text-char">
        Your result
      </h1>

      <div ref={scoreRef} className="my-6 text-center">
        <p className="font-data text-[38px] font-semibold leading-none text-char">
          {rightCount}
          <span className="text-haze"> / {alerts.length}</span>
        </p>
        <p className="mt-1 font-body text-detail text-haze">
          alerts right · {TRAINING_PASS_MARK} needed to pass
        </p>
      </div>

      <ul className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {alerts.map((alert, i) => {
          const grade = grades[i];
          return (
            <li key={alert.key} className="relative">
              <img
                src={alert.frames[0].src}
                alt={`${alert.camera}, first frame`}
                className="block aspect-video w-full rounded-lg border border-line object-cover"
              />
              {grade && (
                <span
                  data-testid={grade.right ? 'alert-result-right' : 'alert-result-wrong'}
                  className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-white ring-2 ring-paper ${
                    grade.right ? 'bg-pine' : 'bg-signal'
                  }`}
                >
                  {grade.right ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                  ) : (
                    <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                  )}
                  <span className="sr-only">{grade.right ? 'right' : 'wrong'}</span>
                </span>
              )}
              <p className="mt-1 truncate font-body text-detail text-char">{alert.camera}</p>
              {grade && (
                <p className="font-data text-eyebrow text-haze">
                  {grade.frames.length - grade.wrongFrameCount} / {grade.frames.length} frames
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {passed ? (
        <TrainingDone message="Passed — you're ready to localize!">
          {canLocalize() ? (
            <StartAnnotating
              message="Go start localizing!"
              label="Start localizing"
              to={ROUTES.LOCALIZE}
              tone="pine"
            />
          ) : (
            <StartAnnotating
              message="Localizing isn't enabled on your account yet — classify in the meantime."
              label="Start classifying"
              to={ROUTES.CLASSIFY}
              tone="ember"
            />
          )}
        </TrainingDone>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-signal-soft px-4 py-3">
          <span className="font-body text-body font-semibold text-signal">
            Not yet — you need {TRAINING_PASS_MARK} alerts right out of {alerts.length}. Have
            another go.
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
    </div>
  );
}
