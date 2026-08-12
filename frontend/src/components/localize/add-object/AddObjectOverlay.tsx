/**
 * Adding an object the detector missed, on one screen in three steps: choose
 * the frames, draw the box, create the object.
 *
 * The step prompt attaches to whichever region is actually actionable — the
 * strip while the range is chosen, the stage while the box is drawn — because
 * those sit at opposite edges and a caption floating over the image cannot say
 * "act down there". The highlight moving IS the instruction about where to
 * look. Create lives in the prompt too: at step 3 it is the thing the sentence
 * beside it is telling you to press.
 *
 * Step 1 sets the RANGE: click the first frame the object appears on, then
 * the last. The stage above shows whichever frame you are pointing at, full
 * size and carrying the other objects' boxes — so it answers both "has the
 * plume started yet?" and "is that already someone else's object?". The stage
 * being the large preview is why there is no hover popover: the rail's own
 * hover preview was removed for occluding exactly the neighbouring frames a
 * boundary decision compares against.
 *
 * Step 2 draws ONE box, on the first frame of the range, and every other
 * frame in the range gets a copy. That is deliberately a first draft: smoke
 * grows and drifts, so the copy is too small at the end of a long range, and
 * refining frame by frame in the object editor is the second half of the job.
 * Interpolating between a box on each end was designed and deferred — see the
 * spec — and would touch only `objectRangeBoxes` and this phase, since
 * everything downstream already takes an explicit per-frame box list.
 *
 * Stepping to any other in-range frame shows the copy so it can be checked
 * before creating, but only the first frame is drawable.
 *
 * The top bar carries identity and what applies throughout — smoke type, and
 * restarting the range. The strip at the bottom is purely the frames.
 *
 * Nothing autosaves. The object does not exist until Create, which is the
 * whole reason this is a separate surface from the editor rather than a mode
 * of it — there is no lane to write to yet.
 *
 * See docs/specs/2026-08-11-localize-add-object-design.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RotateCcw, X } from 'lucide-react';
import type { Detection, SmokeType } from '@/types/api';
import type { AlertFrame } from '@/utils/annotation/alertLocalizeUtils';
import {
  buildRangeStripEntries,
  type RangeStripEntry,
} from '@/utils/annotation/objectRangeStripEntries';
import { fillRangeBoxes, type RangeBox } from '@/utils/annotation/objectRangeBoxes';
import { useBoxDrawingStage, type Xyxyn } from '@/hooks/annotation';
import { DetectionAnnotationCanvas } from '@/components/detection-annotation';
import type { ObjectOverlayItem } from '@/components/annotation/ImageOverlays';
import { formatDateTime } from '@/utils/datetime';
import { ObjectRangeStrip } from './ObjectRangeStrip';

const SMOKE_TYPES: SmokeType[] = ['wildfire', 'industrial', 'other'] as SmokeType[];

export interface AddObjectOverlayProps {
  /** Every frame of the alert — the range to choose from. */
  alertFrames: AlertFrame[];
  /** Detections by id, for the stage's image. Any lane's will do per frame. */
  detectionsById: Map<number, Detection>;
  /** The colour and label the new object will take, from `getObjectColor`. */
  objectColor: string;
  objectLabel: string;
  /** The other objects' boxes per frame, so you can tell whose plume it is. */
  objectOverlaysByRecordedAt: Record<string, ObjectOverlayItem[]>;
  isCreating: boolean;
  /** Every in-range frame with the box it will be created with. */
  onCreate: (frames: RangeBox[], smokeType: SmokeType) => void;
  onClose: () => void;
}

