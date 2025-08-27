/**
 * Reusable overlay components for rendering bounding boxes on detection images.
 * These components handle the visual representation of AI predictions, user annotations, and drawn rectangles.
 */

import { Detection, DetectionAnnotation, AlgoPrediction } from '@/types/api';
import { DrawnRectangle, CurrentDrawing, getSmokeTypeColors } from '@/utils/annotation';
import {
  normalizedToPixelBox,
  validateBoundingBox,
  ImageInfo,
} from '@/utils/annotation/coordinateUtils';

/**
 * Component for rendering AI prediction bounding boxes over detection images.
 * Shows confidence scores and class names for algorithm predictions.
 */
interface BoundingBoxOverlayProps {
  detection: Detection;
  imageInfo: ImageInfo;
}

export function BoundingBoxOverlay({ detection, imageInfo }: BoundingBoxOverlayProps) {
  if (!detection?.algo_predictions?.predictions) return null;

  return (
    <>
      {detection.algo_predictions.predictions
        .map((prediction: AlgoPrediction, index: number) => {
          // Validate bounding box before rendering
          if (!validateBoundingBox(prediction.xyxyn)) {
            return null;
          }

          // Convert normalized coordinates to pixel coordinates
          const { left, top, width, height } = normalizedToPixelBox(prediction.xyxyn, imageInfo);

          return (
            <div
              key={`bbox-${detection.id}-${index}`}
              className="absolute border-2 border-red-500 bg-red-500/20 pointer-events-none"
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
              }}
            >
              {/* Confidence label */}
              <div className="absolute -top-6 left-0 bg-red-500 text-white text-xs px-1 py-0.5 rounded whitespace-nowrap">
                {prediction.class_name} {(prediction.confidence * 100).toFixed(0)}%
              </div>
            </div>
          );
        })
        .filter(Boolean)}
    </>
  );
}

/**
 * Component for rendering user annotation bounding boxes on detection images.
 * Shows smoke type classifications with appropriate colors and labels.
 */
interface UserAnnotationOverlayProps {
  detectionAnnotation: DetectionAnnotation | null;
  imageInfo: ImageInfo;
}

export function UserAnnotationOverlay({
  detectionAnnotation,
  imageInfo,
}: UserAnnotationOverlayProps) {
  if (
    !detectionAnnotation?.annotation?.annotation ||
    detectionAnnotation.annotation.annotation.length === 0
  ) {
    return null;
  }

  return (
    <>
      {detectionAnnotation.annotation.annotation
        .map((annotationBbox, index) => {
          // Validate bounding box before rendering
          if (!validateBoundingBox(annotationBbox.xyxyn)) {
            return null;
          }

          // Convert normalized coordinates to pixel coordinates
          const { left, top, width, height } = normalizedToPixelBox(
            annotationBbox.xyxyn,
            imageInfo
          );

          // Get colors for this smoke type
          const colors = getSmokeTypeColors(annotationBbox.smoke_type);

          // Get emoji and label for smoke type
          const smokeTypeDisplay = {
            wildfire: { emoji: '🔥', label: 'Wildfire' },
            industrial: { emoji: '🏭', label: 'Industrial' },
            other: { emoji: '💨', label: 'Other' },
          } as const;

          const display = smokeTypeDisplay[annotationBbox.smoke_type];

          return (
            <div
              key={`user-annotation-${detectionAnnotation.detection_id}-${index}`}
              className={`absolute border-2 ${colors.border} ${colors.background} pointer-events-none`}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
              }}
            >
              {/* Smoke type label */}
              <div
                className={`absolute -top-6 left-0 ${colors.border.replace('border-', 'bg-')} text-white text-xs px-1 py-0.5 rounded whitespace-nowrap`}
              >
                {display.emoji} {display.label}
              </div>
            </div>
          );
        })
        .filter(Boolean)}
    </>
  );
}

/**
 * Component for rendering user-drawn rectangles with interactive features.
 * Supports current drawing state, completed rectangles, and selection highlighting.
 */
interface DrawingOverlayProps {
  drawnRectangles: DrawnRectangle[];
  currentDrawing: CurrentDrawing | null;
  selectedRectangleId: string | null;
  imageInfo: ImageInfo;
  zoomLevel: number;
  panOffset: { x: number; y: number };
  transformOrigin: { x: number; y: number };
  isDragging: boolean;
  normalizedToImage: (normX: number, normY: number) => { x: number; y: number };
}

export function DrawingOverlay({
  drawnRectangles,
  currentDrawing,
  selectedRectangleId,
  imageInfo,
  zoomLevel,
  panOffset,
  transformOrigin,
  isDragging,
  normalizedToImage,
}: DrawingOverlayProps) {
  const renderRectangle = (
    rect: { xyxyn: [number, number, number, number]; id?: string } | CurrentDrawing,
    type: 'completed' | 'drawing'
  ) => {
    let left: number, top: number, width: number, height: number;

    if (type === 'completed') {
      // For completed rectangles, use normalized coordinates
      const rectData = rect as { xyxyn: [number, number, number, number]; id: string };
      const [x1, y1, x2, y2] = rectData.xyxyn;
      const topLeft = normalizedToImage(x1, y1);
      const bottomRight = normalizedToImage(x2, y2);

      left = imageInfo.offsetX + topLeft.x;
      top = imageInfo.offsetY + topLeft.y;
      width = bottomRight.x - topLeft.x;
      height = bottomRight.y - topLeft.y;
    } else {
      // For current drawing, use image coordinates directly
      const drawingData = rect as CurrentDrawing;
      left = Math.min(drawingData.startX, drawingData.currentX);
      top = Math.min(drawingData.startY, drawingData.currentY);
      width = Math.abs(drawingData.currentX - drawingData.startX);
      height = Math.abs(drawingData.currentY - drawingData.startY);
    }

    return { left, top, width, height };
  };

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
        transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      {/* Render completed rectangles */}
      {drawnRectangles.map(rect => {
        const { left, top, width, height } = renderRectangle(rect, 'completed');
        const isSelected = selectedRectangleId === rect.id;
        const colors = getSmokeTypeColors(rect.smokeType);

        return (
          <div
            key={rect.id}
            className={`absolute border-2 ${isSelected ? 'border-yellow-400' : colors.border} ${colors.background} pointer-events-auto cursor-pointer`}
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
            }}
          >
            {/* Rectangle label */}
            <div
              className={`absolute -top-6 left-0 ${
                isSelected
                  ? 'bg-yellow-400 text-black'
                  : `${colors.border.replace('border-', 'bg-')} text-white`
              } text-xs px-1 py-0.5 rounded whitespace-nowrap`}
            >
              {rect.smokeType === 'wildfire' ? '🔥' : rect.smokeType === 'industrial' ? '🏭' : '💨'}{' '}
              {rect.smokeType.charAt(0).toUpperCase() + rect.smokeType.slice(1)}
              {isSelected && ' (selected)'}
            </div>
          </div>
        );
      })}

      {/* Render current drawing */}
      {currentDrawing &&
        (() => {
          const { left, top, width, height } = renderRectangle(currentDrawing, 'drawing');
          return (
            <div
              className="absolute border-2 border-dashed border-blue-400 bg-blue-400/20 pointer-events-none"
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
              }}
            />
          );
        })()}
    </div>
  );
}
