/**
 * Pure component for rendering user-drawn rectangles and current drawing state
 * 
 * This component displays drawing rectangles with proper transformations and styling.
 * It uses pure calculation functions for coordinate transformations.
 */

import { SmokeType } from '@/types/api';
import { getSmokeTypeColors } from '@/utils/smoke-type-colors';
import { normalizedToImage } from '@/utils/coordinate-transforms';
import { ImageInfo, Transform } from '@/utils/coordinate-transforms';

/**
 * Drawn rectangle with smoke type classification
 */
export interface DrawnRectangle {
  readonly id: string;
  readonly xyxyn: readonly [number, number, number, number];
  readonly smokeType: SmokeType;
}

/**
 * Current drawing state during rectangle creation
 */
export interface CurrentDrawing {
  readonly startX: number;
  readonly startY: number;
  readonly currentX: number;
  readonly currentY: number;
}

/**
 * Props for the DrawingOverlay component
 */
export interface DrawingOverlayProps {
  /** Array of completed drawn rectangles */
  readonly drawnRectangles: readonly DrawnRectangle[];
  /** Current drawing state, or null if not drawing */
  readonly currentDrawing: CurrentDrawing | null;
  /** ID of currently selected rectangle */
  readonly selectedRectangleId: string | null;
  /** Image dimension and positioning information */
  readonly imageInfo: ImageInfo;
  /** Current zoom and pan transformation state */
  readonly transform: Transform;
  /** Whether the view is currently being dragged */
  readonly isDragging: boolean;
  /** Optional CSS class name for styling */
  readonly className?: string;
}

/**
 * Props for individual rectangle rendering
 */
interface RectangleProps {
  readonly rectangle: DrawnRectangle;
  readonly imageInfo: ImageInfo;
  readonly transform: Transform;
  readonly isSelected: boolean;
}

/**
 * Props for current drawing preview rendering
 */
interface CurrentDrawingProps {
  readonly drawing: CurrentDrawing;
  readonly imageInfo: ImageInfo;
  readonly transform: Transform;
}

/**
 * Calculates pixel bounds for a completed rectangle using pure coordinate transformation
 * 
 * @pure Function has no side effects
 */
const calculateCompletedRectangleBounds = (
  rectangle: DrawnRectangle,
  imageInfo: ImageInfo,
  transform: Transform
): { left: number; top: number; width: number; height: number } => {
  const [x1, y1, x2, y2] = rectangle.xyxyn;
  
  // Convert normalized coordinates to image coordinates
  const topLeftImg = normalizedToImage(x1, y1, 
    { width: imageInfo.width, height: imageInfo.height },
    { width: imageInfo.width, height: imageInfo.height } // Assuming square aspect for simplicity
  );
  const bottomRightImg = normalizedToImage(x2, y2,
    { width: imageInfo.width, height: imageInfo.height },
    { width: imageInfo.width, height: imageInfo.height }
  );
  
  return {
    left: imageInfo.offsetX + topLeftImg.x,
    top: imageInfo.offsetY + topLeftImg.y,
    width: bottomRightImg.x - topLeftImg.x,
    height: bottomRightImg.y - topLeftImg.y
  };
};

/**
 * Calculates pixel bounds for current drawing using image coordinates
 * 
 * @pure Function has no side effects
 */
const calculateCurrentDrawingBounds = (
  drawing: CurrentDrawing,
  imageInfo: ImageInfo
): { left: number; top: number; width: number; height: number } => {
  const minX = Math.min(drawing.startX, drawing.currentX);
  const minY = Math.min(drawing.startY, drawing.currentY);
  const maxX = Math.max(drawing.startX, drawing.currentX);
  const maxY = Math.max(drawing.startY, drawing.currentY);
  
  return {
    left: imageInfo.offsetX + minX,
    top: imageInfo.offsetY + minY,
    width: maxX - minX,
    height: maxY - minY
  };
};

/**
 * Pure component for rendering a completed rectangle
 * 
 * @pure Component has no side effects and renders consistently for the same props
 */
const CompletedRectangle = ({ rectangle, imageInfo, transform, isSelected }: RectangleProps) => {
  const bounds = calculateCompletedRectangleBounds(rectangle, imageInfo, transform);
  
  // Skip rendering if bounds are invalid
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }
  
  // Get colors for this smoke type using pure function
  const colors = getSmokeTypeColors(rectangle.smokeType);
  const borderColor = isSelected ? 'border-yellow-400' : colors.border;
  const backgroundColor = isSelected ? 'bg-yellow-400/25' : colors.background;
  const borderWidth = isSelected ? 'border-4' : 'border-2';
  
  return (
    <div
      className={`absolute ${borderWidth} ${borderColor} ${backgroundColor} pointer-events-auto cursor-pointer hover:brightness-110 transition-all duration-150`}
      style={{
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }}
      title="Click to select rectangle"
    />
  );
};

/**
 * Pure component for rendering current drawing preview
 * 
 * @pure Component has no side effects and renders consistently for the same props
 */
const CurrentDrawingPreview = ({ drawing, imageInfo, transform }: CurrentDrawingProps) => {
  const bounds = calculateCurrentDrawingBounds(drawing, imageInfo);
  
  // Skip rendering if bounds are invalid
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }
  
  return (
    <div
      className="absolute border-2 border-green-500 bg-green-500/10 pointer-events-none"
      style={{
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }}
    />
  );
};

/**
 * Component for rendering drawing overlays including completed rectangles and current drawing
 * 
 * This component displays user-drawn rectangles with appropriate styling based on selection state
 * and smoke type. It also shows a preview of the current drawing operation if active.
 * 
 * The component applies zoom and pan transformations to maintain correct positioning
 * during user interactions.
 * 
 * @example
 * <DrawingOverlay
 *   drawnRectangles={rectangles}
 *   currentDrawing={drawingState}
 *   selectedRectangleId="rect-123"
 *   imageInfo={{ width: 800, height: 600, offsetX: 10, offsetY: 5 }}
 *   transform={{ zoomLevel: 1.5, panOffset: { x: 0, y: 0 }, transformOrigin: { x: 50, y: 50 } }}
 *   isDragging={false}
 * />
 */
const DrawingOverlay = ({ 
  drawnRectangles, 
  currentDrawing, 
  selectedRectangleId,
  imageInfo, 
  transform, 
  isDragging,
  className = ''
}: DrawingOverlayProps) => {
  return (
    <div 
      className={`absolute inset-0 pointer-events-none z-20 ${className}`}
      style={{
        transform: `scale(${transform.zoomLevel}) translate(${transform.panOffset.x}px, ${transform.panOffset.y}px)`,
        transformOrigin: `${transform.transformOrigin.x}% ${transform.transformOrigin.y}%`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out'
      }}
    >
      {/* Completed rectangles */}
      {drawnRectangles.map(rectangle => (
        <CompletedRectangle
          key={rectangle.id}
          rectangle={rectangle}
          imageInfo={imageInfo}
          transform={transform}
          isSelected={selectedRectangleId === rectangle.id}
        />
      ))}
      
      {/* Current drawing rectangle */}
      {currentDrawing && (
        <CurrentDrawingPreview
          drawing={currentDrawing}
          imageInfo={imageInfo}
          transform={transform}
        />
      )}
    </div>
  );
};

export default DrawingOverlay;