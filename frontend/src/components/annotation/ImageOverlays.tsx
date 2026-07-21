/**
 * Reusable overlay components for rendering bounding boxes on detection images.
 * These components handle the visual representation of AI predictions, user annotations, and drawn rectangles.
 */

import { Detection, DetectionAnnotation, AlgoPrediction, SmokeType } from '@/types/api';
import {
  DrawnRectangle,
  CurrentDrawing,
  getSmokeTypeColors,
  ModelLayer,
  ResizeHandle,
  HANDLE_CURSOR,
} from '@/utils/annotation';

// Position of each resize handle relative to the selected box (8px squares).
const HANDLE_STYLES: Record<ResizeHandle, React.CSSProperties> = {
  nw: { left: -4, top: -4 },
  n: { left: 'calc(50% - 4px)', top: -4 },
  ne: { right: -4, top: -4 },
  w: { left: -4, top: 'calc(50% - 4px)' },
  e: { right: -4, top: 'calc(50% - 4px)' },
  sw: { left: -4, bottom: -4 },
  s: { left: 'calc(50% - 4px)', bottom: -4 },
  se: { right: -4, bottom: -4 },
};
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
              className="absolute border-2 border-red-500 pointer-events-none"
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
 * Read-only overlay for sibling bboxes (Detection.others_bboxes): boxes the
 * detector saw on the same image but that are not part of the tracked
 * sequence. Rendered as dashed gray to clearly distinguish from primary
 * predictions and user annotations — annotators use them only as a hint to
 * spot missed smoke.
 */
interface SiblingBoundingBoxOverlayProps {
  detection: Detection;
  imageInfo: ImageInfo;
}

export function SiblingBoundingBoxOverlay({
  detection,
  imageInfo,
}: SiblingBoundingBoxOverlayProps) {
  const others = detection?.others_bboxes?.predictions;
  if (!others || others.length === 0) return null;

  return (
    <>
      {others
        .map((prediction: AlgoPrediction, index: number) => {
          if (!validateBoundingBox(prediction.xyxyn)) {
            return null;
          }

          const { left, top, width, height } = normalizedToPixelBox(prediction.xyxyn, imageInfo);

          return (
            <div
              key={`sibling-bbox-${detection.id}-${index}`}
              className="absolute border-2 border-dashed border-gray-400 pointer-events-none opacity-80"
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
              }}
            >
              <div className="absolute -top-5 left-0 bg-gray-500/90 text-white text-[10px] px-1 rounded whitespace-nowrap">
                sibling {(prediction.confidence * 100).toFixed(0)}%
              </div>
            </div>
          );
        })
        .filter(Boolean)}
    </>
  );
}

/**
 * Read-only overlay for an immutable model reference layer (engine =
 * algo_predictions, dotted; auto = auto_predictions, dashed). Line style
 * encodes the layer; border color always encodes the active smoke_type — the
 * color these boxes would take if accepted as that type. Never interactive:
 * these are reference only until the human accepts/adjusts them at review.
 */
interface ReferenceBoxOverlayProps {
  predictions: AlgoPrediction[] | null | undefined;
  variant: ModelLayer;
  smokeType: SmokeType;
  imageInfo: ImageInfo;
  detectionId: number;
}

export function ReferenceBoxOverlay({
  predictions,
  variant,
  smokeType,
  imageInfo,
  detectionId,
}: ReferenceBoxOverlayProps) {
  if (!predictions || predictions.length === 0) return null;

  const borderColor = getSmokeTypeColors(smokeType).border;
  const lineStyle = variant === 'engine' ? 'border-dotted' : 'border-dashed';

  return (
    <>
      {predictions
        .map((prediction: AlgoPrediction, index: number) => {
          if (!validateBoundingBox(prediction.xyxyn)) {
            return null;
          }

          const { left, top, width, height } = normalizedToPixelBox(prediction.xyxyn, imageInfo);

          return (
            <div
              key={`ref-${variant}-${detectionId}-${index}`}
              className={`absolute border-2 ${lineStyle} ${borderColor} pointer-events-none opacity-90`}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
              }}
            >
              <div className="absolute -top-5 left-0 bg-black/60 text-white text-[10px] px-1 rounded whitespace-nowrap">
                {variant} {(prediction.confidence * 100).toFixed(0)}%
              </div>
            </div>
          );
        })
        .filter(Boolean)}
    </>
  );
}

/**
 * Interactive overlay for the winning model layer during seed-at-submit review.
 * Each box is pending-accept by default; clicking it (when interactive) selects
 * it and reveals ✗ (reject) / ✎ (adjust). Rejected boxes render dimmed + struck.
 * Color = the sequence smoke_type; line style = the layer (auto dashed / engine
 * dotted). Accepted boxes are materialized at submit; rejected ones are dropped.
 */
interface ReviewBoxOverlayProps {
  predictions: AlgoPrediction[] | null | undefined;
  variant: ModelLayer;
  smokeType: SmokeType;
  imageInfo: ImageInfo;
  detectionId: number;
  rejected: Set<number>;
  hidden: Set<number>;
  selectedIndex: number | null;
  interactive: boolean;
  onSelect: (index: number) => void;
  onReject: (index: number) => void;
  onAdjust: (index: number) => void;
}

