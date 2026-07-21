/**
 * Canvas component for detection annotation.
 * Handles image display, drawing interactions, zoom, and pan.
 * This is a simplified component that renders the exact same UI as the original ImageModal canvas.
 */

import { Detection, SmokeType } from '@/types/api';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { DrawnRectangle, CurrentDrawing, Point, ModelLayer } from '@/utils/annotation';
import {
  ReferenceBoxOverlay,
  ReviewBoxOverlay,
  DrawingOverlay,
  SiblingBoundingBoxOverlay,
} from '@/components/annotation/ImageOverlays';

interface ImageInfo {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

interface DetectionAnnotationCanvasProps {
  detection: Detection;
  drawnRectangles: DrawnRectangle[];
  selectedRectangleId: string | null;
  showPredictions: boolean;
  showEngine: boolean;
  showAuto: boolean;
  selectedSmokeType: SmokeType;
  showSiblingBboxes?: boolean;
  // Seed-at-submit review of the winning model layer
  winningLayer: ModelLayer;
  isDrawMode: boolean;
  rejectedBoxes: Set<number>;
  selectedModelBox: number | null;
  onSelectModelBox: (index: number) => void;
  onRejectModelBox: (index: number) => void;
  onAdjustModelBox: (index: number) => void;
  currentDrawing: CurrentDrawing | null;
  // Image and container refs passed from parent
  containerRef: React.RefObject<HTMLDivElement>;
  imgRef: React.RefObject<HTMLImageElement>;
  imageInfo: ImageInfo | null;
  // Zoom/pan state passed from parent
  zoomLevel: number;
  panOffset: Point;
  transformOrigin: Point;
  isDragging: boolean;
  // Event handlers
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  getCursorStyle: () => string;
  handleImageLoad: () => void;
  normalizedToImage: (normalizedX: number, normalizedY: number) => Point;
  overlaysVisible: boolean;
}

export function DetectionAnnotationCanvas({
  detection,
  drawnRectangles,
  selectedRectangleId,
  showPredictions,
  showEngine,
  showAuto,
  selectedSmokeType,
  showSiblingBboxes = true,
  winningLayer,
  isDrawMode,
  rejectedBoxes,
  selectedModelBox,
  onSelectModelBox,
  onRejectModelBox,
  onAdjustModelBox,
  currentDrawing,
  containerRef,
  imgRef,
  imageInfo,
  zoomLevel,
  panOffset,
  transformOrigin,
  isDragging,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onClick,
  getCursorStyle,
  handleImageLoad,
  normalizedToImage,
  overlaysVisible,
}: DetectionAnnotationCanvasProps) {
  const { data: imageData } = useDetectionImage(detection.id);

  // The winning model layer is reviewed (interactive); the other is read-only.
  const showWinning = winningLayer === 'auto' ? showAuto : showEngine;
  const winningPreds =
    winningLayer === 'auto'
      ? detection.auto_predictions?.predictions
      : detection.algo_predictions?.predictions;

  return imageData?.url ? (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onClick={onClick}
      style={{ cursor: getCursorStyle() }}
    >
      <img
        ref={imgRef}
        src={imageData.url}
        alt={`Detection ${detection.id}`}
        className="max-w-full max-h-[95vh] object-contain block"
        style={{
          transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
          transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
        }}
        onLoad={handleImageLoad}
      />

      {/* Bounding Boxes Overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 ease-in-out"
        style={{
          transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
          transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out, opacity 0.3s ease-in-out',
          opacity: showPredictions && imageInfo && overlaysVisible ? 1 : 0,
          pointerEvents: showPredictions && imageInfo && overlaysVisible ? 'none' : 'none',
        }}
      >
        {/* Read-only NON-winning model layer (toggled on to investigate) */}
        {showPredictions && winningLayer === 'auto' && showEngine && imageInfo && (
          <ReferenceBoxOverlay
            predictions={detection.algo_predictions?.predictions}
            variant="engine"
            smokeType={selectedSmokeType}
            imageInfo={imageInfo}
            detectionId={detection.id}
          />
        )}
        {showPredictions && winningLayer === 'engine' && showAuto && imageInfo && (
          <ReferenceBoxOverlay
            predictions={detection.auto_predictions?.predictions}
            variant="auto"
            smokeType={selectedSmokeType}
            imageInfo={imageInfo}
            detectionId={detection.id}
          />
        )}
        {showPredictions && showSiblingBboxes && imageInfo && (
          <SiblingBoundingBoxOverlay detection={detection} imageInfo={imageInfo} />
        )}
      </div>

      {/* Drawing Overlay */}
      <div
        className="absolute inset-0 z-20 transition-opacity duration-300 ease-in-out"
        style={{
          opacity: imageInfo && overlaysVisible ? 1 : 0,
        }}
      >
        {imageInfo && (
          <DrawingOverlay
            drawnRectangles={drawnRectangles}
            currentDrawing={currentDrawing}
            selectedRectangleId={selectedRectangleId}
            imageInfo={imageInfo}
            zoomLevel={zoomLevel}
            panOffset={panOffset}
            transformOrigin={transformOrigin}
            isDragging={isDragging}
            normalizedToImage={normalizedToImage}
          />
        )}
      </div>

      {/* Interactive review layer: the winning model layer, above the drawing
          layer. The container passes clicks through (pointer-events-none);
          individual boxes/controls opt back in when interactive (not drawing). */}
      {showPredictions && showWinning && imageInfo && (
        <div
          className="absolute inset-0 z-30 pointer-events-none"
          style={{
            transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
            transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            opacity: overlaysVisible ? 1 : 0,
          }}
        >
          <ReviewBoxOverlay
            predictions={winningPreds}
            variant={winningLayer}
            smokeType={selectedSmokeType}
            imageInfo={imageInfo}
            detectionId={detection.id}
            rejected={rejectedBoxes}
            selectedIndex={selectedModelBox}
            interactive={!isDrawMode}
            onSelect={onSelectModelBox}
            onReject={onRejectModelBox}
            onAdjust={onAdjustModelBox}
          />
        </div>
      )}
    </div>
  ) : (
    <div className="w-96 h-96 bg-gray-800 flex items-center justify-center rounded-lg">
      <span className="text-gray-400">No image available</span>
    </div>
  );
}
