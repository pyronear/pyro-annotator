/**
 * The collocated localize screen's primary surface: one cell per frame in
 * the alert's frame union (LocalizeAlertPage / alertLocalizeUtils). Each
 * cell shows the frame image (of the active object's detection when it has
 * one there, else the first present lane's), a mini box per object present
 * on that frame in its own accent color (solid for a committed box, dashed
 * for anything not committed — a winning model box awaiting acceptance, or
 * a false-positive lane's engine track, which is read-only context and
 * never gets committed at all), and a small status chip. A lane committed
 * on a frame with zero smoke boxes — a cleared frame, "object not visible
 * here" — shows an eye-off corner chip in the lane's color instead of a box.
 *
 * Clicking a cell reports the frame's timestamp plus the shown (active, or
 * first-present-fallback) object's lane and detection id via `onCellClick`
 * — the page opens that detection in the per-frame editor and makes the
 * lane active if it wasn't already (Task 4).
 *
 * Crop mode (`cropMode`, active only when an object is active) zooms each
 * cell around that object's boxes on that frame, mirroring the legacy
 * grid's crop-mode zoom (`gridCropUtils.computeCellCrop`). A boxless frame
 * — a gap in the object's track, or a before/after context frame where the
 * lane is absent — zooms to the union of the nearest boxed neighbors
 * instead (`computeFallbackCrops`), so the eye stays on one region across
 * the whole sequence; while cropped, context cells swap their heavy fade
 * for a lighter dim so faint smoke in that region stays judgeable.
 *
 * `highlightedFrame` (a `recordedAt`) gives that one cell a temporary accent
 * ring — the page sets it on a segment click or a `?frame=` deep-link
 * arrival, then clears it after a couple of seconds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { normalizedToPixelBox, ImageInfo } from '@/utils/annotation/coordinateUtils';
import { CellCrop, computeCellCrop, computeFallbackCrops } from '@/utils/annotation/gridCropUtils';
import { AlertFrame, AlertFrameCell } from '@/utils/annotation/alertLocalizeUtils';
import { formatDateTime } from '@/utils/datetime';

interface AlertFrameGridProps {
  frames: AlertFrame[];
  /** The strip's currently active object — determines which lane's image a cell shows when it has one. */
  activeLaneId: number | null;
  onCellClick: (recordedAt: string, laneSequenceId: number, detectionId: number) => void;
  /** Registers the cell's DOM node for the page's scroll-to-frame behavior (segment click). */
  cellRef?: (recordedAt: string, el: HTMLDivElement | null) => void;
  /** Minimum cell width driving the auto-fill column count — set by the S/M/L card-size knob. */
  cardMinWidth?: number;
  /** Zoom each cell around the active object's boxes for that frame; no-op with no active object. */
  cropMode?: boolean;
  /** The `recordedAt` of the one cell to ring-highlight (segment click / `?frame=` deep link arrival). */
  highlightedFrame?: string | null;
}

