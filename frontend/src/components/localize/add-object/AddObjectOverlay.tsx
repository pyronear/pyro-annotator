/**
 * Adding an object the detector missed, on one screen in two phases.
 *
 * Phase 1 sets the RANGE: click the first frame the object appears on, then
 * the last. The stage above shows whichever frame you are pointing at, full
 * size and carrying the other objects' boxes — so it answers both "has the
 * plume started yet?" and "is that already someone else's object?". The stage
 * being the large preview is why there is no hover popover: the rail's own
 * hover preview was removed for occluding exactly the neighbouring frames a
 * boundary decision compares against.
 *
 * Phase 2 draws ONE box, on the first frame of the range, and every other
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
 * Every control lives in the top bar — smoke type, restart range, create — so
 * one task is not spread across two edges of the screen. The strip at the
 * bottom is purely the frames.
 *
 * Nothing autosaves. The object does not exist until Create, which is the
 * whole reason this is a separate surface from the editor rather than a mode
 * of it — there is no lane to write to yet.
 *
 * See docs/specs/2026-08-11-localize-add-object-design.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
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

  const instruction =
    phase === 'range'
      ? pendingFirst === null
        ? 'Click the first frame this object appears on'
        : 'Now click the last frame'
      : isDrawFrame
        ? box === null
          ? 'Drag a box around the object — every frame in the range gets a copy'
          : 'Drag to redraw the box'
        : 'A copy of the box on the first frame — refine each frame after creating';

  const hint =
    phase === 'range'
      ? '← → preview a frame · Enter picks it'
      : isDrawFrame
        ? '← → step through the range'
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
      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-y-2 border-pine bg-pine-soft px-4 py-2.5"
    >
      <span className="whitespace-nowrap rounded-full bg-pine px-2 py-0.5 font-data text-eyebrow font-semibold uppercase tracking-eyebrow text-white">
        Step {phase === 'range' ? '1' : '2'} of 2
      </span>
      <span className="font-body text-sm font-medium text-pine">{instruction}</span>
      <span className="ml-auto whitespace-nowrap font-body text-detail text-pine/70">{hint}</span>
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
      {/* Every control lives here, in the order the job is done: what the
          object is, undo the range, then create it. They used to be split
          between this bar and the strip's footer, which meant hunting in two
          places for one task. The strip below is now purely the frames. */}
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
          <span
            role="radiogroup"
            aria-label="Smoke type"
            className="inline-flex items-center rounded-lg bg-ash p-0.5"
          >
            {SMOKE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={smokeType === type}
                onClick={() => setSmokeType(type)}
                // Pine for the selected class — the Localize lane's own
                // colour, so what the object IS reads in the same hue as the
                // work being done. It sits inside the ash track, which keeps
                // it from merging with the pine Create button beside it.
                className={`rounded-md px-2.5 py-1 font-body text-xs capitalize transition-colors ${
                  smokeType === type
                    ? 'bg-pine font-medium text-white'
                    : 'text-haze hover:text-char'
                }`}
              >
                {type}
              </button>
            ))}
          </span>

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

          {/* Once the box is drawn there is exactly one thing left to do, and
              it is at the far end of the bar from where the drawing happened —
              so the button pulses to claim the eye. A halo, not `animate-pulse`:
              flashing opacity would make its own label unreadable. It stops the
              moment the create is in flight. */}
          <button
            type="button"
            onClick={submit}
            disabled={box === null || isCreating}
            data-testid="create-object"
            // Stable accessible name: the visible label becomes "Creating…"
            // mid-flight, and a control should not change identity while it
            // is working.
            aria-label="Create object"
            className={`inline-flex items-center rounded-lg bg-pine px-3 py-1 font-body text-xs font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50${
              box !== null && !isCreating ? ' animate-pine-glow motion-reduce:animate-none' : ''
            }`}
          >
            {isCreating ? 'Creating…' : 'Create object'}
          </button>

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
            transformOrigin={stage.transformOrigin}
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
        className={`flex-none border-t border-line ${phase === 'range' ? 'bg-pine-soft' : 'bg-paper'}`}
      >
        {phase === 'range' && prompt}
        <ObjectRangeStrip
          entries={entries}
          currentRecordedAt={currentRecordedAt}
          objectColor={objectColor}
          onSelect={handleSelectFrame}
        />
      </div>
    </div>
  );
}