export function AddObjectOverlay({
  alertFrames,
  detectionsById,
  objectColor,
  objectLabel,
  objectOverlaysByRecordedAt,
  isCreating,
  onCreate,
  onClose,
}: AddObjectOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [phase, setPhase] = useState<'range' | 'draw'>('range');
  const [pendingFirst, setPendingFirst] = useState<string | null>(null);
  const [range, setRange] = useState<{ firstRecordedAt: string; lastRecordedAt: string } | null>(
    null
  );
  // One box, drawn on the first frame of the range and copied to the rest.
  const [box, setBox] = useState<Xyxyn | null>(null);
  const [currentRecordedAt, setCurrentRecordedAt] = useState(alertFrames[0]?.recordedAt ?? '');
  const [smokeType, setSmokeType] = useState<SmokeType>('wildfire' as SmokeType);
  const [boxSelected, setBoxSelected] = useState(false);

  // On the deep-link path (`/localize/:id/add-object` reloaded or pasted) this
  // mounts as soon as the alert resolves, while the per-lane detection queries
  // — which `alertFrames` is derived from — are still in flight. The state
  // initializer runs once against an empty list, so without this the stage
  // would stay blank until the annotator happened to hover a thumbnail.
  useEffect(() => {
    if (currentRecordedAt === '' && alertFrames.length > 0) {
      setCurrentRecordedAt(alertFrames[0].recordedAt);
    }
  }, [alertFrames, currentRecordedAt]);

  const entries = useMemo(
    () => buildRangeStripEntries(alertFrames, range, box),
    [alertFrames, range, box]
  );

  // The one frame that accepts a box. Every other in-range frame shows the
  // copy so it can be checked, but is not itself drawable — there is only one
  // box, and it belongs to the start of the range.
  const isDrawFrame =
    phase === 'draw' && range != null && currentRecordedAt === range.firstRecordedAt;

  const stageBox: Xyxyn | null =
    entries.find(e => e.recordedAt === currentRecordedAt)?.xyxyn ?? null;

  const handleDrawn = useCallback(
    (xyxyn: Xyxyn) => {
      if (phase !== 'draw' || range == null || currentRecordedAt !== range.firstRecordedAt) return;
      setBox(xyxyn);
    },
    [phase, range, currentRecordedAt]
  );

  const stage = useBoxDrawingStage({
    containerRef,
    imgRef,
    editableBox: isDrawFrame ? stageBox : null,
    boxSelected,
    onBoxSelectedChange: setBoxSelected,
    onDrawn: handleDrawn,
    // Only the first frame of a settled range takes a box. While the range is
    // still being chosen, and on every other frame afterwards, the stage is a
    // picture to look at — so it must not offer a drawing gesture it will
    // refuse.
    canDraw: isDrawFrame,
    // The stage swaps image as you step or hover frames, so the resize
    // observer has to re-attach to whatever <img> is on screen now.
    imageKey: currentRecordedAt,
  });
  const { resetTransient } = stage;

  // Changing frame drops the half-finished interaction, exactly as stepping
  // frames does in the editor.
  useEffect(() => {
    resetTransient();
    setBoxSelected(false);
  }, [currentRecordedAt, resetTransient]);

  const handleSelectFrame = (entry: RangeStripEntry) => {
    setCurrentRecordedAt(entry.recordedAt);
    if (phase !== 'range') return;
    if (pendingFirst === null) {
      setPendingFirst(entry.recordedAt);
      // Shown as a one-frame range straight away, so the click visibly landed.
      setRange({ firstRecordedAt: entry.recordedAt, lastRecordedAt: entry.recordedAt });
      return;
    }
    // Sorted, so dragging the selection backwards still reads first-to-last.
    const [first, last] = [pendingFirst, entry.recordedAt].sort();
    setRange({ firstRecordedAt: first, lastRecordedAt: last });
    setPendingFirst(null);
    setPhase('draw');
    setCurrentRecordedAt(first);
  };

  // Start the range over, from either phase. Choosing a range is a two-click
  // gesture with no natural undo — a mis-click on the first frame otherwise
  // strands you until the second click — so this is always available once
  // anything is selected. It drops the box too: it belongs to the start of a
  // range that is about to change.
  const restartRange = () => {
    setPhase('range');
    setPendingFirst(null);
    setRange(null);
    setBox(null);
  };

  const hasSelection = range !== null || pendingFirst !== null;

  const step = useCallback(
    (direction: -1 | 1) => {
      const index = alertFrames.findIndex(f => f.recordedAt === currentRecordedAt);
      const next = alertFrames[index + direction];
      if (next) setCurrentRecordedAt(next.recordedAt);
    },
    [alertFrames, currentRecordedAt]
  );

  const submit = () => {
    if (!range || box === null) return;
    const stamps = entries.filter(e => e.inRange).map(e => e.recordedAt);
    onCreate(fillRangeBoxes(stamps, box), smokeType);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft') {
        step(-1);
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowRight') {
        step(1);
        e.preventDefault();
        return;
      }
      // Enter sets a boundary while choosing the range; it never creates the
      // object, which is a deliberate press of its own button.
      if (e.key === 'Enter' && phase === 'range') {
        // Never steal Enter from a focused control — the same carve-out the
        // page's own handler uses. Without it, a keyboard user who tabs to a
        // smoke-type chip, Restart range or Close and presses Enter commits a
        // range anchor instead of activating the button, which puts those
        // controls out of keyboard reach entirely during step 1.
        const target = e.target;
        if (target instanceof HTMLElement && target.closest('button, a, [role="button"]')) return;
        const entry = entries.find(en => en.recordedAt === currentRecordedAt);
        if (entry) handleSelectFrame(entry);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const currentEntry = entries.find(e => e.recordedAt === currentRecordedAt);
  const shownDetection = currentEntry ? detectionsById.get(currentEntry.detectionId) : undefined;

  // Three steps, because creating is a step: the object does not exist until
  // the button is pressed, and stopping the count at "draw the box" left the
  // flow looking finished one action early.
  const stepNumber: 1 | 2 | 3 = phase === 'range' ? 1 : box === null ? 2 : 3;

  const instruction =
    stepNumber === 1
      ? pendingFirst === null
        ? 'In the filmstrip below, click the first frame this object appears on'
        : 'Now click the last frame it appears on'
      : stepNumber === 2
        ? 'Drag a box around the object — every frame in the range gets a copy'
        : 'Box copied across the range — check the type, then create the object';

  const hint =
    stepNumber === 1
      ? 'Hover to preview · click to pick · ← → and Enter also work'
      : stepNumber === 2
        ? '← → step through the range'
        : isDrawFrame
          ? 'Drag to redraw · ← → check the range'
          : '← → back to the first frame to redraw';

  /**
   * The prompt renders attached to whichever region is actually actionable —
   * the strip while the range is being chosen, the stage while the box is
   * being drawn — because the two are at opposite edges of the screen and a
   * caption floating over the image cannot say "act down there". Pine banner,
   * step counter, and the same treatment either side, so the highlight moving
   * IS the instruction about where to look.
   */
  const prompt = (
    <div
      data-testid="add-object-instruction"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y-2 border-pine bg-pine-soft px-4 py-2"
    >
      <span className="whitespace-nowrap rounded-full bg-pine px-2 py-0.5 font-data text-eyebrow font-semibold uppercase tracking-eyebrow text-white">
        Step {stepNumber} of 3
      </span>
      <span className="flex items-center gap-1.5 font-body text-sm font-medium text-pine">
        {instruction}
        {/* Points at the strip directly beneath. Words alone kept leaving
            people looking at the photograph, which is the biggest thing on
            screen and the one part of step 1 that is NOT clickable. */}
        {stepNumber === 1 && (
          <ChevronDown
            aria-hidden
            className="h-4 w-4 shrink-0 animate-bounce motion-reduce:animate-none"
          />
        )}
      </span>

      {/* The smoke type sits in the ribbon rather than the top bar because it
          is a decision this flow has to make, not chrome — and it is wanted at
          the same moment as Create, so the two remaining choices are side by
          side under the sentence naming them. Present at every step (it can be
          set whenever you notice) so nothing shifts position as the step
          changes. */}
      <span
        role="radiogroup"
        aria-label="Smoke type"
        className="inline-flex items-center rounded-lg bg-paper p-0.5"
      >
        {SMOKE_TYPES.map(type => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={smokeType === type}
            onClick={() => setSmokeType(type)}
            className={`rounded-md px-2.5 py-1 font-body text-xs capitalize transition-colors ${
              smokeType === type ? 'bg-pine font-medium text-white' : 'text-haze hover:text-char'
            }`}
          >
            {type}
          </button>
        ))}
      </span>

      {/* The button lives IN the prompt rather than in the top bar: at step 3
          it is the thing the prompt is telling you to press, and a control
          named by the sentence beside it needs no hunting. It sits directly
          after that sentence rather than at the far edge, because that is
          where the eye already is once it has finished reading — a CTA pinned
          right needs finding. Rendered at every step, disabled until there is
          a box, so the goal is visible from the start and the control never
          moves. */}
      <button
        type="button"
        onClick={submit}
        disabled={box === null || isCreating}
        data-testid="create-object"
        // Stable accessible name: the visible label becomes "Creating…"
        // mid-flight, and a control should not change identity while it is
        // working.
        aria-label="Create object"
        className={`inline-flex items-center whitespace-nowrap rounded-lg bg-pine px-3 py-1 font-body text-xs font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40${
          box !== null && !isCreating ? ' animate-pine-glow motion-reduce:animate-none' : ''
        }`}
      >
        {isCreating ? 'Creating…' : 'Create object'}
      </button>
      {/* Ancillary, so it takes the far edge the button gave up. */}
      <span
        data-testid="add-object-hint"
        className="ml-auto whitespace-nowrap font-body text-detail text-pine/70"
      >
        {hint}
      </span>
    </div>
  );

  return (
    <div
      // Same surfaces as the object editor (bg-ash ground, bg-paper chrome,
      // border-line): this is the same job on the same alert, so it should not
      // look like a different application.
      className="fixed inset-0 z-50 flex flex-col bg-ash"
      role="dialog"
      aria-modal="true"
      aria-label="Add object"
      data-testid="add-object-overlay"
    >
      {/* Identity and the ways out: restart the range, or close. The decisions
          the flow actually makes — the smoke type and creating — live in the
          step ribbon, beside the sentence that names them. */}
      <div className="relative z-40 flex h-12 flex-none items-center gap-3 border-b border-line bg-paper px-4">
        <span className="font-body text-sm font-semibold text-char">{objectLabel}</span>
        <span className="font-data text-detail text-haze">
          {range
            ? `${entries.filter(e => e.inRange).length} frames`
            : 'choose the frames it appears on'}
        </span>
        {currentEntry && (
          <span className="font-data text-detail text-haze">
            {formatDateTime(currentEntry.recordedAt, { seconds: true })}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {hasSelection && (
            <button
              type="button"
              onClick={restartRange}
              data-testid="restart-range"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1 font-body text-xs font-medium text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restart range
            </button>
          )}

          <span aria-hidden className="mx-0.5 h-5 w-px self-center bg-line" />

          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg border border-line bg-paper p-1.5 text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/*
        MUST centre its content, and must hug the image. `calculateImageBounds`
        works out where an object-contain image sits by assuming it is CENTRED
        in its container (x = (containerWidth - width) / 2), and the canvas root
        shrink-wraps the <img>. Drop the centring and the container stretches to
        the full panel width while the image stays left-aligned, so every
        screen-to-image conversion is off by half the leftover width and drawn
        boxes land away from the cursor. Same classes as the editor's stage, for
        exactly that reason.
      */}
      <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-ash p-3">
        {shownDetection && (
          <DetectionAnnotationCanvas
            detection={shownDetection}
            // Every in-range frame shows the box, so the copy can be checked
            // before creating; only the first frame's is editable.
            committed={stageBox ? { source: 'manual', index: 0, xyxyn: stageBox } : null}
            ghosts={[]}
            showGhosts={false}
            selected={isDrawFrame && boxSelected}
            selectedSmokeType={smokeType}
            objectOverlays={objectOverlaysByRecordedAt[currentRecordedAt] ?? []}
            isDrawMode={stage.currentDrawing !== null}
            onBoxPointerDown={stage.handleBoxPointerDown}
            onHandlePointerDown={stage.handleHandlePointerDown}
            currentDrawing={stage.currentDrawing}
            containerRef={containerRef}
            imgRef={imgRef}
            imageInfo={stage.imageInfo}
            zoomLevel={stage.zoomLevel}
            panOffset={stage.panOffset}
            isDragging={stage.isDragging}
            onMouseDown={stage.handleMouseDown}
            onMouseMove={stage.handleMouseMove}
            onMouseUp={stage.handleMouseUp}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            getCursorStyle={stage.getCursorStyle}
            handleImageLoad={stage.handleImageLoad}
            normalizedToImage={stage.normalizedToImage}
            overlaysVisible
          />
        )}
        {/* Drawing happens here, so in phase 2 the prompt sits on the stage —
            floated rather than stacked, so the photo never resizes as the
            wording changes. In phase 1 it lives above the strip instead. */}
        {phase === 'draw' && <div className="absolute inset-x-0 bottom-0">{prompt}</div>}
      </div>

      {/* Frames only — every control moved to the bar above. While the range
          is being chosen this is the region that acts, so the prompt attaches
          to its top edge and the thumbnails sit on pine-soft: the eye is
          pulled to the thing it has to click, rather than to the picture. */}
      <div
        data-testid="add-object-strip"
        data-selecting={phase === 'range' ? 'true' : undefined}
        // Ringed, not merely tinted, while it is the thing to act on: a tint
        // reads as decoration, a ring reads as a target.
        className={`flex-none border-t border-line ${
          phase === 'range' ? 'bg-pine-soft ring-2 ring-inset ring-pine' : 'bg-paper'
        }`}
      >
        {phase === 'range' && prompt}
        <ObjectRangeStrip
          entries={entries}
          currentRecordedAt={currentRecordedAt}
          objectColor={objectColor}
          onSelect={handleSelectFrame}
          selecting={phase === 'range'}
          // Only while choosing the range. There a click commits an anchor, so
          // hovering is the only way to scan for where the plume starts
          // without picking a frame by accident; once drawing begins the stage
          // must stay on the frame being drawn.
          onHoverPreview={
            phase === 'range' ? entry => setCurrentRecordedAt(entry.recordedAt) : undefined
          }
        />
      </div>
    </div>
  );
}
