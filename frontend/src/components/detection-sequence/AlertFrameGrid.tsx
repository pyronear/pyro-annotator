/**
 * The collocated localize screen's primary surface: one cell per frame in
 * the alert's frame union (LocalizeAlertPage / alertLocalizeUtils). Each
 * cell shows the frame image (of the active object's detection when it has
 * one there, else the first present lane's), a mini box per object present
 * on that frame in its own accent color (solid for a committed box, dashed
 * for a winning-but-not-yet-committed one), and a small status chip.
 *
 * No editing here — Task 4 wires that in. Clicking a cell just reports the
 * frame's timestamp via `onCellClick`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { normalizedToPixelBox, ImageInfo } from '@/utils/annotation/coordinateUtils';
import { AlertFrame, AlertFrameCell } from '@/utils/annotation/alertLocalizeUtils';

interface AlertFrameGridProps {
  frames: AlertFrame[];
  /** The strip's currently active object — determines which lane's image a cell shows when it has one. */
  activeLaneId: number | null;
  onCellClick: (recordedAt: string) => void;
  /** Registers the cell's DOM node for the page's scroll-to-frame behavior (segment click). */
  cellRef?: (recordedAt: string, el: HTMLDivElement | null) => void;
  /** Minimum cell width driving the auto-fill column count — matches DetectionGrid's card-size knob. */
  cardMinWidth?: number;
}

export function AlertFrameGrid({
  frames,
  activeLaneId,
  onCellClick,
  cellRef,
  cardMinWidth = 220,
}: AlertFrameGridProps) {
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
          onClick={() => onCellClick(frame.recordedAt)}
          cellRef={cellRef ? el => cellRef(frame.recordedAt, el) : undefined}
        />
      ))}
    </div>
  );
}

interface AlertFrameCellViewProps {
  frame: AlertFrame;
  activeLaneId: number | null;
  onClick: () => void;
  cellRef?: (el: HTMLDivElement | null) => void;
}

function AlertFrameCellView({ frame, activeLaneId, onClick, cellRef }: AlertFrameCellViewProps) {
  const activeCell: AlertFrameCell =
    frame.cells.find(c => c.laneSequenceId === activeLaneId) ?? frame.cells[0];

  const { data: imageData, isLoading } = useDetectionImage(activeCell.detectionId);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleImageLoad = useCallback(() => {
    if (imgRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();
      setImageInfo({
        width: imgRect.width,
        height: imgRect.height,
        offsetX: imgRect.left - containerRect.left,
        offsetY: imgRect.top - containerRect.top,
      });
    }
  }, []);

  // Re-measure when the active object (and so the displayed image) changes.
  useEffect(() => {
    if (imgRef.current?.complete) handleImageLoad();
  }, [activeCell.detectionId, handleImageLoad]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (imgRef.current?.complete) handleImageLoad();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleImageLoad, isLoading, imageData?.url]);

  const doneCount = frame.cells.filter(c => c.cellState === 'done').length;
  const total = frame.cells.length;
  const allDone = doneCount === total;

  return (
    <div
      ref={el => {
        containerRef.current = el;
        cellRef?.(el);
      }}
      data-testid={`alert-frame-cell-${frame.recordedAt}`}
      className="group aspect-video relative overflow-hidden bg-ash cursor-pointer"
      onClick={onClick}
    >
      {isLoading && <div className="absolute inset-0 animate-pulse bg-ash" />}

      {!isLoading && imageData?.url && (
        <img
          ref={imgRef}
          src={imageData.url}
          alt={`Frame ${frame.recordedAt}`}
          className="w-full h-full object-contain"
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
                  border: `2px ${cell.cellState === 'done' ? 'solid' : 'dashed'} ${box.color}`,
                }}
              />
            );
          })
        )}

      <span
        data-testid={`alert-frame-status-${frame.recordedAt}`}
        className={`absolute top-1 right-1 rounded-full px-1.5 py-0.5 font-data text-[10px] font-semibold ${
          allDone ? 'bg-pine-soft text-pine' : 'bg-ember-soft text-ember'
        }`}
      >
        {doneCount}/{total}
      </span>

      <div className="absolute bottom-0 left-0 bg-char/60 text-white text-[10px] px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {new Date(frame.recordedAt).toLocaleString()}
      </div>
    </div>
  );
}
