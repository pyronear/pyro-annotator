/**
 * Pure drawing utilities for annotation canvas operations.
 * These functions handle drawing rectangle creation, validation, and transformations.
 */

import { SmokeType } from '@/types/api';
import { Point, ImageBounds } from './coordinateUtils';

/**
 * Represents a completed drawn rectangle annotation.
 */
export interface DrawnRectangle {
  id: string;
  xyxyn: [number, number, number, number]; // normalized coordinates
  smokeType: SmokeType;
}

/**
 * Represents the current drawing state while user is actively drawing.
 */
export interface CurrentDrawing {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

/**
 * Color scheme for different smoke types.
 */
export interface SmokeTypeColors {
  border: string;
  background: string;
}

/**
 * Drawing interaction mode.
 */
export type DrawingMode = 'view' | 'draw' | 'select';

/**
 * Gets the color scheme for a specific smoke type.
 *
 * @param smokeType - The smoke type to get colors for
 * @returns Color configuration for borders and backgrounds
 *
 * @example
 * ```typescript
 * const colors = getSmokeTypeColors('wildfire');
 * // Returns: { border: 'border-red-500', background: 'bg-red-500/15' }
 * ```
 */
export const getSmokeTypeColors = (smokeType: SmokeType): SmokeTypeColors => {
  switch (smokeType) {
    case 'wildfire':
      return { border: 'border-red-500', background: 'bg-red-500/15' };
    case 'industrial':
      return { border: 'border-purple-500', background: 'bg-purple-500/15' };
    case 'other':
      return { border: 'border-blue-500', background: 'bg-blue-500/15' };
    default:
      return { border: 'border-green-500', background: 'bg-green-500/10' };
  }
};

/**
 * Creates a new DrawnRectangle from current drawing state.
 *
 * @param drawing - The current drawing state
 * @param imageBounds - Image bounds for coordinate normalization
 * @param smokeType - Smoke type to assign to the rectangle
 * @returns A new DrawnRectangle with normalized coordinates
 *
 * @example
 * ```typescript
 * const rect = createDrawnRectangle(
 *   { startX: 100, startY: 200, currentX: 300, currentY: 400 },
 *   { width: 800, height: 600, x: 0, y: 0 },
 *   'wildfire'
 * );
 * ```
 */
export const createDrawnRectangle = (
  drawing: CurrentDrawing,
  imageBounds: ImageBounds,
  smokeType: SmokeType
): DrawnRectangle => {
  const minX = Math.min(drawing.startX, drawing.currentX);
  const minY = Math.min(drawing.startY, drawing.currentY);
  const maxX = Math.max(drawing.startX, drawing.currentX);
  const maxY = Math.max(drawing.startY, drawing.currentY);

  // Normalize coordinates
  const x1 = Math.max(0, Math.min(1, minX / imageBounds.width));
  const y1 = Math.max(0, Math.min(1, minY / imageBounds.height));
  const x2 = Math.max(0, Math.min(1, maxX / imageBounds.width));
  const y2 = Math.max(0, Math.min(1, maxY / imageBounds.height));

  return {
    id: Date.now().toString(),
    xyxyn: [x1, y1, x2, y2],
    smokeType,
  };
};

/**
 * Validates that a drawing has minimum dimensions.
 *
 * @param drawing - The current drawing state
 * @param minSize - Minimum size in pixels (default: 10)
 * @returns True if the drawing is large enough to be valid
 *
 * @example
 * ```typescript
 * const isValid = validateDrawingSize(
 *   { startX: 100, startY: 100, currentX: 150, currentY: 150 }
 * ); // true (50x50 pixels)
 * ```
 */
export const validateDrawingSize = (drawing: CurrentDrawing, minSize: number = 10): boolean => {
  const width = Math.abs(drawing.currentX - drawing.startX);
  const height = Math.abs(drawing.currentY - drawing.startY);

  return width >= minSize && height >= minSize;
};

/**
 * Checks if a point is inside a rectangle.
 *
 * @param point - Point to check
 * @param rectangle - Rectangle in image coordinates
 * @param imageBounds - Image bounds for coordinate conversion
 * @returns True if the point is inside the rectangle
 *
 * @example
 * ```typescript
 * const isInside = isPointInRectangle(
 *   { x: 150, y: 250 },
 *   { id: '1', xyxyn: [0.1, 0.2, 0.8, 0.9], smokeType: 'wildfire' },
 *   { width: 800, height: 600, x: 0, y: 0 }
 * );
 * ```
 */
export const isPointInRectangle = (
  point: Point,
  rectangle: DrawnRectangle,
  imageBounds: ImageBounds
): boolean => {
  const [x1, y1, x2, y2] = rectangle.xyxyn;

  // Convert normalized coordinates to image coordinates
  const left = x1 * imageBounds.width;
  const top = y1 * imageBounds.height;
  const right = x2 * imageBounds.width;
  const bottom = y2 * imageBounds.height;

  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
};

/**
 * Finds the topmost rectangle at a given point.
 * Searches in reverse order (newest/topmost first).
 *
 * @param point - Point to check
 * @param rectangles - Array of rectangles to search
 * @param imageBounds - Image bounds for coordinate conversion
 * @returns The rectangle at the point, or null if none found
 *
 * @example
 * ```typescript
 * const rect = getRectangleAtPoint(
 *   { x: 150, y: 250 },
 *   rectangles,
 *   imageBounds
 * );
 * ```
 */
export const getRectangleAtPoint = (
  point: Point,
  rectangles: DrawnRectangle[],
  imageBounds: ImageBounds
): DrawnRectangle | null => {
  // Check rectangles in reverse order (topmost/newest first)
  for (let i = rectangles.length - 1; i >= 0; i--) {
    if (isPointInRectangle(point, rectangles[i], imageBounds)) {
      return rectangles[i];
    }
  }
  return null;
};

/**
 * Updates the smoke type of a specific rectangle.
 *
 * @param rectangles - Array of rectangles
 * @param rectangleId - ID of rectangle to update
 * @param newSmokeType - New smoke type to assign
 * @returns New array with updated rectangle
 *
 * @example
 * ```typescript
 * const updated = updateRectangleSmokeType(
 *   rectangles,
 *   'rect-123',
 *   'industrial'
 * );
 * ```
 */
export const updateRectangleSmokeType = (
  rectangles: DrawnRectangle[],
  rectangleId: string,
  newSmokeType: SmokeType
): DrawnRectangle[] => {
  return rectangles.map(rect =>
    rect.id === rectangleId ? { ...rect, smokeType: newSmokeType } : rect
  );
};

/**
 * Removes a rectangle by ID.
 *
 * @param rectangles - Array of rectangles
 * @param rectangleId - ID of rectangle to remove
 * @returns New array without the specified rectangle
 *
 * @example
 * ```typescript
 * const remaining = removeRectangle(rectangles, 'rect-123');
 * ```
 */
export const removeRectangle = (
  rectangles: DrawnRectangle[],
  rectangleId: string
): DrawnRectangle[] => {
  return rectangles.filter(rect => rect.id !== rectangleId);
};

/**
 * Converts API predictions to drawn rectangles.
 *
 * @param predictions - Array of algorithm predictions with xyxyn coordinates
 * @param smokeType - Smoke type to assign to imported rectangles
 * @param existingRectangles - Optional array of existing rectangles to check for duplicates
 * @param duplicateThreshold - Threshold for considering rectangles duplicate (default: 0.05)
 * @returns Array of new DrawnRectangle objects
 *
 * @example
 * ```typescript
 * const imported = importPredictionsAsRectangles(
 *   predictions,
 *   'wildfire',
 *   existingRectangles
 * );
 * ```
 */
export const importPredictionsAsRectangles = (
  predictions: Array<{ xyxyn: [number, number, number, number] }>,
  smokeType: SmokeType,
  existingRectangles: DrawnRectangle[] = [],
  duplicateThreshold: number = 0.05
): DrawnRectangle[] => {
  const newRectangles: DrawnRectangle[] = [];

  predictions.forEach((pred, index) => {
    // Check for duplicates
    const isDuplicate = existingRectangles.some(existing =>
      areBoundingBoxesSimilar(existing.xyxyn, pred.xyxyn, duplicateThreshold)
    );

    if (!isDuplicate) {
      newRectangles.push({
        id: `imported-${Date.now()}-${index}`,
        xyxyn: pred.xyxyn,
        smokeType,
      });
    }
  });

  return newRectangles;
};

/**
 * Checks if two bounding boxes are similar within a threshold.
 *
 * @param bbox1 - First bounding box
 * @param bbox2 - Second bounding box
 * @param threshold - Similarity threshold (default: 0.05)
 * @returns True if bounding boxes are similar
 *
 * @example
 * ```typescript
 * const similar = areBoundingBoxesSimilar(
 *   [0.1, 0.2, 0.8, 0.9],
 *   [0.12, 0.21, 0.82, 0.88],
 *   0.05
 * ); // true
 * ```
 */
export const areBoundingBoxesSimilar = (
  bbox1: [number, number, number, number],
  bbox2: [number, number, number, number],
  threshold: number = 0.05
): boolean => {
  const [x1_1, y1_1, x2_1, y2_1] = bbox1;
  const [x1_2, y1_2, x2_2, y2_2] = bbox2;

  return (
    Math.abs(x1_1 - x1_2) < threshold &&
    Math.abs(y1_1 - y1_2) < threshold &&
    Math.abs(x2_1 - x2_2) < threshold &&
    Math.abs(y2_1 - y2_2) < threshold
  );
};

/**
 * Calculates drawing statistics.
 *
 * @param rectangles - Array of drawn rectangles
 * @returns Statistics object with counts by smoke type
 *
 * @example
 * ```typescript
 * const stats = calculateDrawingStats(rectangles);
 * // Returns: { total: 5, wildfire: 3, industrial: 1, other: 1 }
 * ```
 */
export const calculateDrawingStats = (rectangles: DrawnRectangle[]) => {
  const stats = {
    total: rectangles.length,
    wildfire: 0,
    industrial: 0,
    other: 0,
  };

  rectangles.forEach(rect => {
    stats[rect.smokeType]++;
  });

  return stats;
};
