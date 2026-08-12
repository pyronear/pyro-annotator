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
import {
  normalizedToPixelBox,
  validateBoundingBox,
  ImageInfo,
} from '@/utils/annotation/coordinateUtils';
import { hairlineStroke } from '@/utils/annotation/hairlineStroke';

// Where each resize handle sits relative to the selected box, for a handle of
// `size` px. Computed rather than fixed because the size varies with the
// zoom the overlay is rendered inside.
function handleStyle(handle: ResizeHandle, size: number): React.CSSProperties {
  const edge = -size / 2;
  const mid = `calc(50% - ${size / 2}px)`;
  const base: React.CSSProperties = { width: `${size}px`, height: `${size}px` };
  switch (handle) {
    case 'nw':
      return { ...base, left: edge, top: edge };
    case 'n':
      return { ...base, left: mid, top: edge };
    case 'ne':
      return { ...base, right: edge, top: edge };
    case 'w':
      return { ...base, left: edge, top: mid };
    case 'e':
      return { ...base, right: edge, top: mid };
    case 'sw':
      return { ...base, left: edge, bottom: edge };
    case 's':
      return { ...base, left: mid, bottom: edge };
    case 'se':
      return { ...base, right: edge, bottom: edge };
  }
}

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
 * One other object's boxes on a shared frame, for `ObjectIdentityOverlay`
 * below — built by the caller (e.g. LocalizeAlertPage) from its own
 * per-object color/label bookkeeping, not derived here.
 */
export interface ObjectOverlayItem {
  color: string;
  label: string;
  boxes: { xyxyn: [number, number, number, number] }[];
}

/**
 * Read-only overlay for OTHER objects' boxes on a shared frame, in the
 * collocated localize editor: each box color-coded and labeled with its own
 * object identity (e.g. "Object 2"), replacing the generic, identity-less
 * `SiblingBoundingBoxOverlay` ("sibling NN%") vocabulary for that context —
 * a collocated alert's "siblings" are real tracked objects with their own
 * rows/colors, not anonymous detector noise. The caller (LocalizeAlertPage)
 * builds `objects` from the OTHER contributing lanes' cells at the same
 * frame; passing this prop down through DetectionAnnotationCanvas/ImageModal
 * also suppresses the sibling layer for that render (see those components).
 */
interface ObjectIdentityOverlayProps {
  objects: ObjectOverlayItem[];
  imageInfo: ImageInfo;
  /**
   * The zoom this overlay is rendered inside, as for `DrawingOverlay`. These
   * boxes are context, not the thing being edited, so they stay hairline at
   * every zoom instead of growing into the frame you are working on.
   */
  strokeScale?: number;
}

export function ObjectIdentityOverlay({
  objects,
  imageInfo,
  strokeScale = 1,
}: ObjectIdentityOverlayProps) {
  if (!objects || objects.length === 0) return null;

  return (
    <>
      {objects.flatMap((object, objectIndex) =>
        object.boxes
          .map((box, boxIndex) => {
            if (!validateBoundingBox(box.xyxyn)) return null;

            const { left, top, width, height } = normalizedToPixelBox(box.xyxyn, imageInfo);

            return (
              <div
                key={`object-overlay-${objectIndex}-${boxIndex}`}
                data-testid="object-overlay-box"
                className="absolute pointer-events-none opacity-90"
                style={{
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  ...hairlineStroke({ color: object.color, width: 1, scale: strokeScale }),
                }}
              >
                <div
                  className="absolute -top-5 left-0 text-white text-[10px] px-1 rounded whitespace-nowrap"
                  style={{ backgroundColor: object.color }}
                >
                  {object.label}
                </div>
              </div>
            );
          })
          .filter(Boolean)
      )}
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
  /**
   * Overrides the smoke-type colour. The localize object editor colours a box
   * by its SOURCE instead: an object has one smoke type across every frame,
   * so smoke type says nothing that varies here, while the source does.
   */
  boxColor?: string;
  /** Stroke width in screen px, when `boxColor` is driving the stroke. */
  boxWidth?: number;
  /**
   * The zoom this overlay is rendered inside. Stroke widths and handle sizes
   * are divided by it, so they stay the same thickness on screen however far
   * the image is zoomed — otherwise a 4px stroke is drawn at 12px at 3x.
   */
  strokeScale?: number;
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
  boxColor,
  boxWidth,
  strokeScale = 1,
}: DrawingOverlayProps) {
  // Handles are squares in screen pixels; at 3x an unscaled 10px handle would
  // cover the box it is meant to grab.
  const handleSize = 10 / strokeScale;
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
        transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
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
            data-testid={`drawn-box-${rect.id}`}
            // Always wired, not just when selected: the click that SELECTS a
            // box has to reach it, and the consumer decides whether a given
            // press means "select me" or "start dragging me".
            onMouseDown={onBoxPointerDown ? e => onBoxPointerDown(rect.id, e) : undefined}
            // Selection reads from the handles and the heavier stroke, not
            // from a colour change: the box's colour is carrying meaning
            // already, and overriding it to signal a UI state would hide
            // what the box is.
            className={`absolute pointer-events-auto ${boxColor ? '' : colors.border} ${
              boxColor ? '' : isSelected ? 'border-[3px]' : 'border-2'
            } ${isSelected ? 'cursor-move' : 'cursor-pointer'}`}
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
              ...(boxColor
                ? // Painted, not laid out — a CSS border cannot go below
                  // `strokeScale` device px. See `hairlineStroke`.
                  hairlineStroke({
                    color: boxColor,
                    // Selection thickens the stroke rather than recolouring
                    // it: the colour is carrying the box's source already.
                    // One px, not two — the resize handles are the loud part
                    // of the selected state, and on a small box a heavier
                    // bump swallows the thing being annotated.
                    width: (boxWidth ?? 2) + (isSelected ? 1 : 0),
                    scale: strokeScale,
                  })
                : {}),
            }}
          >
            {/* Resize handles on the selected box */}
            {isSelected &&
              onHandlePointerDown &&
              (Object.keys(HANDLE_CURSOR) as ResizeHandle[]).map(handle => (
                <div
                  key={handle}
                  data-testid={`resize-handle-${handle}`}
                  onMouseDown={e => onHandlePointerDown(rect.id, handle, e)}
                  className="absolute bg-paper pointer-events-auto"
                  style={{
                    ...handleStyle(handle, handleSize),
                    border: `${2 / strokeScale}px solid #20261F`,
                    cursor: HANDLE_CURSOR[handle],
                  }}
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
              data-testid="drawing-rubber-band"
              className="absolute pointer-events-none"
              style={{
                // Divided by the zoom like every other stroke in this layer.
                // It was authored in flat CSS pixels, so it drew at 8px at 4x
                // — thickest exactly when you are zoomed in to trace a small
                // smoke, and covering the pixels you are aiming at.
                ...hairlineStroke({ color: '#60A5FA', width: 1, scale: strokeScale }),
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
