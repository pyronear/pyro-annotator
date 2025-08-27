/**
 * Pure validation utilities for annotation data.
 * These functions validate annotation completeness, correctness, and consistency.
 */

import { Detection, DetectionAnnotation } from '@/types/api';
import { DrawnRectangle } from './drawingUtils';

/**
 * Validation result with details about what was validated.
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Annotation completeness status.
 */
export interface AnnotationCompleteness {
  isComplete: boolean;
  hasAnnotations: boolean;
  totalDetections: number;
  annotatedDetections: number;
  completionPercentage: number;
}

/**
 * Validates that a detection has valid algorithm predictions.
 *
 * @param detection - Detection to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateDetectionPredictions(detection);
 * if (!result.isValid) {
 *   console.log('Errors:', result.errors);
 * }
 * ```
 */
export const validateDetectionPredictions = (detection: Detection): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!detection.algo_predictions) {
    errors.push('Detection has no algorithm predictions');
    return { isValid: false, errors, warnings };
  }

  if (
    !detection.algo_predictions.predictions ||
    detection.algo_predictions.predictions.length === 0
  ) {
    warnings.push('Detection has empty predictions array');
  }

  // Validate each prediction
  detection.algo_predictions.predictions?.forEach((pred, index) => {
    if (!pred.xyxyn || pred.xyxyn.length !== 4) {
      errors.push(`Prediction ${index} has invalid xyxyn coordinates`);
    } else {
      const [x1, y1, x2, y2] = pred.xyxyn;

      // Check coordinate ranges
      if (x1 < 0 || x1 > 1 || y1 < 0 || y1 > 1 || x2 < 0 || x2 > 1 || y2 < 0 || y2 > 1) {
        errors.push(`Prediction ${index} has coordinates outside 0-1 range`);
      }

      // Check that x2 > x1 and y2 > y1
      if (x2 <= x1 || y2 <= y1) {
        errors.push(
          `Prediction ${index} has invalid bbox dimensions (x2=${x2}, x1=${x1}, y2=${y2}, y1=${y1})`
        );
      }
    }

    if (typeof pred.confidence !== 'number' || pred.confidence < 0 || pred.confidence > 1) {
      errors.push(`Prediction ${index} has invalid confidence score`);
    }

    if (!pred.class_name || typeof pred.class_name !== 'string') {
      errors.push(`Prediction ${index} has invalid class name`);
    }
  });

  return { isValid: errors.length === 0, errors, warnings };
};

/**
 * Validates that drawn rectangles have valid data.
 *
 * @param rectangles - Array of drawn rectangles to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateDrawnRectangles(rectangles);
 * if (!result.isValid) {
 *   console.log('Invalid rectangles:', result.errors);
 * }
 * ```
 */
export const validateDrawnRectangles = (rectangles: DrawnRectangle[]): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  rectangles.forEach((rect, index) => {
    if (!rect.id || typeof rect.id !== 'string') {
      errors.push(`Rectangle ${index} has invalid ID`);
    }

    if (!rect.xyxyn || rect.xyxyn.length !== 4) {
      errors.push(`Rectangle ${index} has invalid xyxyn coordinates`);
    } else {
      const [x1, y1, x2, y2] = rect.xyxyn;

      // Check coordinate ranges
      if (x1 < 0 || x1 > 1 || y1 < 0 || y1 > 1 || x2 < 0 || x2 > 1 || y2 < 0 || y2 > 1) {
        errors.push(`Rectangle ${index} has coordinates outside 0-1 range`);
      }

      // Check that x2 > x1 and y2 > y1
      if (x2 <= x1 || y2 <= y1) {
        errors.push(
          `Rectangle ${index} has invalid dimensions (x2=${x2}, x1=${x1}, y2=${y2}, y1=${y1})`
        );
      }

      // Check for minimum size (too small rectangles might be accidental)
      const width = x2 - x1;
      const height = y2 - y1;
      if (width < 0.01 || height < 0.01) {
        warnings.push(
          `Rectangle ${index} is very small (${(width * 100).toFixed(1)}% × ${(height * 100).toFixed(1)}%)`
        );
      }
    }

    const validSmokeTypes = ['wildfire', 'industrial', 'other'];
    if (!validSmokeTypes.includes(rect.smokeType)) {
      errors.push(`Rectangle ${index} has invalid smoke type: ${rect.smokeType}`);
    }
  });

  return { isValid: errors.length === 0, errors, warnings };
};

/**
 * Validates that a detection annotation is complete and valid.
 *
 * @param annotation - Detection annotation to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateDetectionAnnotation(annotation);
 * if (!result.isValid) {
 *   console.log('Annotation errors:', result.errors);
 * }
 * ```
 */
