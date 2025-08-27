/**
 * Model accuracy utilities for wildfire detection analysis.
 *
 * This module provides utilities for analyzing and categorizing the accuracy
 * of machine learning model predictions in wildfire detection sequences.
 * It determines whether the model correctly identified smoke (true positive),
 * incorrectly flagged non-smoke (false positive), missed actual smoke (false negative),
 * or has insufficient data for classification (unknown).
 *
 * The accuracy classification is based on human annotation data comparing
 * model detections against ground truth annotations.
 *
 * @fileoverview Comprehensive utilities for model accuracy analysis,
 * classification, and visualization in the PyroAnnotator annotation interface.
 */

import { SequenceWithAnnotation } from '@/types/api';

/**
 * Model accuracy classification types for wildfire detection.
 *
 * These types represent the four possible outcomes when comparing
 * machine learning model predictions against human annotations.
 *
 * @typedef {'true_positive' | 'false_positive' | 'false_negative' | 'unknown'} ModelAccuracyType
 * @property {string} true_positive - Model correctly detected smoke
 * @property {string} false_positive - Model incorrectly flagged non-smoke as smoke
 * @property {string} false_negative - Model missed actual smoke in the sequence
 * @property {string} unknown - Insufficient annotation data for classification
 */
export type ModelAccuracyType = 'true_positive' | 'false_positive' | 'false_negative' | 'unknown';

/**
 * Complete model accuracy result with display and styling information.
 *
 * Provides all the data needed to render model accuracy information
 * in the user interface, including labels, descriptions, icons, and
 * CSS classes for consistent styling.
 *
 * @interface ModelAccuracyResult
 * @property {ModelAccuracyType} type - The accuracy classification type
 * @property {string} label - Human-readable display label
 * @property {string} description - Detailed description of the accuracy type
 * @property {string} icon - Emoji icon for visual representation
 * @property {string} colorClass - Tailwind CSS text color class
 * @property {string} borderClass - Tailwind CSS border color class
 * @property {string} bgClass - Tailwind CSS background color class
 */
export interface ModelAccuracyResult {
  type: ModelAccuracyType;
  label: string;
  description: string;
  icon: string;
  colorClass: string;
  borderClass: string;
  bgClass: string;
}

/**
 * Determines the model accuracy type based on human annotation of detected sequence.
 *
 * Analyzes the relationship between model predictions and human annotations
 * to classify the accuracy of the detection. Since sequences only exist when
 * the model detected something, true negatives are not possible in this context.
 *
 * The logic prioritizes false negatives (missed smoke) over other classifications,
 * as this represents the most critical type of model error for wildfire detection.
 *
 * @param {boolean | null} hasSmoke - Whether human annotator confirmed smoke presence
 * @param {boolean | null} hasMissedSmoke - Whether human annotator found missed smoke
 * @returns {ModelAccuracyType} The accuracy classification
 *
 * @example
 * ```typescript
 * // Model detected something, human confirmed smoke
 * const accuracy1 = getModelAccuracyType(true, false);
 * // Returns: 'true_positive'
 *
 * // Model detected something, human found no smoke
 * const accuracy2 = getModelAccuracyType(false, false);
 * // Returns: 'false_positive'
 *
 * // Model detected something, but human found missed smoke elsewhere
 * const accuracy3 = getModelAccuracyType(true, true);
 * // Returns: 'false_negative'
 * ```
 */
export function getModelAccuracyType(
  hasSmoke: boolean | null,
  hasMissedSmoke: boolean | null
): ModelAccuracyType {
  // If we don't have annotation data, we can't determine accuracy
  if (hasSmoke === null) return 'unknown';

  // FALSE NEGATIVES TAKE PRECEDENCE: If there's any missed smoke, it's a false negative
  if (hasMissedSmoke) {
    return 'false_negative';
  }

  if (hasSmoke) {
    // Model detected something, human confirmed smoke → Model correct
    return 'true_positive';
  } else {
    // Model detected something, human found no smoke → Model wrong
    return 'false_positive';
  }
}

