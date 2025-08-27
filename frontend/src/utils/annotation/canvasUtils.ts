/**
 * Pure utility functions for canvas operations.
 * These functions handle canvas-specific calculations and transformations.
 */

import { Point } from './coordinateUtils';

/**
 * Zoom configuration for canvas operations.
 */
export interface ZoomConfig {
  currentZoom: number;
  minZoom: number;
  maxZoom: number;
  zoomStep: number;
}

/**
 * Pan offset constraints based on zoom level and container dimensions.
 */
export interface PanConstraints {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Calculates the new zoom level based on wheel delta.
 *
 * @param currentZoom - Current zoom level
 * @param wheelDelta - Mouse wheel delta value
 * @param config - Zoom configuration with min/max bounds
 * @returns New zoom level clamped to bounds
 *
 * @example
 * ```typescript
 * const newZoom = calculateZoomLevel(1.5, -100, {
 *   currentZoom: 1.5,
 *   minZoom: 1.0,
 *   maxZoom: 5.0,
 *   zoomStep: 0.1
 * });
 * // Returns: 1.6 (zoomed in by 0.1)
 * ```
 */
export const calculateZoomLevel = (
  currentZoom: number,
  wheelDelta: number,
  config: Partial<ZoomConfig> = {}
): number => {
  const { minZoom = 1.0, maxZoom = 5.0, zoomStep = 0.1 } = config;

  // Negative delta = zoom in, positive delta = zoom out
  const direction = wheelDelta > 0 ? -1 : 1;
  const newZoom = currentZoom + direction * zoomStep;

  // Clamp to bounds
  return Math.max(minZoom, Math.min(maxZoom, newZoom));
};

/**
 * Calculates transform origin based on mouse position relative to element.
 *
 * @param mouseX - Mouse X position relative to element
 * @param mouseY - Mouse Y position relative to element
 * @param elementWidth - Element width in pixels
 * @param elementHeight - Element height in pixels
 * @returns Transform origin as percentages
 *
 * @example
 * ```typescript
 * const origin = calculateTransformOrigin(400, 300, 800, 600);
 * // Returns: { x: 50, y: 50 } (center of element)
 * ```
 */
export const calculateTransformOrigin = (
  mouseX: number,
  mouseY: number,
  elementWidth: number,
  elementHeight: number
): Point => {
  const originX = elementWidth > 0 ? (mouseX / elementWidth) * 100 : 50;
  const originY = elementHeight > 0 ? (mouseY / elementHeight) * 100 : 50;

  return {
    x: Math.max(0, Math.min(100, originX)),
    y: Math.max(0, Math.min(100, originY)),
  };
};

/**
 * Calculates pan constraints based on zoom level and container dimensions.
 *
 * @param zoomLevel - Current zoom level
 * @param imageWidth - Image width in pixels
 * @param imageHeight - Image height in pixels
 * @param containerWidth - Container width in pixels
 * @param containerHeight - Container height in pixels
 * @returns Pan constraints for x and y axes
 *
 * @example
 * ```typescript
 * const constraints = calculatePanConstraints(2.0, 800, 600, 400, 300);
 * // Returns constraints for panning at 2x zoom
 * ```
 */
export const calculatePanConstraints = (
  zoomLevel: number,
  imageWidth: number,
  imageHeight: number,
  containerWidth: number = imageWidth,
  containerHeight: number = imageHeight
): PanConstraints => {
  if (zoomLevel <= 1) {
    // No panning when not zoomed
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  const scaledWidth = imageWidth * zoomLevel;
  const scaledHeight = imageHeight * zoomLevel;
  const maxPanX = Math.max(0, (scaledWidth - containerWidth) / 2);
  const maxPanY = Math.max(0, (scaledHeight - containerHeight) / 2);

  return {
    minX: -maxPanX,
    maxX: maxPanX,
    minY: -maxPanY,
    maxY: maxPanY,
  };
};

/**
 * Constrains a pan offset to valid bounds based on zoom level.
 *
 * @param offset - Desired pan offset
 * @param constraints - Pan constraints
 * @returns Constrained pan offset
 *
 * @example
 * ```typescript
 * const constrained = constrainPan(
 *   { x: 500, y: 300 },
 *   { minX: -200, maxX: 200, minY: -100, maxY: 100 }
 * );
 * // Returns: { x: 200, y: 100 } (clamped to max bounds)
 * ```
 */
export const constrainPan = (offset: Point, constraints: PanConstraints): Point => {
  return {
    x: Math.max(constraints.minX, Math.min(constraints.maxX, offset.x)),
    y: Math.max(constraints.minY, Math.min(constraints.maxY, offset.y)),
  };
};

/**
 * Checks if a point is within canvas bounds.
 *
 * @param point - Point to check
 * @param canvasWidth - Canvas width
 * @param canvasHeight - Canvas height
 * @returns True if point is within canvas
 *
 * @example
 * ```typescript
 * const isInside = isWithinCanvas({ x: 400, y: 300 }, 800, 600);
 * // Returns: true
 * ```
 */
export const isWithinCanvas = (
  point: Point,
  canvasWidth: number,
  canvasHeight: number
): boolean => {
  return point.x >= 0 && point.x <= canvasWidth && point.y >= 0 && point.y <= canvasHeight;
};

/**
 * Calculates the minimum size threshold for drawable rectangles.
 *
 * @param canvasWidth - Canvas width in pixels
 * @param minPixelSize - Minimum size in pixels (default: 10)
 * @returns Normalized threshold value
 *
 * @example
 * ```typescript
 * const threshold = calculateSizeThreshold(1000, 10);
 * // Returns: 0.01 (10 pixels / 1000 width)
 * ```
 */
export const calculateSizeThreshold = (canvasWidth: number, minPixelSize: number = 10): number => {
  return canvasWidth > 0 ? minPixelSize / canvasWidth : 0.01;
};

/**
 * Calculates mouse position relative to an element.
 *
 * @param clientX - Mouse client X position
 * @param clientY - Mouse client Y position
 * @param elementRect - Element bounding rectangle
 * @returns Position relative to element
 *
 * @example
 * ```typescript
 * const rect = element.getBoundingClientRect();
 * const relativePos = getMouseRelativeToElement(500, 300, rect);
 * ```
 */
export const getMouseRelativeToElement = (
  clientX: number,
  clientY: number,
  elementRect: DOMRect
): Point => {
  return {
    x: clientX - elementRect.left,
    y: clientY - elementRect.top,
  };
};

/**
 * Checks if drawing dimensions are valid (above minimum threshold).
 *
 * @param startX - Starting X coordinate
 * @param startY - Starting Y coordinate
 * @param endX - Ending X coordinate
 * @param endY - Ending Y coordinate
 * @param threshold - Minimum size threshold
 * @returns True if dimensions are valid
 *
 * @example
 * ```typescript
 * const isValid = isValidDrawingSize(0.1, 0.2, 0.8, 0.9, 0.01);
 * // Returns: true (both dimensions > 0.01)
 * ```
 */
export const isValidDrawingSize = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold: number
): boolean => {
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  return width > threshold && height > threshold;
};

/**
 * Calculates canvas scale factor for high DPI displays.
 *
 * @param devicePixelRatio - Device pixel ratio (default: window.devicePixelRatio)
 * @returns Scale factor for canvas rendering
 *
 * @example
 * ```typescript
 * const scale = getCanvasScale(2.0);
 * // Returns: 2.0 (for retina displays)
 * ```
 */
export const getCanvasScale = (devicePixelRatio: number = 1): number => {
  return Math.max(1, devicePixelRatio);
};
