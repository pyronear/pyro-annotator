import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, RotateCcw, X, ZoomOut } from 'lucide-react';
import { useBoxDrawingStage, type Xyxyn } from '@/hooks/annotation';
import { DrawingOverlay, ObjectIdentityOverlay } from '@/components/annotation/ImageOverlays';
import { SOURCE_COLOR, SOURCE_WEIGHT } from '@/components/localize/editor/sourceIdentity';
import { TrainingDone } from '@/components/guide/ReadConfirmation';
import { celebrate } from '@/components/guide/celebrate';
import {
  LOCALIZATION_EXERCISES,
  PASS_MARK,
  type LocalizationExercise as Exercise,
} from '@/components/guide/localizationExercises';
import { MATCH_IOU, boxIoU, boxMismatch, type BoxMismatch } from '@/utils/annotation/boxOverlap';
import { stageTransform } from '@/utils/annotation';
import type { SmokeType } from '@/types/api';

/** The drawn box: magenta, as a manual box is in the localize editor. */
const DRAWN_COLOR = SOURCE_COLOR.manual;
/** The expected box, revealed after checking: cyan, distinct from the drawn one. */
const REFERENCE_COLOR = '#00D5FF';
const WILDFIRE = 'wildfire' as SmokeType;

const MISMATCH_HINT: Record<BoxMismatch, string> = {
  missed: 'Your box misses the smoke.',
  'too-loose': 'Your box is too loose — keep it tight around the plume.',
  'too-tight': 'Your box is too tight — include the whole plume, from base to top.',
  'off-centre': 'Your box is off to one side — centre it on the plume.',
};

interface ExerciseResult {
  drawn: Xyxyn;
  iou: number;
  matched: boolean;
}

const percent = (iou: number) => `${Math.round(iou * 100)}%`;

/**
 * The localization training: five frames whose box is known, drawn on the
 * same surface as the localize editor (drag to draw, scroll to zoom, space to
 * pan, drag the box or a corner to adjust). Each check reveals the expected
 * box next to the drawn one and marks the image with a tick or a cross; a
 * box matches when it overlaps the expected one by at least `MATCH_IOU`.
 *
 * `PASS_MARK` matches out of five passes: confetti, then `afterPass`. Fewer
 * offers a fresh attempt. `onPass` fires on the pass (the page records the
 * module as done there, for the tick on the guide hub).
 */
