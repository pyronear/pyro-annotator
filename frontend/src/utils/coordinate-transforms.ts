/**
 * Pure coordinate transformation utilities for image annotations
 * 
 * This module provides referentially transparent functions for converting between
 * different coordinate systems used in image annotation interfaces.
 */

/**
 * Normalized coordinates (0-1 range)
 */
export interface NormalizedCoordinates {
  readonly x: number;
  readonly y: number;
}

/**
 * Pixel coordinates within image bounds
 */
export interface PixelCoordinates {
  readonly x: number;
  readonly y: number;
}

/**
 * Image dimension and positioning information
 */
export interface ImageInfo {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * Transform state for zoom and pan operations
 */
export interface Transform {
  readonly zoomLevel: number;
  readonly panOffset: { readonly x: number; readonly y: number };
  readonly transformOrigin: { readonly x: number; readonly y: number };
}

/**
 * Container dimensions for calculations
 */
export interface ContainerInfo {
  readonly width: number;
  readonly height: number;
}

/**
 * Natural image dimensions
 */
export interface NaturalImageInfo {
  readonly width: number;
  readonly height: number;
}

/**
 * Converts screen coordinates to image coordinates using pure calculations
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param screenX - Screen X coordinate relative to container
 * @param screenY - Screen Y coordinate relative to container
 * @param imageInfo - Image dimension and position information
 * @param transform - Current zoom/pan transform state
 * @param containerInfo - Container dimensions
 * @param naturalImageInfo - Natural image dimensions
 * 
 * @returns Image coordinates within the image bounds
 * 
 * @example
 * const imageCoords = screenToImageCoordinates(
 *   100, 150,
 *   { width: 800, height: 600, offsetX: 10, offsetY: 5 },
 *   { zoomLevel: 1.5, panOffset: { x: 0, y: 0 }, transformOrigin: { x: 50, y: 50 } },
 *   { width: 1000, height: 800 },
 *   { width: 1920, height: 1080 }
 * )
 */
export const screenToImageCoordinates = (
  screenX: number,
  screenY: number,
  imageInfo: ImageInfo,
  transform: Transform,
  containerInfo: ContainerInfo,
  naturalImageInfo: NaturalImageInfo
): PixelCoordinates => {
  // Calculate original image bounds using object-contain logic
  const imgAspectRatio = naturalImageInfo.width / naturalImageInfo.height;
  const containerAspectRatio = containerInfo.width / containerInfo.height;
  
  let originalWidth: number, originalHeight: number, originalX: number, originalY: number;
  
  if (imgAspectRatio > containerAspectRatio) {
    // Image is wider - fit to width
    originalWidth = containerInfo.width;
    originalHeight = containerInfo.width / imgAspectRatio;
    originalX = 0;
    originalY = (containerInfo.height - originalHeight) / 2;
  } else {
    // Image is taller - fit to height
    originalWidth = containerInfo.height * imgAspectRatio;
    originalHeight = containerInfo.height;
    originalX = (containerInfo.width - originalWidth) / 2;
    originalY = 0;
  }
  
  // Calculate transform origin in original image pixel coordinates
  const originX = (transform.transformOrigin.x / 100) * originalWidth;
  const originY = (transform.transformOrigin.y / 100) * originalHeight;
  
  // Transform origin in container coordinates
  const originContainerX = originalX + originX;
  const originContainerY = originalY + originY;
  
  // Reverse the CSS transform: scale(zoomLevel) translate(panOffset.x, panOffset.y)
  // Step 1: Reverse translation (panOffset is applied in scaled coordinate space)
  const afterTranslateX = screenX - transform.panOffset.x;
  const afterTranslateY = screenY - transform.panOffset.y;
  
  // Step 2: Reverse scaling around transform origin
  const imageX = (afterTranslateX - originContainerX) / transform.zoomLevel + originContainerX - originalX;
  const imageY = (afterTranslateY - originContainerY) / transform.zoomLevel + originContainerY - originalY;
  
  return { x: imageX, y: imageY };
};

/**
 * Converts image coordinates to normalized coordinates (0-1 range)
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param imageX - X coordinate within image bounds
 * @param imageY - Y coordinate within image bounds
 * @param containerInfo - Container dimensions
 * @param naturalImageInfo - Natural image dimensions
 * 
 * @returns Normalized coordinates in 0-1 range
 * 
 * @example
 * const normalized = imageToNormalized(400, 300, 
 *   { width: 1000, height: 800 }, 
 *   { width: 1920, height: 1080 }
 * )
 * // Result: { x: 0.4, y: 0.375 }
 */
export const imageToNormalized = (
  imageX: number,
  imageY: number,
  containerInfo: ContainerInfo,
  naturalImageInfo: NaturalImageInfo
): NormalizedCoordinates => {
  // Calculate original image bounds using object-contain logic
  const imgAspectRatio = naturalImageInfo.width / naturalImageInfo.height;
  const containerAspectRatio = containerInfo.width / containerInfo.height;
  
  let originalWidth: number, originalHeight: number;
  
  if (imgAspectRatio > containerAspectRatio) {
    // Image is wider - fit to width
    originalWidth = containerInfo.width;
    originalHeight = containerInfo.width / imgAspectRatio;
  } else {
    // Image is taller - fit to height
    originalWidth = containerInfo.height * imgAspectRatio;
    originalHeight = containerInfo.height;
  }
  
  return {
    x: Math.max(0, Math.min(1, imageX / originalWidth)),
    y: Math.max(0, Math.min(1, imageY / originalHeight))
  };
};

/**
 * Converts normalized coordinates to image pixel coordinates
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param normX - Normalized X coordinate (0-1 range)
 * @param normY - Normalized Y coordinate (0-1 range)
 * @param containerInfo - Container dimensions
 * @param naturalImageInfo - Natural image dimensions
 * 
 * @returns Pixel coordinates within image bounds
 * 
 * @example
 * const pixelCoords = normalizedToImage(0.4, 0.375,
 *   { width: 1000, height: 800 },
 *   { width: 1920, height: 1080 }
 * )
 * // Result: { x: 400, y: 300 }
 */
export const normalizedToImage = (
  normX: number,
  normY: number,
  containerInfo: ContainerInfo,
  naturalImageInfo: NaturalImageInfo
): PixelCoordinates => {
  // Calculate original image bounds using object-contain logic
  const imgAspectRatio = naturalImageInfo.width / naturalImageInfo.height;
  const containerAspectRatio = containerInfo.width / containerInfo.height;
  
  let originalWidth: number, originalHeight: number;
  
  if (imgAspectRatio > containerAspectRatio) {
    // Image is wider - fit to width
    originalWidth = containerInfo.width;
    originalHeight = containerInfo.width / imgAspectRatio;
  } else {
    // Image is taller - fit to height
    originalWidth = containerInfo.height * imgAspectRatio;
    originalHeight = containerInfo.height;
  }
  
  return {
    x: normX * originalWidth,
    y: normY * originalHeight
  };
};

/**
 * Constrains pan offset to keep image within bounds
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param panOffset - Current pan offset
 * @param zoomLevel - Current zoom level
 * @param imageInfo - Image dimension information
 * 
 * @returns Constrained pan offset
 * 
 * @example
 * const constrainedOffset = constrainPanOffset(
 *   { x: 100, y: 50 },
 *   2.0,
 *   { width: 800, height: 600, offsetX: 0, offsetY: 0 }
 * )
 */
export const constrainPanOffset = (
  panOffset: { readonly x: number; readonly y: number },
  zoomLevel: number,
  imageInfo: ImageInfo
): { readonly x: number; readonly y: number } => {
  if (zoomLevel <= 1) {
    return { x: 0, y: 0 };
  }
  
  const scaledWidth = imageInfo.width * zoomLevel;
  const scaledHeight = imageInfo.height * zoomLevel;
  
  // Calculate maximum allowed pan to keep image within bounds
  const maxPanX = Math.max(0, (scaledWidth - imageInfo.width) / 2);
  const maxPanY = Math.max(0, (scaledHeight - imageInfo.height) / 2);
  
  return {
    x: Math.max(-maxPanX, Math.min(maxPanX, panOffset.x)),
    y: Math.max(-maxPanY, Math.min(maxPanY, panOffset.y))
  };
};

/**
 * Calculates new zoom level with bounds checking
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param currentZoom - Current zoom level
 * @param delta - Zoom delta (positive for zoom in, negative for zoom out)
 * @param minZoom - Minimum allowed zoom level (default: 1.0)
 * @param maxZoom - Maximum allowed zoom level (default: 4.0)
 * 
 * @returns New zoom level within bounds
 * 
 * @example
 * const newZoom = calculateZoomLevel(1.5, 0.2, 1.0, 4.0)
 * // Result: 1.7
 */
export const calculateZoomLevel = (
  currentZoom: number,
  delta: number,
  minZoom: number = 1.0,
  maxZoom: number = 4.0
): number => {
  return Math.max(minZoom, Math.min(maxZoom, currentZoom + delta));
};