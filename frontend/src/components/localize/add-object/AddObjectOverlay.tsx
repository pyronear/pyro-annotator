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
 * Phase 2 draws TWO boxes, one per end of the range, and everything between
 * is interpolated. Smoke grows and drifts, so a single box stamped across
 * nineteen frames is too big at the start and too small at the end. While the
 * second anchor is being drawn the first renders ghosted, so it is placed
 * relative to something rather than from memory.
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
import { interpolateRangeBoxes, type RangeBox } from '@/utils/annotation/objectRangeInterpolation';
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
  /** Every in-range frame with its box, already interpolated. */
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
  const [anchorBoxes, setAnchorBoxes] = useState<{ first: Xyxyn | null; last: Xyxyn | null }>({
    first: null,
    last: null,
  });
  const [currentRecordedAt, setCurrentRecordedAt] = useState(alertFrames[0]?.recordedAt ?? '');
  const [smokeType, setSmokeType] = useState<SmokeType>('wildfire' as SmokeType);
  const [boxSelected, setBoxSelected] = useState(false);

  const bothAnchorsBoxed = anchorBoxes.first !== null && anchorBoxes.last !== null;

  const entries = useMemo(
    () =>
      buildRangeStripEntries(
        alertFrames,
        range,
        bothAnchorsBoxed ? { first: anchorBoxes.first!, last: anchorBoxes.last! } : null
      ),
    [alertFrames, range, bothAnchorsBoxed, anchorBoxes]
  );

  const isFirstAnchor = range != null && currentRecordedAt === range.firstRecordedAt;
  const isLastAnchor = range != null && currentRecordedAt === range.lastRecordedAt;
  const onAnchor = phase === 'draw' && (isFirstAnchor || isLastAnchor);

  // The box for the frame on the stage: the anchor's own while drawing it, or
  // the interpolated one when merely looking at an interior frame.
  const stageBox: Xyxyn | null = isFirstAnchor
    ? anchorBoxes.first
    : isLastAnchor
      ? anchorBoxes.last
      : (entries.find(e => e.recordedAt === currentRecordedAt)?.xyxyn ?? null);

  const handleDrawn = useCallback(
    (xyxyn: Xyxyn) => {
      // Only an anchor accepts a box. An interior frame is there to check the
      // tween on, and its box is derived rather than drawn.
      if (phase !== 'draw' || range == null) return;
      setAnchorBoxes(prev => ({
        first: currentRecordedAt === range.firstRecordedAt ? xyxyn : prev.first,
        last: currentRecordedAt === range.lastRecordedAt ? xyxyn : prev.last,
      }));
    },
    [phase, range, currentRecordedAt]
  );

  const stage = useBoxDrawingStage({
    containerRef,
    imgRef,
    editableBox: onAnchor ? stageBox : null,
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
  // anything is selected. It drops the anchor boxes too: re-anchoring a box
  // onto a frame that may have left the range is not worth the complexity.
  const restartRange = () => {
    setPhase('range');
    setPendingFirst(null);
    setRange(null);
    setAnchorBoxes({ first: null, last: null });
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
    if (!range || !bothAnchorsBoxed) return;
    const stamps = entries.filter(e => e.inRange).map(e => e.recordedAt);
    onCreate(interpolateRangeBoxes(stamps, anchorBoxes.first!, anchorBoxes.last!), smokeType);
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

  // The first box stays on screen while the second is drawn, so the second is
  // placed relative to it rather than from memory.
  const ghostFirstAnchor =
    isLastAnchor && !isFirstAnchor && anchorBoxes.first
      ? [{ source: 'manual' as const, index: 0, xyxyn: anchorBoxes.first }]
      : [];

  const instruction =
    phase === 'range'
      ? pendingFirst === null
        ? 'Click the first frame this object appears on'
        : 'Now click the last frame'
      : isFirstAnchor && anchorBoxes.first === null
        ? 'Draw a box around the object on this frame'
        : isLastAnchor && anchorBoxes.last === null
          ? 'Now box it on the last frame — the frames between are filled in'
          : onAnchor
            ? 'Drag to redraw this box'
            : 'Interpolated — step to an anchor to change the track';

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
      <div className="relative z-40 flex h-12 flex-none items-center gap-3 border-b border-line bg-paper px-4">
        <span className="font-body text-sm font-semibold text-char">New object</span>
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
            committed={
              onAnchor && stageBox ? { source: 'manual', index: 0, xyxyn: stageBox } : null
            }
            ghosts={ghostFirstAnchor}
            showGhosts={ghostFirstAnchor.length > 0}
            selected={onAnchor && boxSelected}
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
        {/* Floated over the stage rather than stacked into the column, so the
            photo never resizes as the instruction changes — the same treatment
            the editor gives its out-of-range banner, and the same pine. */}
        <p
          data-testid="add-object-instruction"
          className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-line bg-pine-soft px-4 py-2 font-body text-detail text-pine"
        >
          {instruction}
        </p>
      </div>

      <div className="flex-none border-t border-line bg-paper">
        <ObjectRangeStrip
          entries={entries}
          currentRecordedAt={currentRecordedAt}
          objectColor={objectColor}
          onSelect={handleSelectFrame}
        />
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <span className="font-data text-eyebrow uppercase tracking-eyebrow text-haze">
            {objectLabel}
          </span>
          <span role="radiogroup" aria-label="Smoke type" className="flex items-center gap-1.5">
            {SMOKE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={smokeType === type}
                onClick={() => setSmokeType(type)}
                className={`rounded-lg border px-3 py-1 font-body text-xs capitalize transition-colors ${
                  smokeType === type
                    ? 'border-pine bg-pine font-medium text-white'
                    : 'border-line bg-paper text-char hover:bg-ash'
                }`}
              >
                {type}
              </button>
            ))}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!bothAnchorsBoxed || isCreating}
            className="ml-auto rounded-lg bg-pine px-4 py-1 font-body text-xs font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? 'Creating…' : 'Create object'}
          </button>
        </div>
      </div>
    </div>
  );
}
