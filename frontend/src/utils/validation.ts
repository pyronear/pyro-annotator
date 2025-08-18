/**
 * Pure validation utilities for image annotation data
 * 
 * This module provides referentially transparent validation functions
 * that return consistent results for the same inputs.
 */

import { AlgoPrediction, SequenceBbox } from '@/types/api';

/**
 * Normalized bounding box coordinates (0-1 range)
 */
export interface NormalizedBbox {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Validation result with detailed information
 */
export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates if coordinates are within normalized range (0-1)
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param x1 - Left coordinate
 * @param y1 - Top coordinate
 * @param x2 - Right coordinate
 * @param y2 - Bottom coordinate
 * 
 * @returns true if all coordinates are in valid range
 * 
 * @example
 * const isValid = areCoordinatesNormalized(0.1, 0.2, 0.8, 0.7)
 * // Result: true
 * 
 * const isInvalid = areCoordinatesNormalized(-0.1, 0.2, 1.2, 0.7)
 * // Result: false
 */
export const areCoordinatesNormalized = (
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean => {
  return (
    x1 >= 0 && x1 <= 1 &&
    y1 >= 0 && y1 <= 1 &&
    x2 >= 0 && x2 <= 1 &&
    y2 >= 0 && y2 <= 1
  );
};

/**
 * Validates if bounding box has valid dimensions (x2 > x1, y2 > y1)
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param x1 - Left coordinate
 * @param y1 - Top coordinate
 * @param x2 - Right coordinate
 * @param y2 - Bottom coordinate
 * 
 * @returns true if box has positive dimensions
 * 
 * @example
 * const hasValidDimensions = hasValidBboxDimensions(0.1, 0.2, 0.8, 0.7)
 * // Result: true
 * 
 * const hasInvalidDimensions = hasValidBboxDimensions(0.8, 0.7, 0.1, 0.2)
 * // Result: false
 */
export const hasValidBboxDimensions = (
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean => {
  return x2 > x1 && y2 > y1;
};

/**
 * Validates if normalized bounding box coordinates are valid
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param bbox - Normalized bounding box coordinates
 * 
 * @returns Validation result with detailed error information
 * 
 * @example
 * const result = validateNormalizedBbox({ x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 })
 * // Result: { isValid: true, errors: [] }
 * 
 * const invalidResult = validateNormalizedBbox({ x1: 0.8, y1: 0.7, x2: 0.1, y2: 0.2 })
 * // Result: { isValid: false, errors: ['Invalid dimensions: x2 must be greater than x1', ...] }
 */
export const validateNormalizedBbox = (bbox: NormalizedBbox): ValidationResult => {
  const errors: string[] = [];
  
  // Check if coordinates are normalized
  if (!areCoordinatesNormalized(bbox.x1, bbox.y1, bbox.x2, bbox.y2)) {
    errors.push('Coordinates must be in range 0-1');
  }
  
  // Check if dimensions are valid
  if (!hasValidBboxDimensions(bbox.x1, bbox.y1, bbox.x2, bbox.y2)) {
    if (bbox.x2 <= bbox.x1) {
      errors.push('Invalid dimensions: x2 must be greater than x1');
    }
    if (bbox.y2 <= bbox.y1) {
      errors.push('Invalid dimensions: y2 must be greater than y1');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validates if an AI prediction has valid structure and coordinates
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param prediction - AI prediction to validate
 * 
 * @returns true if prediction is valid
 * 
 * @example
 * const prediction = {
 *   xyxyn: [0.1, 0.2, 0.8, 0.7],
 *   confidence: 0.85,
 *   class_name: 'smoke'
 * }
 * const isValid = isValidPrediction(prediction)
 * // Result: true
 */
export const isValidPrediction = (prediction: AlgoPrediction): boolean => {
  // Check if xyxyn array exists and has correct length
  if (!prediction.xyxyn || !Array.isArray(prediction.xyxyn) || prediction.xyxyn.length !== 4) {
    return false;
  }
  
  const [x1, y1, x2, y2] = prediction.xyxyn;
  
  // Check if all coordinates are numbers
  if (typeof x1 !== 'number' || typeof y1 !== 'number' || 
      typeof x2 !== 'number' || typeof y2 !== 'number') {
    return false;
  }
  
  // Validate normalized coordinates and dimensions
  const bboxValidation = validateNormalizedBbox({ x1, y1, x2, y2 });
  return bboxValidation.isValid;
};

/**
 * Validates if a sequence bbox has required annotation data
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param bbox - Sequence bbox to validate
 * 
 * @returns true if bbox has user annotations
 * 
 * @example
 * const bbox = { is_smoke: true, false_positive_types: [] }
 * const hasAnnotations = hasUserAnnotations(bbox)
 * // Result: true
 */
export const hasUserAnnotations = (bbox: SequenceBbox): boolean => {
  return bbox.is_smoke || bbox.false_positive_types.length > 0;
};

/**
 * Validates if confidence score is within valid range
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param confidence - Confidence score to validate
 * 
 * @returns true if confidence is between 0 and 1
 * 
 * @example
 * const isValid = isValidConfidence(0.85)
 * // Result: true
 * 
 * const isInvalid = isValidConfidence(1.5)
 * // Result: false
 */
export const isValidConfidence = (confidence: number): boolean => {
  return typeof confidence === 'number' && 
         confidence >= 0 && 
         confidence <= 1 && 
         !isNaN(confidence);
};

/**
 * Validates if class name is a non-empty string
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param className - Class name to validate
 * 
 * @returns true if class name is valid
 * 
 * @example
 * const isValid = isValidClassName('smoke')
 * // Result: true
 * 
 * const isInvalid = isValidClassName('')
 * // Result: false
 */
export const isValidClassName = (className: string): boolean => {
  return typeof className === 'string' && className.trim().length > 0;
};

/**
 * Comprehensive validation of an AI prediction
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param prediction - AI prediction to validate
 * 
 * @returns Detailed validation result
 * 
 * @example
 * const prediction = {
 *   xyxyn: [0.1, 0.2, 0.8, 0.7],
 *   confidence: 0.85,
 *   class_name: 'smoke'
 * }
 * const result = validatePredictionComprehensive(prediction)
 * // Result: { isValid: true, errors: [] }
 */
export const validatePredictionComprehensive = (prediction: AlgoPrediction): ValidationResult => {
  const errors: string[] = [];
  
  // Validate xyxyn coordinates
  if (!prediction.xyxyn || !Array.isArray(prediction.xyxyn)) {
    errors.push('Missing or invalid xyxyn coordinates array');
  } else if (prediction.xyxyn.length !== 4) {
    errors.push('xyxyn array must contain exactly 4 coordinates');
  } else {
    const [x1, y1, x2, y2] = prediction.xyxyn;
    
    // Check coordinate types
    if (typeof x1 !== 'number' || typeof y1 !== 'number' || 
        typeof x2 !== 'number' || typeof y2 !== 'number') {
      errors.push('All coordinates must be numbers');
    } else {
      // Validate bbox
      const bboxValidation = validateNormalizedBbox({ x1, y1, x2, y2 });
      errors.push(...bboxValidation.errors);
    }
  }
  
  // Validate confidence
  if (!isValidConfidence(prediction.confidence)) {
    errors.push('Confidence must be a number between 0 and 1');
  }
  
  // Validate class name
  if (!isValidClassName(prediction.class_name)) {
    errors.push('Class name must be a non-empty string');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Checks if two bounding boxes match within a tolerance
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param bbox1 - First bounding box
 * @param bbox2 - Second bounding box  
 * @param tolerance - Matching tolerance (default: 0.01)
 * 
 * @returns true if bounding boxes match within tolerance
 * 
 * @example
 * const bbox1 = { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }
 * const bbox2 = { x1: 0.101, y1: 0.199, x2: 0.801, y2: 0.699 }
 * const matches = doBboxesMatch(bbox1, bbox2, 0.01)
 * // Result: true
 */
export const doBboxesMatch = (
  bbox1: NormalizedBbox,
  bbox2: NormalizedBbox,
  tolerance: number = 0.01
): boolean => {
  return (
    Math.abs(bbox1.x1 - bbox2.x1) < tolerance &&
    Math.abs(bbox1.y1 - bbox2.y1) < tolerance &&
    Math.abs(bbox1.x2 - bbox2.x2) < tolerance &&
    Math.abs(bbox1.y2 - bbox2.y2) < tolerance
  );
};