/**
 * Canvas component for detection annotation.
 * Handles image display, drawing interactions, zoom, and pan.
 * This is a simplified component that renders the exact same UI as the original ImageModal canvas.
 */

import { Detection } from '@/types/api';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { DrawnRectangle, CurrentDrawing, Point } from '@/utils/annotation';
import { BoundingBoxOverlay, DrawingOverlay } from '@/components/annotation/ImageOverlays';

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
        {showPredictions && imageInfo && (
          <BoundingBoxOverlay detection={detection} imageInfo={imageInfo} />
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
    </div>
  ) : (
    <div className="w-96 h-96 bg-gray-800 flex items-center justify-center rounded-lg">
      <span className="text-gray-400">No image available</span>
    </div>
  );
}