export const validateDetectionAnnotation = (annotation: DetectionAnnotation): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof annotation.detection_id !== 'number') {
    errors.push('Annotation has invalid detection_id');
  }

  // Validate annotation data structure
  if (!annotation.annotation) {
    errors.push('Annotation has no annotation data');
  } else if (
    !annotation.annotation.annotation ||
    !Array.isArray(annotation.annotation.annotation)
  ) {
    errors.push('Annotation data has invalid structure');
  } else {
    // Validate each annotation item
    annotation.annotation.annotation.forEach((item, index) => {
      if (!item.xyxyn || item.xyxyn.length !== 4) {
        errors.push(`Annotation item ${index} has invalid xyxyn coordinates`);
      }

      const validSmokeTypes = ['wildfire', 'industrial', 'other'];
      if (!validSmokeTypes.includes(item.smoke_type)) {
        errors.push(`Annotation item ${index} has invalid smoke type: ${item.smoke_type}`);
      }
    });

    if (annotation.annotation.annotation.length === 0) {
      warnings.push('Annotation has empty annotation array - this might indicate a false positive');
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
};

/**
 * Checks if a detection annotation is complete (has been reviewed).
 *
 * @param annotation - Detection annotation to check
 * @returns True if annotation is complete
 *
 * @example
 * ```typescript
 * const complete = isDetectionAnnotationComplete(annotation);
 * ```
 */
export const isDetectionAnnotationComplete = (annotation: DetectionAnnotation | null): boolean => {
  if (!annotation) return false;

  // An annotation is complete if it has reached the 'annotated' processing stage
  return annotation.processing_stage === 'annotated';
};

/**
 * Calculates annotation completeness for a set of detections.
 *
 * @param detections - Array of detections
 * @param annotations - Map of detection ID to annotation
 * @returns Completeness statistics
 *
 * @example
 * ```typescript
 * const stats = calculateAnnotationCompleteness(detections, annotationsMap);
 * console.log(`${stats.completionPercentage}% complete`);
 * ```
 */
export const calculateAnnotationCompleteness = (
  detections: Detection[],
  annotations: Map<number, DetectionAnnotation>
): AnnotationCompleteness => {
  const totalDetections = detections.length;
  let annotatedDetections = 0;

  detections.forEach(detection => {
    const annotation = annotations.get(detection.id) || null;
    if (isDetectionAnnotationComplete(annotation)) {
      annotatedDetections++;
    }
  });

  const completionPercentage =
    totalDetections > 0 ? Math.round((annotatedDetections / totalDetections) * 100) : 0;

  return {
    isComplete: annotatedDetections === totalDetections,
    hasAnnotations: annotatedDetections > 0,
    totalDetections,
    annotatedDetections,
    completionPercentage,
  };
};

/**
 * Validates that rectangles don't have significant overlaps.
 *
 * @param rectangles - Array of rectangles to check
 * @param overlapThreshold - Maximum allowed overlap ratio (default: 0.8)
 * @returns Validation result with overlap warnings
 *
 * @example
 * ```typescript
 * const result = validateRectangleOverlaps(rectangles, 0.5);
 * if (result.warnings.length > 0) {
 *   console.log('Overlapping rectangles detected');
 * }
 * ```
 */
export const validateRectangleOverlaps = (
  rectangles: DrawnRectangle[],
  overlapThreshold: number = 0.8
): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < rectangles.length; i++) {
    for (let j = i + 1; j < rectangles.length; j++) {
      const rect1 = rectangles[i];
      const rect2 = rectangles[j];

      const overlap = calculateBoundingBoxOverlap(rect1.xyxyn, rect2.xyxyn);

      if (overlap > overlapThreshold) {
        warnings.push(
          `Rectangles ${rect1.id} and ${rect2.id} have high overlap (${(overlap * 100).toFixed(1)}%)`
        );
      }
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
};

/**
 * Calculates the overlap ratio between two bounding boxes.
 *
 * @param bbox1 - First bounding box [x1, y1, x2, y2]
 * @param bbox2 - Second bounding box [x1, y1, x2, y2]
 * @returns Overlap ratio (0-1, where 1 is complete overlap)
 *
 * @example
 * ```typescript
 * const overlap = calculateBoundingBoxOverlap(
 *   [0.1, 0.2, 0.8, 0.9],
 *   [0.3, 0.4, 0.9, 1.0]
 * );
 * ```
 */
export const calculateBoundingBoxOverlap = (
  bbox1: [number, number, number, number],
  bbox2: [number, number, number, number]
): number => {
  const [x1_1, y1_1, x2_1, y2_1] = bbox1;
  const [x1_2, y1_2, x2_2, y2_2] = bbox2;

  // Calculate intersection
  const xLeft = Math.max(x1_1, x1_2);
  const yTop = Math.max(y1_1, y1_2);
  const xRight = Math.min(x2_1, x2_2);
  const yBottom = Math.min(y2_1, y2_2);

  if (xRight <= xLeft || yBottom <= yTop) {
    return 0; // No intersection
  }

  const intersectionArea = (xRight - xLeft) * (yBottom - yTop);

  // Calculate union area
  const area1 = (x2_1 - x1_1) * (y2_1 - y1_1);
  const area2 = (x2_2 - x1_2) * (y2_2 - y1_2);
  const unionArea = area1 + area2 - intersectionArea;

  return intersectionArea / unionArea;
};

/**
 * Checks if annotation workflow is ready for submission.
 *
 * @param detections - Array of detections in sequence
 * @param annotations - Map of detection annotations
 * @param requireAllAnnotated - Whether all detections must be annotated
 * @returns Validation result indicating readiness
 *
 * @example
 * ```typescript
 * const result = validateWorkflowReadiness(detections, annotations, true);
 * if (result.isValid) {
 *   // Ready to submit
 * }
 * ```
 */
export const validateWorkflowReadiness = (
  detections: Detection[],
  annotations: Map<number, DetectionAnnotation>,
  requireAllAnnotated: boolean = true
): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const completeness = calculateAnnotationCompleteness(detections, annotations);

  if (requireAllAnnotated && !completeness.isComplete) {
    errors.push(
      `Not all detections are annotated (${completeness.annotatedDetections}/${completeness.totalDetections})`
    );
  }

  if (!completeness.hasAnnotations) {
    errors.push('No annotations have been created');
  }

  // Validate each annotation
  annotations.forEach((annotation, detectionId) => {
    const validationResult = validateDetectionAnnotation(annotation);
    if (!validationResult.isValid) {
      errors.push(`Detection ${detectionId}: ${validationResult.errors.join(', ')}`);
    }
    warnings.push(...validationResult.warnings);
  });

  return { isValid: errors.length === 0, errors, warnings };
};
