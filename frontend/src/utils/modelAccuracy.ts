import { SequenceWithAnnotation } from '@/types/api';

// Model accuracy classification types
export type ModelAccuracyType = 'true_positive' | 'false_positive' | 'false_negative' | 'unknown';

// Model accuracy result with display information
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
 * Determines the model accuracy type based on human annotation of detected sequence
 * Note: Sequence existence means model detected something (no true negatives possible)
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
 * Gets complete accuracy information for display
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
 * Analyzes model accuracy for a sequence
 */
export function analyzeSequenceAccuracy(sequence: SequenceWithAnnotation): ModelAccuracyResult {
  const hasSmoke = sequence.annotation?.has_smoke ?? null;
  const hasMissedSmoke = sequence.annotation?.has_missed_smoke ?? null;

  const accuracyType = getModelAccuracyType(hasSmoke, hasMissedSmoke);
  return getModelAccuracyResult(accuracyType);
}

/**
 * Centralized emoji mapping for false positive types
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
 * Formats false positive type for display
 */
export function formatFalsePositiveType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Robust parser for false positive types that handles multiple formats
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
 * Component for displaying model accuracy badge
 */
export interface ModelAccuracyBadgeProps {
  sequence: SequenceWithAnnotation;
  showDescription?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Gets CSS classes for model accuracy badge based on size
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
 * Gets row background classes for model accuracy visualization
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

// Helper functions for smoke type display
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

export const formatSmokeType = (type: string): string => {
  return type.charAt(0).toUpperCase() + type.slice(1);
};
