/**
 * Pure prediction filtering utilities for AI model predictions
 * 
 * This module provides referentially transparent functions for filtering
 * and processing AI predictions based on various criteria.
 */

import { AlgoPrediction } from '@/types/api';
import { isValidPrediction, doBboxesMatch, NormalizedBbox } from './validation';

/**
 * Drawn rectangle representation for comparison
 */
export interface DrawnRectangle {
  readonly id: string;
  readonly xyxyn: readonly [number, number, number, number];
  readonly smokeType: string;
}

/**
 * Validated prediction with guaranteed valid structure
 */
export interface ValidatedPrediction extends AlgoPrediction {
  readonly isValid: true;
}

/**
 * Prediction filtering criteria
 */
export interface PredictionFilters {
  readonly minConfidence?: number;
  readonly maxConfidence?: number;
  readonly allowedClassNames?: readonly string[];
  readonly excludeClassNames?: readonly string[];
}

/**
 * Filters predictions that have valid bounding box coordinates
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param predictions - Array of AI predictions to filter
 * 
 * @returns Array of predictions with valid coordinates
 * 
 * @example
 * const predictions = [
 *   { xyxyn: [0.1, 0.2, 0.8, 0.7], confidence: 0.85, class_name: 'smoke' },
 *   { xyxyn: [1.1, 0.2, 0.8, 0.7], confidence: 0.75, class_name: 'smoke' }, // invalid
 * ]
 * const valid = filterValidPredictions(predictions)
 * // Result: [first prediction only]
 */
export const filterValidPredictions = (predictions: AlgoPrediction[]): ValidatedPrediction[] => {
  return predictions
    .filter(isValidPrediction)
    .map(prediction => ({ ...prediction, isValid: true as const }));
};

/**
 * Filters predictions by confidence threshold
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param predictions - Array of predictions to filter
 * @param minConfidence - Minimum confidence threshold (inclusive)
 * @param maxConfidence - Maximum confidence threshold (inclusive, optional)
 * 
 * @returns Predictions within confidence range
 * 
 * @example
 * const predictions = [
 *   { xyxyn: [0.1, 0.2, 0.8, 0.7], confidence: 0.85, class_name: 'smoke' },
 *   { xyxyn: [0.2, 0.3, 0.7, 0.6], confidence: 0.25, class_name: 'smoke' },
 * ]
 * const filtered = filterByConfidence(predictions, 0.5)
 * // Result: [first prediction only]
 */
export const filterByConfidence = (
  predictions: AlgoPrediction[],
  minConfidence: number,
  maxConfidence?: number
): AlgoPrediction[] => {
  return predictions.filter(prediction => {
    const conf = prediction.confidence;
    const meetsMin = conf >= minConfidence;
    const meetsMax = maxConfidence === undefined || conf <= maxConfidence;
    return meetsMin && meetsMax;
  });
};

/**
 * Filters predictions by class name
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param predictions - Array of predictions to filter
 * @param allowedClassNames - Array of allowed class names (if provided)
 * @param excludeClassNames - Array of class names to exclude (if provided)
 * 
 * @returns Predictions with matching class names
 * 
 * @example
 * const predictions = [
 *   { xyxyn: [0.1, 0.2, 0.8, 0.7], confidence: 0.85, class_name: 'smoke' },
 *   { xyxyn: [0.2, 0.3, 0.7, 0.6], confidence: 0.75, class_name: 'fire' },
 * ]
 * const smokeOnly = filterByClassName(predictions, ['smoke'])
 * // Result: [first prediction only]
 */
export const filterByClassName = (
  predictions: AlgoPrediction[],
  allowedClassNames?: readonly string[],
  excludeClassNames?: readonly string[]
): AlgoPrediction[] => {
  return predictions.filter(prediction => {
    const className = prediction.class_name;
    
    // Check allowed list
    if (allowedClassNames && allowedClassNames.length > 0) {
      if (!allowedClassNames.includes(className)) {
        return false;
      }
    }
    
    // Check exclude list
    if (excludeClassNames && excludeClassNames.length > 0) {
      if (excludeClassNames.includes(className)) {
        return false;
      }
    }
    
    return true;
  });
};