/**
 * Gets complete accuracy information for display purposes.
 *
 * Converts a model accuracy type into a comprehensive result object
 * containing all the information needed for UI rendering, including
 * labels, descriptions, icons, and CSS styling classes.
 *
 * @param {ModelAccuracyType} accuracyType - The accuracy type to get information for
 * @returns {ModelAccuracyResult} Complete accuracy information with display properties
 *
 * @example
 * ```typescript
 * const result = getModelAccuracyResult('true_positive');
 * // Returns: {
 * //   type: 'true_positive',
 * //   label: 'True Positive',
 * //   description: 'Model correctly detected smoke',
 * //   icon: '✅',
 * //   colorClass: 'text-green-800',
 * //   borderClass: 'border-green-200',
 * //   bgClass: 'bg-green-100'
 * // }
 * ```
 */
export function getModelAccuracyResult(accuracyType: ModelAccuracyType): ModelAccuracyResult {
  const results: Record<ModelAccuracyType, ModelAccuracyResult> = {
    true_positive: {
      type: 'true_positive',
      label: 'True Positive',
      description: 'Model correctly detected smoke',
      icon: '✅',
      colorClass: 'text-green-800',
      borderClass: 'border-green-200',
      bgClass: 'bg-green-100',
    },
    false_positive: {
      type: 'false_positive',
      label: 'False Positive',
      description: 'Model incorrectly flagged non-smoke',
      icon: '❌',
      colorClass: 'text-red-800',
      borderClass: 'border-red-200',
      bgClass: 'bg-red-100',
    },
    false_negative: {
      type: 'false_negative',
      label: 'False Negative',
      description: 'Model missed actual smoke in sequence',
      icon: '🔍',
      colorClass: 'text-blue-800',
      borderClass: 'border-blue-200',
      bgClass: 'bg-blue-100',
    },
    unknown: {
      type: 'unknown',
      label: 'Unknown',
      description: 'Insufficient annotation data',
      icon: '❓',
      colorClass: 'text-gray-600',
      borderClass: 'border-gray-300',
      bgClass: 'bg-gray-50',
    },
  };

  return results[accuracyType];
}

/**
 * Analyzes model accuracy for a complete sequence with annotation data.
 *
 * Takes a sequence with its associated annotation data and performs
 * a complete accuracy analysis, returning the full result object
 * ready for display in the user interface.
 *
 * @param {SequenceWithAnnotation} sequence - Sequence with annotation data
 * @returns {ModelAccuracyResult} Complete accuracy analysis result
 *
 * @example
 * ```typescript
 * const result = analyzeSequenceAccuracy(sequence);
 * console.log(`Accuracy: ${result.label} - ${result.description}`);
 * // Output: "Accuracy: True Positive - Model correctly detected smoke"
 * ```
 */
export function analyzeSequenceAccuracy(sequence: SequenceWithAnnotation): ModelAccuracyResult {
  const hasSmoke = sequence.annotation?.has_smoke ?? null;
  const hasMissedSmoke = sequence.annotation?.has_missed_smoke ?? null;

  const accuracyType = getModelAccuracyType(hasSmoke, hasMissedSmoke);
  return getModelAccuracyResult(accuracyType);
}

/**
 * Gets the appropriate emoji icon for false positive classification types.
 *
 * Provides a centralized mapping of false positive types to their
 * corresponding emoji icons for consistent visual representation
 * across the application interface.
 *
 * @param {string} type - The false positive type identifier
 * @returns {string} Unicode emoji corresponding to the type
 *
 * @example
 * ```typescript
 * const emoji = getFalsePositiveEmoji('building');
 * // Returns: '🏢'
 *
 * const emoji2 = getFalsePositiveEmoji('water_body');
 * // Returns: '🌊'
 *
 * const emoji3 = getFalsePositiveEmoji('unknown_type');
 * // Returns: '❓' (fallback)
 * ```
 */
