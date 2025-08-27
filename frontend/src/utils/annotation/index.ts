/**
 * Barrel export for annotation utilities.
 * Provides clean imports for all annotation-related functions.
 */

// Coordinate utilities
export {
  calculateImageBounds,
  screenToImageCoordinates,
  imageToNormalizedCoordinates,
  normalizedToImageCoordinates,
  normalizedBboxToPixels,
  validateBoundingBox,
  calculateBoundingBoxArea,
  normalizedToPixelBox
} from './coordinateUtils';

export type {
  ImageContainConfig,
  ImageBounds,
  Point,
  TransformConfig,
  ImageInfo
} from './coordinateUtils';

// Drawing utilities
export {
  getSmokeTypeColors,
  createDrawnRectangle,
  validateDrawingSize,
  isPointInRectangle,
  getRectangleAtPoint,
  updateRectangleSmokeType,
  removeRectangle,
  importPredictionsAsRectangles,
  areBoundingBoxesSimilar,
  calculateDrawingStats
} from './drawingUtils';

export type {
  DrawnRectangle,
  CurrentDrawing,
  SmokeTypeColors,
  DrawingMode
} from './drawingUtils';

// Validation utilities
export {
  validateDetectionPredictions,
  validateDrawnRectangles,
  validateDetectionAnnotation,
  isDetectionAnnotationComplete,
  calculateAnnotationCompleteness,
  validateRectangleOverlaps,
  calculateBoundingBoxOverlap,
  validateWorkflowReadiness
} from './validationUtils';

export type {
  ValidationResult,
  AnnotationCompleteness
} from './validationUtils';