/**
 * Pure utility functions for image processing operations.
 * These functions handle image dimension calculations and aspect ratios.
 */

/**
 * Image dimension information.
 */
export interface ImageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
}

/**
 * Container fit configuration for images.
 */
export interface ImageFitConfig {
  mode: 'contain' | 'cover' | 'fill';
  alignment: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Calculated image display dimensions.
 */
export interface DisplayDimensions {
  displayWidth: number;
  displayHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

/**
 * Calculates image aspect ratio.
 * 
 * @param width - Image width
 * @param height - Image height
 * @returns Aspect ratio (width/height)
 * 
 * @example
 * ```typescript
 * const ratio = calculateAspectRatio(1920, 1080);
 * // Returns: 1.777... (16:9)
 * ```
 */
export const calculateAspectRatio = (
  width: number,
  height: number
): number => {
  if (height === 0) return 1;
  return width / height;
};

/**
 * Gets image dimensions with aspect ratio.
 * 
 * @param width - Image width
 * @param height - Image height
 * @returns Image dimensions object
 * 
 * @example
 * ```typescript
 * const dims = getImageDimensions(1920, 1080);
 * // Returns: { width: 1920, height: 1080, aspectRatio: 1.777... }
 * ```
 */
export const getImageDimensions = (
  width: number,
  height: number
): ImageDimensions => {
  return {
    width,
    height,
    aspectRatio: calculateAspectRatio(width, height)
  };
};

/**
 * Calculates dimensions to fit image in container with object-contain behavior.
 * 
 * @param imageWidth - Original image width
 * @param imageHeight - Original image height
 * @param containerWidth - Container width
 * @param containerHeight - Container height
 * @returns Display dimensions with position
 * 
 * @example
 * ```typescript
 * const display = fitImageToContainer(1920, 1080, 800, 600);
 * // Returns scaled dimensions that fit within container
 * ```
 */
export const fitImageToContainer = (
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number
): DisplayDimensions => {
  const imageRatio = calculateAspectRatio(imageWidth, imageHeight);
  const containerRatio = calculateAspectRatio(containerWidth, containerHeight);
  
  let displayWidth: number;
  let displayHeight: number;
  let scale: number;
  
  if (imageRatio > containerRatio) {
    // Image is wider - fit to width
    displayWidth = containerWidth;
    displayHeight = containerWidth / imageRatio;
    scale = containerWidth / imageWidth;
  } else {
    // Image is taller - fit to height
    displayHeight = containerHeight;
    displayWidth = containerHeight * imageRatio;
    scale = containerHeight / imageHeight;
  }
  
  const offsetX = (containerWidth - displayWidth) / 2;
  const offsetY = (containerHeight - displayHeight) / 2;
  
  return {
    displayWidth,
    displayHeight,
    offsetX,
    offsetY,
    scale
  };
};

/**
 * Calculates dimensions to cover container with image.
 * 
 * @param imageWidth - Original image width
 * @param imageHeight - Original image height
 * @param containerWidth - Container width
 * @param containerHeight - Container height
 * @returns Display dimensions for cover mode
 * 
 * @example
 * ```typescript
 * const display = coverContainer(1920, 1080, 800, 600);
 * // Returns dimensions that cover entire container
 * ```
 */
export const coverContainer = (
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number
): DisplayDimensions => {
  const imageRatio = calculateAspectRatio(imageWidth, imageHeight);
  const containerRatio = calculateAspectRatio(containerWidth, containerHeight);
  
  let displayWidth: number;
  let displayHeight: number;
  let scale: number;
  
  if (imageRatio < containerRatio) {
    // Image is narrower - fit to width
    displayWidth = containerWidth;
    displayHeight = containerWidth / imageRatio;
    scale = containerWidth / imageWidth;
  } else {
    // Image is wider - fit to height
    displayHeight = containerHeight;
    displayWidth = containerHeight * imageRatio;
    scale = containerHeight / imageHeight;
  }
  
  const offsetX = (containerWidth - displayWidth) / 2;
  const offsetY = (containerHeight - displayHeight) / 2;
  
  return {
    displayWidth,
    displayHeight,
    offsetX,
    offsetY,
    scale
  };
};

/**
 * Calculates the optimal zoom level for an image.
 * 
 * @param imageWidth - Image width
 * @param imageHeight - Image height
 * @param viewportWidth - Viewport width
 * @param viewportHeight - Viewport height
 * @param mode - Zoom mode ('fit' | 'fill' | 'actual')
 * @returns Optimal zoom level
 * 
 * @example
 * ```typescript
 * const zoom = calculateOptimalZoom(1920, 1080, 800, 600, 'fit');
 * // Returns zoom level to fit image in viewport
 * ```
 */
export const calculateOptimalZoom = (
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  mode: 'fit' | 'fill' | 'actual' = 'fit'
): number => {
  if (mode === 'actual') {
    return 1.0;
  }
  
  const widthRatio = viewportWidth / imageWidth;
  const heightRatio = viewportHeight / imageHeight;
  
  if (mode === 'fit') {
    // Use smaller ratio to fit entire image
    return Math.min(widthRatio, heightRatio);
  } else {
    // Use larger ratio to fill viewport
    return Math.max(widthRatio, heightRatio);
  }
};

/**
 * Checks if image dimensions are valid.
 * 
 * @param width - Image width
 * @param height - Image height
 * @param minSize - Minimum dimension size
 * @returns True if dimensions are valid
 * 
 * @example
 * ```typescript
 * const isValid = isValidImageSize(1920, 1080, 100);
 * // Returns: true
 * ```
 */
export const isValidImageSize = (
  width: number,
  height: number,
  minSize: number = 1
): boolean => {
  return width >= minSize && height >= minSize && isFinite(width) && isFinite(height);
};

/**
 * Calculates image scale factor based on display dimensions.
 * 
 * @param originalWidth - Original image width
 * @param originalHeight - Original image height
 * @param displayWidth - Display width
 * @param displayHeight - Display height
 * @returns Scale factor
 * 
 * @example
 * ```typescript
 * const scale = getImageScale(1920, 1080, 960, 540);
 * // Returns: 0.5 (50% scale)
 * ```
 */
export const getImageScale = (
  originalWidth: number,
  originalHeight: number,
  displayWidth: number,
  displayHeight: number
): number => {
  const widthScale = displayWidth / originalWidth;
  const heightScale = displayHeight / originalHeight;
  
  // Return the uniform scale factor (should be the same for both if aspect ratio maintained)
  return Math.min(widthScale, heightScale);
};

/**
 * Formats image dimension string for display.
 * 
 * @param width - Image width
 * @param height - Image height
 * @returns Formatted dimension string
 * 
 * @example
 * ```typescript
 * const dims = formatImageDimensions(1920, 1080);
 * // Returns: '1920×1080'
 * ```
 */
export const formatImageDimensions = (
  width: number,
  height: number
): string => {
  return `${Math.round(width)}×${Math.round(height)}`;
};

/**
 * Gets common aspect ratio label.
 * 
 * @param aspectRatio - Calculated aspect ratio
 * @param tolerance - Tolerance for matching common ratios
 * @returns Common ratio label or decimal ratio
 * 
 * @example
 * ```typescript
 * const label = getAspectRatioLabel(1.777);
 * // Returns: '16:9'
 * ```
 */
export const getAspectRatioLabel = (
  aspectRatio: number,
  tolerance: number = 0.01
): string => {
  const commonRatios: Array<[number, string]> = [
    [1.0, '1:1'],
    [1.333, '4:3'],
    [1.5, '3:2'],
    [1.777, '16:9'],
    [1.85, '1.85:1'],
    [2.35, '2.35:1'],
    [2.39, '21:9']
  ];
  
  for (const [ratio, label] of commonRatios) {
    if (Math.abs(aspectRatio - ratio) < tolerance) {
      return label;
    }
  }
  
  return aspectRatio.toFixed(2) + ':1';
};