/**
 * Applies multiple filters to predictions
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param predictions - Array of predictions to filter
 * @param filters - Filtering criteria
 * 
 * @returns Filtered predictions
 * 
 * @example
 * const predictions = [
 *   { xyxyn: [0.1, 0.2, 0.8, 0.7], confidence: 0.85, class_name: 'smoke' },
 *   { xyxyn: [0.2, 0.3, 0.7, 0.6], confidence: 0.25, class_name: 'smoke' },
 *   { xyxyn: [0.3, 0.4, 0.6, 0.5], confidence: 0.75, class_name: 'fire' },
 * ]
 * const filtered = filterPredictions(predictions, {
 *   minConfidence: 0.5,
 *   allowedClassNames: ['smoke']
 * })
 * // Result: [first prediction only]
 */
export const filterPredictions = (
  predictions: AlgoPrediction[],
  filters: PredictionFilters
): AlgoPrediction[] => {
  let filtered = predictions;
  
  // Apply confidence filter
  if (filters.minConfidence !== undefined || filters.maxConfidence !== undefined) {
    filtered = filterByConfidence(
      filtered,
      filters.minConfidence ?? 0,
      filters.maxConfidence
    );
  }
  
  // Apply class name filter
  if (filters.allowedClassNames || filters.excludeClassNames) {
    filtered = filterByClassName(
      filtered,
      filters.allowedClassNames,
      filters.excludeClassNames
    );
  }
  
  return filtered;
};

/**
 * Removes duplicate predictions based on bounding box coordinates
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param predictions - Array of predictions potentially containing duplicates
 * @param tolerance - Tolerance for coordinate matching (default: 0.01)
 * 
 * @returns Array with duplicate predictions removed (keeps first occurrence)
 * 
 * @example
 * const predictions = [
 *   { xyxyn: [0.1, 0.2, 0.8, 0.7], confidence: 0.85, class_name: 'smoke' },
 *   { xyxyn: [0.101, 0.199, 0.801, 0.699], confidence: 0.75, class_name: 'smoke' }, // near duplicate
 * ]
 * const unique = removeDuplicatePredictions(predictions, 0.01)
 * // Result: [first prediction only]
 */
export const removeDuplicatePredictions = (
  predictions: AlgoPrediction[],
  tolerance: number = 0.01
): AlgoPrediction[] => {
  const unique: AlgoPrediction[] = [];
  
  for (const prediction of predictions) {
    const [x1, y1, x2, y2] = prediction.xyxyn;
    const currentBbox: NormalizedBbox = { x1, y1, x2, y2 };
    
    // Check if this prediction is similar to any already added
    const isDuplicate = unique.some(existing => {
      const [ex1, ey1, ex2, ey2] = existing.xyxyn;
      const existingBbox: NormalizedBbox = { x1: ex1, y1: ey1, x2: ex2, y2: ey2 };
      return doBboxesMatch(currentBbox, existingBbox, tolerance);
    });
    
    if (!isDuplicate) {
      unique.push(prediction);
    }
  }
  
  return unique;
};

/**
 * Finds predictions that don't match any existing drawn rectangles
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param predictions - AI predictions to check
 * @param drawnRectangles - Existing drawn rectangles
 * @param tolerance - Tolerance for coordinate matching (default: 0.01)
 * 
 * @returns Predictions that don't match existing rectangles
 * 
 * @example
 * const predictions = [
 *   { xyxyn: [0.1, 0.2, 0.8, 0.7], confidence: 0.85, class_name: 'smoke' },
 *   { xyxyn: [0.2, 0.3, 0.7, 0.6], confidence: 0.75, class_name: 'smoke' },
 * ]
 * const existing = [
 *   { id: '1', xyxyn: [0.101, 0.199, 0.801, 0.699], smokeType: 'wildfire' }
 * ]
 * const newPredictions = findNewPredictions(predictions, existing, 0.01)
 * // Result: [second prediction only]
 */
export const findNewPredictions = (
  predictions: AlgoPrediction[],
  drawnRectangles: readonly DrawnRectangle[],
  tolerance: number = 0.01
): AlgoPrediction[] => {
  return predictions.filter(prediction => {
    const [x1, y1, x2, y2] = prediction.xyxyn;
    const predictionBbox: NormalizedBbox = { x1, y1, x2, y2 };
    
    // Check if this prediction matches any AI-imported rectangle
    return !drawnRectangles.some(rect => {
      // Only check AI-imported rectangles
      if (!rect.id.startsWith('imported-')) {
        return false;
      }
      
      const [rx1, ry1, rx2, ry2] = rect.xyxyn;
      const rectBbox: NormalizedBbox = { x1: rx1, y1: ry1, x2: rx2, y2: ry2 };
      return doBboxesMatch(predictionBbox, rectBbox, tolerance);
    });
  });
};