export const getFalsePositiveEmoji = (type: string): string => {
  const emojiMap: Record<string, string> = {
    antenna: '📡',
    building: '🏢',
    cliff: '⛰️',
    dark: '🌚',
    dust: '🌪️',
    high_cloud: '☁️',
    low_cloud: '☁️',
    lens_flare: '✨',
    lens_droplet: '💧',
    light: '💡',
    rain: '🌧️',
    trail: '🛤️',
    road: '🛣️',
    sky: '🌌',
    tree: '🌳',
    water_body: '🌊',
    other: '❓',
  };
  return emojiMap[type] || '❓';
};

/**
 * Formats false positive type identifiers for human-readable display.
 *
 * Converts underscore-separated type identifiers (e.g., 'high_cloud')
 * into properly formatted display labels (e.g., 'High Cloud') by
 * replacing underscores with spaces and capitalizing each word.
 *
 * @param {string} type - The false positive type identifier to format
 * @returns {string} Human-readable formatted label
 *
 * @example
 * ```typescript
 * const formatted = formatFalsePositiveType('lens_flare');
 * // Returns: 'Lens Flare'
 *
 * const formatted2 = formatFalsePositiveType('water_body');
 * // Returns: 'Water Body'
 *
 * const formatted3 = formatFalsePositiveType('building');
 * // Returns: 'Building'
 * ```
 */
export function formatFalsePositiveType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Robust parser for false positive types that handles multiple input formats.
 *
 * Safely parses false positive type data from various sources and formats,
 * including JSON arrays, comma-separated strings, single strings, and arrays.
 * Provides comprehensive error handling and fallbacks for malformed data.
 *
 * @param {string | string[] | null | undefined} value - Input value to parse
 * @returns {string[]} Array of parsed false positive type identifiers
 *
 * @example
 * ```typescript
 * // Parse JSON array string
 * const types1 = parseFalsePositiveTypes('["light", "dust", "building"]');
 * // Returns: ['light', 'dust', 'building']
 *
 * // Parse comma-separated string
 * const types2 = parseFalsePositiveTypes('antenna,cliff,road');
 * // Returns: ['antenna', 'cliff', 'road']
 *
 * // Parse single string
 * const types3 = parseFalsePositiveTypes('water_body');
 * // Returns: ['water_body']
 *
 * // Handle array input
 * const types4 = parseFalsePositiveTypes(['tree', 'sky']);
 * // Returns: ['tree', 'sky']
 *
 * // Handle null/undefined
 * const types5 = parseFalsePositiveTypes(null);
 * // Returns: []
 * ```
 */
export function parseFalsePositiveTypes(value: string | string[] | null | undefined): string[] {
  if (!value) {
    return [];
  }

  // If it's already an array, just filter and return
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === 'string');
  }

  // If it's not a string, return empty
  if (typeof value !== 'string') {
    return [];
  }

  // Try JSON parsing first (handles arrays like ["light", "dust"])
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(item => typeof item === 'string');
    }
    // If it's a single string value wrapped in JSON quotes
    if (typeof parsed === 'string') {
      return [parsed];
    }
  } catch {
    // JSON parsing failed, try other formats
  }

  // Handle comma-separated values (e.g., "light,dust,building")
  if (value.includes(',')) {
    return value
      .split(',')
      .map(type => type.trim())
      .filter(type => type.length > 0);
  }

  // Handle single string value (e.g., "light")
  return [value.trim()].filter(type => type.length > 0);
}

/**
 * Props interface for model accuracy badge components.
 *
 * Defines the configuration options for rendering model accuracy
 * badges in the user interface, including size variants and
 * optional description display.
 *
 * @interface ModelAccuracyBadgeProps
 * @property {SequenceWithAnnotation} sequence - Sequence data with annotation information
 * @property {boolean} [showDescription] - Optional flag to display detailed description
 * @property {'sm' | 'md' | 'lg'} [size='md'] - Badge size variant for different contexts
 *
 * @example
 * ```typescript
 * // Small badge without description
 * const props1: ModelAccuracyBadgeProps = {
 *   sequence: sequenceData,
 *   size: 'sm'
 * };
 *
 * // Large badge with description
 * const props2: ModelAccuracyBadgeProps = {
 *   sequence: sequenceData,
 *   showDescription: true,
 *   size: 'lg'
 * };
 * ```
 */
