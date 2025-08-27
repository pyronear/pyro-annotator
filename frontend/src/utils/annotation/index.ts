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

// Canvas utilities
export {
  calculateZoomLevel,
  calculateTransformOrigin,
  calculatePanConstraints,
  constrainPan,
  isWithinCanvas,
  calculateSizeThreshold,
  getMouseRelativeToElement,
  isValidDrawingSize,
  getCanvasScale
} from './canvasUtils';

export type {
  ZoomConfig,
  PanConstraints
} from './canvasUtils';

// Image utilities
export {
  calculateAspectRatio,
  getImageDimensions,
  fitImageToContainer,
  coverContainer,
  calculateOptimalZoom,
  isValidImageSize,
  getImageScale,
  formatImageDimensions,
  getAspectRatioLabel
} from './imageUtils';

export type {
  ImageDimensions,
  ImageFitConfig,
  DisplayDimensions
} from './imageUtils';

// Workflow utilities
export {
  getWorkflowStep,
  calculateWorkflowProgress,
  getNextDetectionIndex,
  getPreviousDetectionIndex,
  isWorkflowComplete,
  validateAnnotationData,
  formatWorkflowStatus,
  calculateRemainingItems,
  getTimeEstimate
} from './workflowUtils';

export type {
  WorkflowStep,
  WorkflowState,
  WorkflowProgress
} from './workflowUtils';