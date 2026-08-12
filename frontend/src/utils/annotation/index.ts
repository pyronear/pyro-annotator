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
  normalizedToPixelBox,
} from './coordinateUtils';

export type {
  ImageContainConfig,
  ImageBounds,
  Point,
  TransformConfig,
  ImageInfo,
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
  calculateDrawingStats,
} from './drawingUtils';

export type { DrawnRectangle, CurrentDrawing, SmokeTypeColors, DrawingMode } from './drawingUtils';

// Model reference layer utilities
export { getWinningModelLayer } from './referenceLayerUtils';
export type { ModelLayer } from './referenceLayerUtils';

// Seed-at-submit review utilities
export { materializeReviewAnnotation, sequenceSmokeType } from './reviewUtils';

// Create-or-update detection annotation save (FP-item preservation)
export { saveDetectionReview } from './laneAnnotationSave';
export type { SaveDetectionReviewParams } from './laneAnnotationSave';

// Localize quick submit
export {
  getCellState,
  getWinningBoxes,
  buildQuickSubmitPlan,
  getIsAnnotated,
  collectLaneBoxes,
  falsePositiveContextBoxes,
} from './quickSubmitUtils';
export type { CellState, QuickSubmitPlan, QuickSubmitPayload } from './quickSubmitUtils';
export { computeCellCrop, focusOnMainObject } from './gridCropUtils';
export type { CellCrop } from './gridCropUtils';

// Box-drawing stage: scale plus a pan expressed as a fraction of the image
export {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  clampScale,
  cropToPan,
  stageTransform,
  wheelZoomFactor,
  zoomAtPoint,
} from './stageViewUtils';
export type { StageView } from './stageViewUtils';

// Bounding box move/resize geometry
export { moveBox, resizeBox, HANDLE_CURSOR } from './boxEditUtils';
export type { ResizeHandle, Box } from './boxEditUtils';

// Validation utilities
export {
  validateDetectionPredictions,
  validateDrawnRectangles,
  validateDetectionAnnotation,
  isDetectionAnnotationComplete,
  calculateAnnotationCompleteness,
  validateRectangleOverlaps,
  calculateBoundingBoxOverlap,
  validateWorkflowReadiness,
} from './validationUtils';

export type { ValidationResult, AnnotationCompleteness } from './validationUtils';

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
  getCanvasScale,
} from './canvasUtils';

export type { ZoomConfig, PanConstraints } from './canvasUtils';

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
  getAspectRatioLabel,
} from './imageUtils';

export type { ImageDimensions, ImageFitConfig, DisplayDimensions } from './imageUtils';

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
} from './workflowUtils';

export type { WorkflowStep, WorkflowState, WorkflowProgress } from './workflowUtils';

// Sequence utilities
export {
  getClassificationType,
  hasUserAnnotations,
  initializeCleanBbox,
  shouldShowAsAnnotated,
  isAnnotationDataValid,
  getInitialMissedSmokeReview,
  createAnnotationPayload,
  updateBboxSmokeType,
  updateBboxFalsePositiveType,
  clearBboxSelections,
  getKeyForFalsePositiveType,
  formatFalsePositiveLabel,
} from './sequenceUtils';

// Progress utilities
export {
  getAnnotationProgress,
  calculateCompletionPercentage,
  formatRemainingMessage,
  isAnnotationComplete,
  getAnnotationValidationErrors,
  formatProgressDisplay,
  getProgressColor,
} from './progressUtils';

export type { AnnotationProgress } from './progressUtils';

// Per-object color identity (ClassifyAlertPage multi-object overlays)
export { getObjectColor } from './objectColors';
export type { ObjectOverlay } from './objectColors';

// Localize object editor: the per-frame box candidates for one object
export { boxCandidates, committedBox, priorityPick, candidateToBbox } from './objectBoxCandidates';
export type { BoxSource, BoxCandidate } from './objectBoxCandidates';

// Localize object editor: the filmstrip over the alert's whole frame range
export { buildFilmstripEntries } from './objectFilmstrip';
export type { FilmstripEntry, FilmstripRun } from './objectFilmstrip';