export interface ModelAccuracyBadgeProps {
  sequence: SequenceWithAnnotation;
  showDescription?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Generates CSS classes for model accuracy badges based on accuracy type and size.
 *
 * Combines size-specific styling with accuracy-based colors to create
 * consistent badge appearances across the application. Uses Tailwind CSS
 * classes for responsive and theme-consistent styling.
 *
 * @param {ModelAccuracyResult} accuracy - The accuracy result containing color classes
 * @param {'sm' | 'md' | 'lg'} [size='md'] - Badge size variant
 * @returns {string} Complete CSS class string for badge styling
 *
 * @example
 * ```typescript
 * const accuracy = getModelAccuracyResult('true_positive');
 * const classes = getModelAccuracyBadgeClasses(accuracy, 'lg');
 * // Returns: 'inline-flex items-center rounded-full font-medium px-3 py-1 text-sm text-green-800 bg-green-100'
 * ```
 */
export function getModelAccuracyBadgeClasses(
  accuracy: ModelAccuracyResult,
  size: 'sm' | 'md' | 'lg' = 'md'
): string {
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-2.5 py-0.5 text-xs',
    lg: 'px-3 py-1 text-sm',
  };

  return `inline-flex items-center rounded-full font-medium ${sizeClasses[size]} ${accuracy.colorClass} ${accuracy.bgClass}`;
}

/**
 * Gets background CSS classes for table rows based on model accuracy.
 *
 * Provides subtle background colors for table rows to visually distinguish
 * different accuracy types, enhancing the user's ability to quickly scan
 * and identify accuracy patterns in data tables.
 *
 * @param {ModelAccuracyResult} accuracy - The accuracy result to style
 * @returns {string} CSS classes for row background and hover effects
 *
 * @example
 * ```typescript
 * const accuracy = getModelAccuracyResult('false_positive');
 * const bgClasses = getRowBackgroundClasses(accuracy);
 * // Returns: 'bg-red-50 hover:bg-red-100'
 * ```
 */
export function getRowBackgroundClasses(accuracy: ModelAccuracyResult): string {
  const backgroundClasses = {
    true_positive: 'bg-green-50 hover:bg-green-100',
    false_positive: 'bg-red-50 hover:bg-red-100',
    false_negative: 'bg-blue-50 hover:bg-blue-100',
    unknown: 'hover:bg-gray-50',
  };

  return backgroundClasses[accuracy.type];
}

/**
 * Gets the appropriate emoji icon for smoke type classification.
 *
 * Provides visual icons for different smoke types to enhance
 * the user interface with intuitive visual cues that help
 * users quickly identify smoke classification categories.
 *
 * @param {string} type - The smoke type identifier ('wildfire', 'industrial', 'other')
 * @returns {string} Unicode emoji corresponding to the smoke type
 *
 * @example
 * ```typescript
 * const emoji = getSmokeTypeEmoji('wildfire');
 * // Returns: '🔥'
 *
 * const emoji2 = getSmokeTypeEmoji('industrial');
 * // Returns: '🏷'
 *
 * const emoji3 = getSmokeTypeEmoji('other');
 * // Returns: '💨'
 * ```
 */
export const getSmokeTypeEmoji = (type: string): string => {
  switch (type) {
    case 'wildfire':
      return '🔥';
    case 'industrial':
      return '🏭';
    case 'other':
      return '💨';
    default:
      return '💨';
  }
};

/**
 * Formats smoke type identifiers for human-readable display.
 *
 * Converts lowercase smoke type identifiers into properly capitalized
 * labels suitable for display in the user interface.
 *
 * @param {string} type - The smoke type identifier to format
 * @returns {string} Capitalized smoke type label
 *
 * @example
 * ```typescript
 * const formatted = formatSmokeType('wildfire');
 * // Returns: 'Wildfire'
 *
 * const formatted2 = formatSmokeType('industrial');
 * // Returns: 'Industrial'
 *
 * const formatted3 = formatSmokeType('other');
 * // Returns: 'Other'
 * ```
 */
export const formatSmokeType = (type: string): string => {
  return type.charAt(0).toUpperCase() + type.slice(1);
};