export function AlertFrameGrid({
  frames,
  activeLaneId,
  onCellClick,
  cellRef,
  cardMinWidth = 220,
  cropMode = false,
  highlightedFrame = null,
}: AlertFrameGridProps) {
  // Inferred zoom for boxless cells (gap frames, before/after context): the
  // union of the nearest boxed frames on each side, so the eye stays on one
  // region across the whole sequence instead of jumping between tight crops
  // and full frames. Computed before the empty-frames early return — hooks
  // must run unconditionally.
  const fallbackCrops = useMemo(
    () => (cropMode ? computeFallbackCrops(frames, activeLaneId) : new Map<string, CellCrop>()),
    [frames, activeLaneId, cropMode]
  );

  if (frames.length === 0) return null;

  return (
    <div
      className="grid gap-px"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardMinWidth}px, 100%), 1fr))`,
      }}
    >
      {frames.map(frame => (
        <AlertFrameCellView
          key={frame.recordedAt}
          frame={frame}
          activeLaneId={activeLaneId}
          cropMode={cropMode}
          fallbackCrop={fallbackCrops.get(frame.recordedAt)}
          highlighted={highlightedFrame === frame.recordedAt}
          onClick={activeCell =>
            onCellClick(frame.recordedAt, activeCell.laneSequenceId, activeCell.detectionId)
          }
          cellRef={cellRef ? el => cellRef(frame.recordedAt, el) : undefined}
        />
      ))}
    </div>
  );
}

interface AlertFrameCellViewProps {
  frame: AlertFrame;
  activeLaneId: number | null;
  cropMode: boolean;
  /** Borrowed crop for a frame where the active lane has no boxes (gap / context). */
  fallbackCrop?: CellCrop;
  highlighted: boolean;
  onClick: (activeCell: AlertFrameCell) => void;
  cellRef?: (el: HTMLDivElement | null) => void;
}

function AlertFrameCellView({
  frame,
  activeLaneId,
  cropMode,
  fallbackCrop,
  highlighted,
  onClick,
  cellRef,
}: AlertFrameCellViewProps) {
  // Fallback (no active object) prefers a lane that can actually be worked:
  // landing on a false-positive cell would make the whole frame read-only,
  // hiding the smoke object that shares it behind an un-clickable cell.
  const activeCell: AlertFrameCell =
    frame.cells.find(c => c.laneSequenceId === activeLaneId) ??
    frame.cells.find(c => !c.isFalsePositive) ??
    frame.cells[0];
  const isActiveLaneCell = activeLaneId !== null && activeCell.laneSequenceId === activeLaneId;
  // A cell with the active object's boxes crops around them. A boxless cell
  // — gap frame (lane present, nothing drawn) or context frame (lane
  // absent) — borrows the grid-level fallback crop inferred from its
  // nearest boxed neighbors, so "did smoke appear here?" is judged at the
  // same zoom as the frames around it.
  const identityCrop: CellCrop = { scale: 1, originX: 50, originY: 50 };
  const crop = !cropMode
    ? identityCrop
    : isActiveLaneCell && activeCell.boxes.length > 0
      ? computeCellCrop(activeCell.boxes)
      : (fallbackCrop ?? identityCrop);
  const cropStyle =
    crop.scale > 1
      ? { transform: `scale(${crop.scale})`, transformOrigin: `${crop.originX}% ${crop.originY}%` }
      : undefined;

  const { data: imageData, isLoading } = useDetectionImage(activeCell.detectionId);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleImageLoad = useCallback(() => {
    if (imgRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();
      const next: ImageInfo = {
        width: imgRect.width,
        height: imgRect.height,
        offsetX: imgRect.left - containerRect.left,
        offsetY: imgRect.top - containerRect.top,
      };
      // Bail out when the measurement is unchanged. This runs from a
      // ResizeObserver callback, and an unconditional setState there is a
      // feedback loop waiting to happen: re-render -> layout -> observer
      // fires -> setState -> ... Activating an object used to trip it —
      // focus mode flips crop on AND forces small cards, so the grid
      // re-columns and every cell re-measures at once.
      setImageInfo(prev =>
        prev &&
        prev.width === next.width &&
        prev.height === next.height &&
        prev.offsetX === next.offsetX &&
        prev.offsetY === next.offsetY
          ? prev
          : next
      );
    }
  }, []);

  // Re-measure when the active object (and so the displayed image) changes,
  // or when the crop transform changes the image's rendered rect.
  useEffect(() => {
    if (imgRef.current?.complete) handleImageLoad();
  }, [activeCell.detectionId, crop.scale, crop.originX, crop.originY, handleImageLoad]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (imgRef.current?.complete) handleImageLoad();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleImageLoad, isLoading, imageData?.url]);

  // With an object active, a frame it doesn't appear on is context only:
  // there is nothing of THIS object to annotate there. It fades back so the
  // object's own span reads at a glance, and it stops being a click target —
  // clicking used to open the fallback lane's detection, silently switching
  // which object you were editing.
  const isContextFrame = activeLaneId !== null && !isActiveLaneCell;
  // A false-positive object is settled; its frames are here to be LOOKED at
  // (including via the cropped-view strip), never edited. Opening the editor
  // on one would offer to re-box something classify already rejected.
  const isReadOnly = isContextFrame || activeCell.isFalsePositive === true;

  const clearedCells = frame.cells.filter(
    c => c.cellState === 'done' && !c.isFalsePositive && c.boxes.length === 0
  );

  return (
    <div
      ref={el => {
        containerRef.current = el;
        cellRef?.(el);
      }}
      data-testid={`alert-frame-cell-${frame.recordedAt}`}
      data-highlighted={highlighted ? 'true' : undefined}
      data-context={isContextFrame ? 'true' : undefined}
      data-readonly={isReadOnly ? 'true' : undefined}
      className={`group aspect-video relative overflow-hidden bg-ash transition-shadow duration-700 ${
        isContextFrame ? (cropMode ? 'opacity-75' : 'opacity-40 saturate-50') : ''
      } ${isReadOnly ? 'cursor-default' : 'cursor-pointer'} ${
        highlighted ? 'ring-2 ring-pine ring-offset-2' : ''
      }`}
      onClick={isReadOnly ? undefined : () => onClick(activeCell)}
    >
      {isLoading && <div className="absolute inset-0 animate-pulse bg-ash" />}

      {!isLoading && imageData?.url && (
        <img
          ref={imgRef}
          src={imageData.url}
          alt={`Frame ${frame.recordedAt}`}
          className="w-full h-full object-contain"
          style={cropStyle}
          onLoad={handleImageLoad}
          draggable={false}
        />
      )}

      {imageInfo &&
        frame.cells.flatMap(cell =>
          cell.boxes.map((box, i) => {
            const { left, top, width, height } = normalizedToPixelBox(box.xyxyn, imageInfo);
            return (
              <div
                key={`${cell.laneSequenceId}-${i}`}
                data-testid={`alert-frame-box-${frame.recordedAt}-${cell.laneSequenceId}`}
                className="absolute pointer-events-none"
                style={{
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  // Solid means committed. A false-positive cell's state is
                  // genuinely 'done' (its lane is annotated), but the boxes
                  // shown are the engine track, not anything a human
                  // committed — so it stays dashed like any other
                  // not-yet-committed box.
                  border: `2px ${
                    cell.cellState === 'done' && !cell.isFalsePositive ? 'solid' : 'dashed'
                  } ${box.color}`,
                }}
              />
            );
          })
        )}

      {/* Cleared markers: a lane committed on this frame with zero smoke
          boxes — the annotator's "object not visible here". Without the
          chip, a cleared cell is indistinguishable from one whose box
          simply isn't drawn, while the timeline calls it committed. FP
          context lanes are exempt: their committed annotation is empty by
          construction, so the chip would say nothing. */}
      {clearedCells.length > 0 && (
        <div className="absolute bottom-1 right-1 flex gap-1 pointer-events-none">
          {clearedCells.map(c => (
            <span
              key={c.laneSequenceId}
              data-testid={`alert-frame-cleared-${frame.recordedAt}-${c.laneSequenceId}`}
              title="Cleared — object not visible on this frame"
              className="rounded bg-char/60 p-0.5"
            >
              <EyeOff size={12} style={{ color: c.color }} aria-hidden />
              <span className="sr-only">Cleared — object not visible on this frame</span>
            </span>
          ))}
        </div>
      )}

      <div className="absolute bottom-0 left-0 bg-char/60 text-white text-[10px] px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {formatDateTime(frame.recordedAt)}
      </div>
    </div>
  );
}