export function ReviewBoxOverlay({
  predictions,
  variant,
  smokeType,
  imageInfo,
  detectionId,
  rejected,
  hidden,
  selectedIndex,
  interactive,
  onSelect,
  onReject,
  onAdjust,
}: ReviewBoxOverlayProps) {
  if (!predictions || predictions.length === 0) return null;

  const borderColor = getSmokeTypeColors(smokeType).border;
  const lineStyle = variant === 'engine' ? 'border-dotted' : 'border-dashed';

  return (
    <>
      {predictions
        .map((prediction: AlgoPrediction, index: number) => {
          // Adjusted boxes are replaced in place by an editable human copy.
          if (hidden.has(index) || !validateBoundingBox(prediction.xyxyn)) {
            return null;
          }

          const { left, top, width, height } = normalizedToPixelBox(prediction.xyxyn, imageInfo);
          const isRejected = rejected.has(index);
          const isSelected = selectedIndex === index;

          return (
            <div
              key={`review-${variant}-${detectionId}-${index}`}
              className={`absolute border-2 ${lineStyle} ${
                isRejected ? 'border-gray-500 opacity-40' : borderColor
              } ${isSelected ? 'ring-2 ring-white' : ''}`}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                pointerEvents: interactive && !isRejected ? 'auto' : 'none',
                cursor: interactive && !isRejected ? 'pointer' : 'default',
              }}
              onClick={e => {
                e.stopPropagation();
                if (interactive && !isRejected) onSelect(index);
              }}
            >
              {isRejected && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-200 text-lg pointer-events-none">
                  ✕
                </div>
              )}
              <div className="absolute -top-5 left-0 bg-black/60 text-white text-[10px] px-1 rounded whitespace-nowrap pointer-events-none">
                {variant}
                {isRejected ? ' · rejected' : ''}
              </div>
              {isSelected && !isRejected && (
                <div
                  className="absolute -top-5 right-0 flex gap-1"
                  style={{ pointerEvents: 'auto' }}
                >
                  <button
                    type="button"
                    title="Reject this box"
                    onClick={e => {
                      e.stopPropagation();
                      onReject(index);
                    }}
                    className="bg-red-600 hover:bg-red-700 text-white text-[10px] leading-none px-1.5 py-0.5 rounded"
                  >
                    ✗
                  </button>
                  <button
                    type="button"
                    title="Adjust (edit a human copy)"
                    onClick={e => {
                      e.stopPropagation();
                      onAdjust(index);
                    }}
                    className="bg-yellow-500 hover:bg-yellow-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded"
                  >
                    ✎
                  </button>
                </div>
              )}
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
          // Validate bounding box before rendering; false-positive items
          // (no smoke_type) are not part of the smoke overlay
          if (!validateBoundingBox(annotationBbox.xyxyn) || !annotationBbox.smoke_type) {
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
              className={`absolute border-2 ${colors.border} pointer-events-none`}
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
  // Drag-to-move (box body) and drag-to-resize (handles) on the selected box.
  onBoxPointerDown?: (id: string, e: React.MouseEvent) => void;
  onHandlePointerDown?: (id: string, handle: ResizeHandle, e: React.MouseEvent) => void;
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
  onBoxPointerDown,
  onHandlePointerDown,
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
            onMouseDown={
              isSelected && onBoxPointerDown
                ? e => onBoxPointerDown(rect.id, e)
                : undefined
            }
            className={`absolute border-2 ${isSelected ? 'border-yellow-400' : colors.border} pointer-events-auto ${
              isSelected ? 'cursor-move' : 'cursor-pointer'
            }`}
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
              } text-xs px-1 py-0.5 rounded whitespace-nowrap pointer-events-none`}
            >
              {rect.smokeType === 'wildfire' ? '🔥' : rect.smokeType === 'industrial' ? '🏭' : '💨'}{' '}
              {rect.smokeType.charAt(0).toUpperCase() + rect.smokeType.slice(1)}
              {isSelected && ' (selected)'}
            </div>

            {/* Resize handles on the selected box */}
            {isSelected &&
              onHandlePointerDown &&
              (Object.keys(HANDLE_STYLES) as ResizeHandle[]).map(handle => (
                <div
                  key={handle}
                  onMouseDown={e => onHandlePointerDown(rect.id, handle, e)}
                  className="absolute w-2 h-2 bg-white border border-gray-800 pointer-events-auto"
                  style={{ ...HANDLE_STYLES[handle], cursor: HANDLE_CURSOR[handle] }}
                />
              ))}
          </div>
        );
      })}

      {/* Render current drawing */}
      {currentDrawing &&
        (() => {
          const { left, top, width, height } = renderRectangle(currentDrawing, 'drawing');
          return (
            <div
              className="absolute border-2 border-dashed border-blue-400 pointer-events-none"
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
