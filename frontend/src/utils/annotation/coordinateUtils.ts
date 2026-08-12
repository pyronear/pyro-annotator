/**
 * Pure coordinate transformation utilities for annotation canvas.
 * These functions handle conversion between different coordinate systems:
 * - Screen coordinates (mouse position relative to viewport)
 * - Image coordinates (pixels within the displayed image)
 * - Normalized coordinates (0-1 range for storage)
 */

import type { StageView } from './stageViewUtils';

/**
 * Configuration for image display within a container using object-contain behavior.
 */
export interface ImageContainConfig {
  containerWidth: number;
  containerHeight: number;
  imageNaturalWidth: number;
  imageNaturalHeight: number;
}

/**
 * Calculated dimensions and position for an image within its container.
 */
export interface ImageBounds {
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Point in 2D coordinate space.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Calculates the bounds of an image displayed with object-contain behavior.
 * This is a pure function that determines how an image fits within its container.
 *
 * @param config - Container and image dimensions
 * @returns The calculated image bounds within the container
 *
 * @example
 * ```typescript
 * const bounds = calculateImageBounds({
 *   containerWidth: 800,
 *   containerHeight: 600,
 *   imageNaturalWidth: 1920,
 *   imageNaturalHeight: 1080
 * });
 * // Returns: { width: 800, height: 450, x: 0, y: 75 }
 * ```
 */
export const calculateImageBounds = (config: ImageContainConfig): ImageBounds => {
  const { containerWidth, containerHeight, imageNaturalWidth, imageNaturalHeight } = config;

  const imgAspectRatio = imageNaturalWidth / imageNaturalHeight;
  const containerAspectRatio = containerWidth / containerHeight;

  if (imgAspectRatio > containerAspectRatio) {
    // Image is wider - fit to width
    const width = containerWidth;
    const height = containerWidth / imgAspectRatio;
    const x = 0;
    const y = (containerHeight - height) / 2;

    return { width, height, x, y };
  } else {
    // Image is taller - fit to height
    const width = containerHeight * imgAspectRatio;
    const height = containerHeight;
    const x = (containerWidth - width) / 2;
    const y = 0;

    return { width, height, x, y };
  }
};

/**
 * Converts screen coordinates to image coordinates, accounting for zoom and pan transforms.
 * This is the inverse of the CSS transform applied to the image.
 *
 * @param screenPoint - Point in screen/viewport coordinates
 * @param containerOffset - Container's position relative to viewport
 * @param imageBounds - Calculated image bounds within container
 * @param view - Current stage view: scale, plus pan as a fraction of the image
 * @returns Point in image coordinate space
 *
 * @example
 * ```typescript
 * const imagePoint = screenToImageCoordinates(
 *   { x: 400, y: 300 },
 *   { x: 100, y: 50 },
 *   { width: 800, height: 600, x: 0, y: 0 },
 *   { scale: 2.0, pan: { x: 0.1, y: 0.05 } }
 * );
 * ```
 */
export const screenToImageCoordinates = (
  screenPoint: Point,
  containerOffset: Point,
  imageBounds: ImageBounds,
  view: StageView
): Point => {
  const { scale, pan } = view;

  // Get mouse position relative to container
  const relativeX = screenPoint.x - containerOffset.x;
  const relativeY = screenPoint.y - containerOffset.y;

  // The transform origin is the image's centre, always — the stage keeps all
  // its framing in the pan, which is a fraction of the image's rendered size
  // and applies INSIDE the scale. Inverting s(p) = O + z*((p - O) + t*W):
  //   p = (X - O)/z + W/2 - t*W
  const originContainerX = imageBounds.x + imageBounds.width / 2;
  const originContainerY = imageBounds.y + imageBounds.height / 2;

  return {
    x: (relativeX - originContainerX) / scale + imageBounds.width / 2 - pan.x * imageBounds.width,
    y: (relativeY - originContainerY) / scale + imageBounds.height / 2 - pan.y * imageBounds.height,
  };
};

/**
 * Converts image coordinates to normalized coordinates (0-1 range).
 * Normalized coordinates are used for storage and are independent of display size.
 *
 * @param imagePoint - Point in image coordinate space
 * @param imageBounds - Current image bounds within container
 * @returns Point in normalized coordinate space (clamped to 0-1)
 *
 * @example
 * ```typescript
 * const normalized = imageToNormalizedCoordinates(
 *   { x: 400, y: 300 },
 *   { width: 800, height: 600, x: 0, y: 0 }
 * );
 * // Returns: { x: 0.5, y: 0.5 }
 * ```
 */
export const imageToNormalizedCoordinates = (
  imagePoint: Point,
  imageBounds: ImageBounds
): Point => {
  return {
    x: Math.max(0, Math.min(1, imagePoint.x / imageBounds.width)),
    y: Math.max(0, Math.min(1, imagePoint.y / imageBounds.height)),
  };
};

/**
 * Converts normalized coordinates (0-1 range) to image coordinates.
 * This is the inverse of imageToNormalizedCoordinates.
 *
 * @param normalizedPoint - Point in normalized coordinate space
 * @param imageBounds - Current image bounds within container
 * @returns Point in image coordinate space
 *
 * @example
 * ```typescript
 * const imagePoint = normalizedToImageCoordinates(
 *   { x: 0.5, y: 0.5 },
 *   { width: 800, height: 600, x: 0, y: 0 }
 * );
 * // Returns: { x: 400, y: 300 }
 * ```
 */
export const normalizedToImageCoordinates = (
  normalizedPoint: Point,
  imageBounds: ImageBounds
): Point => {
  return {
    x: normalizedPoint.x * imageBounds.width,
    y: normalizedPoint.y * imageBounds.height,
  };
};

/**
 * Converts normalized bounding box coordinates to pixel coordinates for display.
 *
 * @param xyxyn - Normalized bounding box [x1, y1, x2, y2]
 * @param imageBounds - Current image bounds within container
 * @returns Pixel coordinates for rendering { x, y, width, height }
 *
 * @example
 * ```typescript
 * const pixels = normalizedBboxToPixels(
 *   [0.1, 0.2, 0.8, 0.9],
 *   { width: 1000, height: 800, x: 0, y: 0 }
 * );
 * // Returns: { x: 100, y: 160, width: 700, height: 560 }
 * ```
 */
export const normalizedBboxToPixels = (
  xyxyn: [number, number, number, number],
  imageBounds: ImageBounds
) => {
  const [x1, y1, x2, y2] = xyxyn;

  return {
    x: x1 * imageBounds.width,
    y: y1 * imageBounds.height,
    width: (x2 - x1) * imageBounds.width,
    height: (y2 - y1) * imageBounds.height,
  };
};

/**
 * Validates that a bounding box has valid coordinates.
 *
 * @param bbox - Bounding box in xyxyn format
 * @returns True if the bounding box is valid
 *
 * @example
 * ```typescript
 * const isValid = validateBoundingBox([0.1, 0.2, 0.8, 0.9]); // true
 * const isInvalid = validateBoundingBox([0.8, 0.2, 0.1, 0.9]); // false (x2 < x1)
 * ```
 */
export const validateBoundingBox = (bbox: [number, number, number, number]): boolean => {
  const [x1, y1, x2, y2] = bbox;

  // Check that coordinates are in valid range
  if (x1 < 0 || x1 > 1 || y1 < 0 || y1 > 1 || x2 < 0 || x2 > 1 || y2 < 0 || y2 > 1) {
    return false;
  }

  // Check that x2 > x1 and y2 > y1 (positive width/height)
  if (x2 <= x1 || y2 <= y1) {
    return false;
  }

  return true;
};

/**
 * Calculates the area of a normalized bounding box.
 *
 * @param bbox - Bounding box in xyxyn format
 * @returns Area as a value between 0 and 1
 *
 * @example
 * ```typescript
 * const area = calculateBoundingBoxArea([0.1, 0.2, 0.8, 0.9]); // 0.49 (70% width × 70% height)
 * ```
 */
export const calculateBoundingBoxArea = (bbox: [number, number, number, number]): number => {
  const [x1, y1, x2, y2] = bbox;
  return Math.max(0, (x2 - x1) * (y2 - y1));
};

/**
 * Image positioning information for overlay calculations.
 */
export interface ImageInfo {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Converts normalized bounding box coordinates to pixel coordinates for overlay rendering.
 * Includes offset calculations for proper positioning within the container.
 *
 * @param xyxyn - Normalized coordinates [x1, y1, x2, y2]
 * @param imageInfo - Image positioning information including offsets
 * @returns Pixel coordinates and dimensions for CSS positioning
 *
 * @example
 * ```typescript
 * const pixelBox = normalizedToPixelBox([0.1, 0.2, 0.8, 0.9], {
 *   width: 500, height: 400, offsetX: 50, offsetY: 25
 * });
 * // Returns: { left: 100, top: 105, width: 350, height: 280 }
 * ```
 */
export const normalizedToPixelBox = (
  xyxyn: [number, number, number, number],
  imageInfo: ImageInfo
): { left: number; top: number; width: number; height: number } => {
  const [x1, y1, x2, y2] = xyxyn;

  return {
    left: imageInfo.offsetX + x1 * imageInfo.width,
    top: imageInfo.offsetY + y1 * imageInfo.height,
    width: (x2 - x1) * imageInfo.width,
    height: (y2 - y1) * imageInfo.height,
  };
};