export default function LocalizationExercise({
  afterPass,
  onPass,
  exercises = LOCALIZATION_EXERCISES,
}: {
  afterPass: React.ReactNode;
  /** Called once the exercise is passed: records the module as done. */
  onPass?: () => void;
  exercises?: Exercise[];
}) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<ExerciseResult[]>([]);
  const [box, setBox] = useState<Xyxyn | null>(null);
  const [boxSelected, setBoxSelected] = useState(false);

  const finished = index >= exercises.length;
  const exercise = exercises[Math.min(index, exercises.length - 1)];
  const result: ExerciseResult | undefined = results[index];
  const answered = result !== undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleDrawn = useCallback((xyxyn: Xyxyn) => {
    setBox(xyxyn);
    // Selected straight away, so the corners are there to refine it.
    setBoxSelected(true);
  }, []);

  const stage = useBoxDrawingStage({
    containerRef,
    imgRef,
    editableBox: answered ? null : box,
    boxSelected: !answered && boxSelected,
    onBoxSelectedChange: setBoxSelected,
    onDrawn: handleDrawn,
    canDraw: !answered,
    imageKey: index,
  });

  const check = () => {
    if (!box || answered) return;
    const iou = boxIoU(box, exercise.reference);
    setResults(prev => [...prev, { drawn: box, iou, matched: iou >= MATCH_IOU }]);
    setBoxSelected(false);
  };

  const next = () => {
    setIndex(i => i + 1);
    setBox(null);
    setBoxSelected(false);
    stage.resetZoom();
    stage.resetTransient();
  };

  const restart = () => {
    setResults([]);
    setIndex(0);
    setBox(null);
    setBoxSelected(false);
    stage.resetZoom();
    stage.resetTransient();
  };

  const matches = results.filter(r => r.matched).length;
  const passed = finished && matches >= PASS_MARK;

  if (finished) {
    return (
      <ExerciseSummary
        exercises={exercises}
        results={results}
        passed={passed}
        afterPass={afterPass}
        onPass={onPass}
        onRestart={restart}
      />
    );
  }

  const transform = stageTransform({ scale: stage.zoomLevel, pan: stage.panOffset });
  const shownBox = answered ? result.drawn : (stage.boxEdit?.next ?? box);

  return (
    <section aria-label="Localization exercise">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-pine">
          Image {index + 1} of {exercises.length}
        </span>
        <ProgressDots total={exercises.length} current={index} results={results} />
      </div>

      {/*
        MUST centre its content and let the inner container hug the image:
        the stage's coordinate maths assumes an object-contain image centred
        in its container — same classes as the localize editor's stage.
      */}
      <div className="relative flex items-center justify-center overflow-hidden rounded-card border border-line bg-ash p-3">
        <div
          ref={containerRef}
          data-testid="exercise-stage"
          className="relative overflow-hidden"
          onMouseDown={stage.handleMouseDown}
          onMouseMove={stage.handleMouseMove}
          onMouseUp={stage.handleMouseUp}
          onMouseLeave={stage.handleMouseUp}
          style={{ cursor: stage.getCursorStyle() }}
        >
          <img
            ref={imgRef}
            src={exercise.src}
            alt={`Training image ${index + 1}`}
            draggable={false}
            onLoad={stage.handleImageLoad}
            className="block max-h-[70vh] max-w-full select-none object-contain"
            style={{
              transform,
              transition: stage.isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
          />
          {answered && stage.imageInfo && (
            <div
              className="pointer-events-none absolute inset-0 z-10"
              data-testid="reference-box"
              style={{ transform }}
            >
              <ObjectIdentityOverlay
                objects={[
                  {
                    color: REFERENCE_COLOR,
                    label: 'Expected',
                    boxes: [{ xyxyn: exercise.reference }],
                  },
                ]}
                imageInfo={stage.imageInfo}
                strokeScale={stage.zoomLevel}
              />
            </div>
          )}
          {stage.imageInfo && (
            <div className="absolute inset-0 z-20">
              <DrawingOverlay
                drawnRectangles={
                  shownBox ? [{ id: 'drawn', xyxyn: shownBox, smokeType: WILDFIRE }] : []
                }
                currentDrawing={stage.currentDrawing}
                selectedRectangleId={!answered && boxSelected ? 'drawn' : null}
                imageInfo={stage.imageInfo}
                zoomLevel={stage.zoomLevel}
                panOffset={stage.panOffset}
                isDragging={stage.isDragging}
                normalizedToImage={stage.normalizedToImage}
                boxColor={DRAWN_COLOR}
                boxWidth={SOURCE_WEIGHT.manual}
                strokeScale={stage.zoomLevel}
                onBoxPointerDown={answered ? undefined : (_id, e) => stage.handleBoxPointerDown(e)}
                onHandlePointerDown={
                  answered || stage.currentDrawing
                    ? undefined
                    : (_id, handle, e) => stage.handleHandlePointerDown(handle, e)
                }
              />
            </div>
          )}
        </div>

        {answered && <VerdictBadge matched={result.matched} />}

        {stage.zoomLevel > 1 && (
          <button
            type="button"
            onClick={stage.resetZoom}
            className="absolute right-5 top-5 z-40 inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1 font-body text-xs font-medium text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char"
          >
            <ZoomOut className="h-3.5 w-3.5" />
            Reset zoom
          </button>
        )}
      </div>

      {answered ? (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1" role="status">
            <p
              className={`font-body text-body font-semibold ${result.matched ? 'text-pine' : 'text-signal'}`}
            >
              {result.matched ? 'Match' : 'Not quite'}
              <span className="font-data font-medium"> · {percent(result.iou)} overlap</span>
            </p>
            {!result.matched && (
              <p className="mt-0.5 font-body text-detail text-char">
                {MISMATCH_HINT[boxMismatch(result.drawn, exercise.reference)]}
              </p>
            )}
            <p className="mt-1 font-body text-detail text-haze">{exercise.note}</p>
            <Legend />
          </div>
          <button
            type="button"
            onClick={next}
            autoFocus
            className="inline-flex items-center gap-1.5 rounded-lg bg-pine px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
          >
            {index + 1 < exercises.length ? 'Next image' : 'See my result'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p className="min-w-0 flex-1 font-body text-detail text-haze">
            Drag around the smoke to draw a tight box. Scroll to zoom, hold space and drag to pan.
            Drag the box or its corners to adjust it.
          </p>
          <button
            type="button"
            onClick={check}
            disabled={!box}
            className="inline-flex items-center rounded-lg bg-pine px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
          >
            Check my box
          </button>
        </div>
      )}
    </section>
  );
}

function ProgressDots({
  total,
  current,
  results,
}: {
  total: number;
  current: number;
  results: ExerciseResult[];
}) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {Array.from({ length: total }, (_, i) => {
        const r = results[i];
        const label = r
          ? `Image ${i + 1}: ${r.matched ? 'match' : 'miss'}`
          : `Image ${i + 1}: ${i === current ? 'current' : 'to do'}`;
        return (
          <li
            key={i}
            aria-label={label}
            className={`flex h-5 w-5 items-center justify-center rounded-full ${
              r
                ? r.matched
                  ? 'bg-pine text-white'
                  : 'bg-signal text-white'
                : i === current
                  ? 'border-2 border-pine bg-paper'
                  : 'border border-line bg-paper'
            }`}
          >
            {r &&
              (r.matched ? (
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

/** The big tick or cross over the corner of the stage once a box is checked. */
function VerdictBadge({ matched, small = false }: { matched: boolean; small?: boolean }) {
  const Icon = matched ? Check : X;
  return (
    <span
      data-testid={matched ? 'verdict-tick' : 'verdict-cross'}
      aria-label={matched ? 'Match' : 'Not a match'}
      role="img"
      className={`absolute z-40 flex items-center justify-center rounded-full text-white ring-2 ring-paper animate-tick-pop motion-reduce:animate-none ${
        matched ? 'bg-pine' : 'bg-signal'
      } ${small ? 'right-1.5 top-1.5 h-6 w-6' : 'left-5 top-5 h-11 w-11'}`}
    >
      <Icon className={small ? 'h-3.5 w-3.5' : 'h-6 w-6'} strokeWidth={3} aria-hidden />
    </span>
  );
}

function Legend() {
  const swatch = (color: string) => (
    <span
      aria-hidden
      className="inline-block h-2.5 w-3.5 rounded-[2px] border-2"
      style={{ borderColor: color }}
    />
  );
  return (
    <p className="mt-2 flex items-center gap-4 font-body text-detail text-haze">
      <span className="inline-flex items-center gap-1.5">{swatch(DRAWN_COLOR)} Your box</span>
      <span className="inline-flex items-center gap-1.5">
        {swatch(REFERENCE_COLOR)} Expected box
      </span>
    </p>
  );
}

function ExerciseSummary({
  exercises,
  results,
  passed,
  afterPass,
  onPass,
  onRestart,
}: {
  exercises: Exercise[];
  results: ExerciseResult[];
  passed: boolean;
  afterPass: React.ReactNode;
  onPass?: () => void;
  onRestart: () => void;
}) {
  const scoreRef = useRef<HTMLDivElement>(null);
  const matches = results.filter(r => r.matched).length;

  useEffect(() => {
    if (!passed) return;
    celebrate(scoreRef.current);
    onPass?.();
    // Once per pass, not on every new `onPass` identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passed]);

  return (
    <section aria-label="Localization exercise result">
      <div ref={scoreRef} className="mb-6 text-center">
        <p className="font-data text-[38px] font-semibold leading-none text-char">
          {matches}
          <span className="text-haze"> / {exercises.length}</span>
        </p>
        <p className="mt-1 font-body text-detail text-haze">
          boxes matched · {PASS_MARK} needed to pass
        </p>
      </div>

      <ul className="mb-8 grid grid-cols-5 gap-2">
        {exercises.map((exercise, i) => {
          const r = results[i];
          return (
            <li key={exercise.src} className="relative">
              <img
                src={exercise.src}
                alt={`Training image ${i + 1}`}
                className="block aspect-video w-full rounded-lg border border-line object-cover"
              />
              {r && <VerdictBadge matched={r.matched} small />}
              {r && (
                <span className="mt-1 block text-center font-data text-eyebrow text-haze">
                  {percent(r.iou)}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {passed ? (
        <TrainingDone message="Passed — you're ready to localize!">{afterPass}</TrainingDone>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-signal-soft px-4 py-3">
          <span className="font-body text-body font-semibold text-signal">
            Not yet — you need {PASS_MARK} matching boxes out of {exercises.length}. Have another
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