/**
 * Sorts predictions by confidence score
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param predictions - Predictions to sort
 * @param descending - Sort in descending order (default: true)
 * 
 * @returns Sorted predictions array
 * 
 * @example
 * const predictions = [
 *   { xyxyn: [0.1, 0.2, 0.8, 0.7], confidence: 0.75, class_name: 'smoke' },
 *   { xyxyn: [0.2, 0.3, 0.7, 0.6], confidence: 0.85, class_name: 'smoke' },
 * ]
 * const sorted = sortByConfidence(predictions)
 * // Result: [second prediction, first prediction] (by confidence desc)
 */
export const sortByConfidence = (
  predictions: AlgoPrediction[],
  descending: boolean = true
): AlgoPrediction[] => {
  const sorted = [...predictions].sort((a, b) => {
    const diff = a.confidence - b.confidence;
    return descending ? -diff : diff;
  });
  return sorted;
};

/**
 * Gets count of valid predictions that can be imported
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param predictions - All available predictions
 * @param drawnRectangles - Existing drawn rectangles  
 * @param filters - Optional filtering criteria
 * 
 * @returns Number of importable predictions
 * 
 * @example
 * const predictions = [
 *   { xyxyn: [0.1, 0.2, 0.8, 0.7], confidence: 0.85, class_name: 'smoke' },
 *   { xyxyn: [1.1, 0.2, 0.8, 0.7], confidence: 0.75, class_name: 'smoke' }, // invalid coords
 * ]
 * const count = getImportablePredictionCount(predictions, [])
 * // Result: 1
 */
export const getImportablePredictionCount = (
  predictions: AlgoPrediction[],
  drawnRectangles: readonly DrawnRectangle[],
  filters?: PredictionFilters
): number => {
  let filtered = filterValidPredictions(predictions);
  
  if (filters) {
    filtered = filterPredictions(filtered, filters);
  }
  
  const newPredictions = findNewPredictions(filtered, drawnRectangles);
  return newPredictions.length;
};

/**
 * Prepares predictions for import by applying all necessary filters
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param predictions - Raw predictions from AI model
 * @param drawnRectangles - Existing drawn rectangles
 * @param filters - Optional filtering criteria
 * 
 * @returns Clean, validated predictions ready for import
 * 
 * @example
 * const predictions = [
 *   { xyxyn: [0.1, 0.2, 0.8, 0.7], confidence: 0.85, class_name: 'smoke' },
 *   { xyxyn: [0.2, 0.3, 0.7, 0.6], confidence: 0.25, class_name: 'smoke' },
 * ]
 * const prepared = preparePredictionsForImport(predictions, [], { minConfidence: 0.5 })
 * // Result: [first prediction only]
 */
export const preparePredictionsForImport = (
  predictions: AlgoPrediction[],
  drawnRectangles: readonly DrawnRectangle[],
  filters?: PredictionFilters
): ValidatedPrediction[] => {
  // Start with valid predictions only
  let prepared = filterValidPredictions(predictions);
  
  // Apply custom filters if provided  
  if (filters) {
    const filtered = filterPredictions(prepared, filters);
    prepared = filtered.filter(isValidPrediction).map(p => ({ ...p, isValid: true as const }));
  }
  
  // Remove duplicates
  const deduplicated = removeDuplicatePredictions(prepared);
  prepared = deduplicated.filter(isValidPrediction).map(p => ({ ...p, isValid: true as const }));
  
  // Find only new predictions (not already imported)
  const newPreds = findNewPredictions(prepared, drawnRectangles);
  prepared = newPreds.filter(isValidPrediction).map(p => ({ ...p, isValid: true as const }));
  
  // Sort by confidence for consistent ordering
  const sorted = sortByConfidence(prepared);
  prepared = sorted.filter(isValidPrediction).map(p => ({ ...p, isValid: true as const }));
  
  return prepared;
};