/**
 * Pure bounding box calculation utilities
 * 
 * This module provides referentially transparent functions for calculating
 * pixel positions, dimensions, and transformations of bounding boxes.
 */

import { NormalizedCoordinates, PixelCoordinates, ImageInfo } from './coordinate-transforms';

/**
 * Normalized bounding box (0-1 coordinate range)
 */
export interface NormalizedBbox {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Pixel-based bounding box
 */
export interface PixelBbox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Extended pixel bounding box with additional properties
 */
export interface ExtendedPixelBbox extends PixelBbox {
  readonly right: number;
  readonly bottom: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly area: number;
}

/**
 * Point coordinates
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Rectangle defined by two points
 */
export interface Rectangle {
  readonly topLeft: Point;
  readonly bottomRight: Point;
}

/**
 * Converts normalized bounding box coordinates to pixel coordinates
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param normalizedBbox - Bounding box with coordinates in 0-1 range
 * @param imageInfo - Image dimension and position information
 * 
 * @returns Pixel coordinates and dimensions of the bounding box
 * 
 * @example
 * const bbox = { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }
 * const imageInfo = { width: 800, height: 600, offsetX: 10, offsetY: 5 }
 * const pixelBounds = calculatePixelBounds(bbox, imageInfo)
 * // Result: { left: 90, top: 125, width: 560, height: 300 }
 */
export const calculatePixelBounds = (
  normalizedBbox: NormalizedBbox,
  imageInfo: ImageInfo
): PixelBbox => {
  const left = imageInfo.offsetX + (normalizedBbox.x1 * imageInfo.width);
  const top = imageInfo.offsetY + (normalizedBbox.y1 * imageInfo.height);
  const width = (normalizedBbox.x2 - normalizedBbox.x1) * imageInfo.width;
  const height = (normalizedBbox.y2 - normalizedBbox.y1) * imageInfo.height;
  
  return {
    left,
    top,
    width,
    height
  };
};

/**
 * Converts pixel bounding box to normalized coordinates
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param pixelBbox - Pixel-based bounding box
 * @param imageInfo - Image dimension and position information
 * 
 * @returns Normalized bounding box coordinates
 * 
 * @example
 * const pixelBox = { left: 90, top: 125, width: 560, height: 300 }
 * const imageInfo = { width: 800, height: 600, offsetX: 10, offsetY: 5 }
 * const normalized = pixelBoundsToNormalized(pixelBox, imageInfo)
 * // Result: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }
 */
export const pixelBoundsToNormalized = (
  pixelBbox: PixelBbox,
  imageInfo: ImageInfo
): NormalizedBbox => {
  const x1 = (pixelBbox.left - imageInfo.offsetX) / imageInfo.width;
  const y1 = (pixelBbox.top - imageInfo.offsetY) / imageInfo.height;
  const x2 = x1 + (pixelBbox.width / imageInfo.width);
  const y2 = y1 + (pixelBbox.height / imageInfo.height);
  
  return { x1, y1, x2, y2 };
};

/**
 * Creates extended pixel bounding box with additional calculated properties
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param normalizedBbox - Normalized bounding box
 * @param imageInfo - Image dimension and position information
 * 
 * @returns Extended pixel bounding box with calculated properties
 * 
 * @example
 * const bbox = { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }
 * const imageInfo = { width: 800, height: 600, offsetX: 10, offsetY: 5 }
 * const extended = calculateExtendedPixelBounds(bbox, imageInfo)
 * // Result: { left: 90, top: 125, width: 560, height: 300, right: 650, bottom: 425, centerX: 370, centerY: 275, area: 168000 }
 */
export const calculateExtendedPixelBounds = (
  normalizedBbox: NormalizedBbox,
  imageInfo: ImageInfo
): ExtendedPixelBbox => {
  const basic = calculatePixelBounds(normalizedBbox, imageInfo);
  
  return {
    ...basic,
    right: basic.left + basic.width,
    bottom: basic.top + basic.height,
    centerX: basic.left + basic.width / 2,
    centerY: basic.top + basic.height / 2,
    area: basic.width * basic.height
  };
};

/**
 * Creates normalized bounding box from two corner points
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param startPoint - Starting corner point
 * @param endPoint - Ending corner point
 * 
 * @returns Normalized bounding box with correctly ordered coordinates
 * 
 * @example
 * const start = { x: 0.8, y: 0.7 }
 * const end = { x: 0.1, y: 0.2 }
 * const bbox = createNormalizedBboxFromPoints(start, end)
 * // Result: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 } (automatically orders min/max)
 */
export const createNormalizedBboxFromPoints = (
  startPoint: Point,
  endPoint: Point
): NormalizedBbox => {
  const x1 = Math.min(startPoint.x, endPoint.x);
  const y1 = Math.min(startPoint.y, endPoint.y);
  const x2 = Math.max(startPoint.x, endPoint.x);
  const y2 = Math.max(startPoint.y, endPoint.y);
  
  return { x1, y1, x2, y2 };
};

/**
 * Creates pixel bounding box from drawing coordinates
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param startX - Starting X coordinate
 * @param startY - Starting Y coordinate  
 * @param currentX - Current X coordinate
 * @param currentY - Current Y coordinate
 * 
 * @returns Pixel bounding box with correctly ordered coordinates
 * 
 * @example
 * const bbox = createPixelBboxFromDrawing(100, 150, 300, 250)
 * // Result: { left: 100, top: 150, width: 200, height: 100 }
 */
export const createPixelBboxFromDrawing = (
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): PixelBbox => {
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  
  return { left, top, width, height };
};

/**
 * Calculates the intersection of two normalized bounding boxes
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param bbox1 - First bounding box
 * @param bbox2 - Second bounding box
 * 
 * @returns Intersection bounding box, or null if no intersection
 * 
 * @example
 * const box1 = { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }
 * const box2 = { x1: 0.5, y1: 0.1, x2: 0.9, y2: 0.6 }
 * const intersection = calculateIntersection(box1, box2)
 * // Result: { x1: 0.5, y1: 0.2, x2: 0.8, y2: 0.6 }
 */
export const calculateIntersection = (
  bbox1: NormalizedBbox,
  bbox2: NormalizedBbox
): NormalizedBbox | null => {
  const x1 = Math.max(bbox1.x1, bbox2.x1);
  const y1 = Math.max(bbox1.y1, bbox2.y1);
  const x2 = Math.min(bbox1.x2, bbox2.x2);
  const y2 = Math.min(bbox1.y2, bbox2.y2);
  
  // Check if intersection exists
  if (x1 >= x2 || y1 >= y2) {
    return null;
  }
  
  return { x1, y1, x2, y2 };
};

/**
 * Calculates the union of two normalized bounding boxes
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param bbox1 - First bounding box
 * @param bbox2 - Second bounding box
 * 
 * @returns Union bounding box containing both input boxes
 * 
 * @example
 * const box1 = { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 }
 * const box2 = { x1: 0.4, y1: 0.1, x2: 0.8, y2: 0.7 }
 * const union = calculateUnion(box1, box2)
 * // Result: { x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.7 }
 */
export const calculateUnion = (
  bbox1: NormalizedBbox,
  bbox2: NormalizedBbox
): NormalizedBbox => {
  return {
    x1: Math.min(bbox1.x1, bbox2.x1),
    y1: Math.min(bbox1.y1, bbox2.y1),
    x2: Math.max(bbox1.x2, bbox2.x2),
    y2: Math.max(bbox1.y2, bbox2.y2)
  };
};

/**
 * Calculates the area of a normalized bounding box
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param bbox - Normalized bounding box
 * 
 * @returns Area in normalized units (0-1 range)
 * 
 * @example
 * const bbox = { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }
 * const area = calculateBboxArea(bbox)
 * // Result: 0.35 (0.7 * 0.5)
 */
export const calculateBboxArea = (bbox: NormalizedBbox): number => {
  const width = bbox.x2 - bbox.x1;
  const height = bbox.y2 - bbox.y1;
  return width * height;
};

/**
 * Calculates Intersection over Union (IoU) of two bounding boxes
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param bbox1 - First bounding box
 * @param bbox2 - Second bounding box
 * 
 * @returns IoU value between 0 and 1
 * 
 * @example
 * const box1 = { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }
 * const box2 = { x1: 0.5, y1: 0.1, x2: 0.9, y2: 0.6 }
 * const iou = calculateIoU(box1, box2)
 * // Result: intersection_area / union_area
 */
export const calculateIoU = (
  bbox1: NormalizedBbox,
  bbox2: NormalizedBbox
): number => {
  const intersection = calculateIntersection(bbox1, bbox2);
  
  if (!intersection) {
    return 0;
  }
  
  const intersectionArea = calculateBboxArea(intersection);
  const area1 = calculateBboxArea(bbox1);
  const area2 = calculateBboxArea(bbox2);
  const unionArea = area1 + area2 - intersectionArea;
  
  return unionArea > 0 ? intersectionArea / unionArea : 0;
};

/**
 * Checks if a point is inside a normalized bounding box
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param point - Point to check
 * @param bbox - Bounding box to test against
 * 
 * @returns true if point is inside the bounding box
 * 
 * @example
 * const point = { x: 0.5, y: 0.4 }
 * const bbox = { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }
 * const isInside = isPointInBbox(point, bbox)
 * // Result: true
 */
export const isPointInBbox = (
  point: Point,
  bbox: NormalizedBbox
): boolean => {
  return (
    point.x >= bbox.x1 &&
    point.x <= bbox.x2 &&
    point.y >= bbox.y1 &&
    point.y <= bbox.y2
  );
};

/**
 * Calculates the center point of a normalized bounding box
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param bbox - Normalized bounding box
 * 
 * @returns Center point coordinates
 * 
 * @example
 * const bbox = { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }
 * const center = calculateBboxCenter(bbox)
 * // Result: { x: 0.45, y: 0.45 }
 */
export const calculateBboxCenter = (bbox: NormalizedBbox): Point => {
  return {
    x: (bbox.x1 + bbox.x2) / 2,
    y: (bbox.y1 + bbox.y2) / 2
  };
};

/**
 * Scales a normalized bounding box by a factor from its center
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param bbox - Original bounding box
 * @param scaleFactor - Scale factor (1.0 = no change, 2.0 = double size)
 * 
 * @returns Scaled bounding box, clamped to 0-1 range
 * 
 * @example
 * const bbox = { x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7 }
 * const scaled = scaleBboxFromCenter(bbox, 1.5)
 * // Result: { x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 }
 */
export const scaleBboxFromCenter = (
  bbox: NormalizedBbox,
  scaleFactor: number
): NormalizedBbox => {
  const center = calculateBboxCenter(bbox);
  const currentWidth = bbox.x2 - bbox.x1;
  const currentHeight = bbox.y2 - bbox.y1;
  
  const newWidth = currentWidth * scaleFactor;
  const newHeight = currentHeight * scaleFactor;
  
  const x1 = Math.max(0, center.x - newWidth / 2);
  const y1 = Math.max(0, center.y - newHeight / 2);
  const x2 = Math.min(1, center.x + newWidth / 2);
  const y2 = Math.min(1, center.y + newHeight / 2);
  
  return { x1, y1, x2, y2 };
};