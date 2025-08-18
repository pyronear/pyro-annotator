/**
 * Pure utility functions for detection review calculations and metrics
 * 
 * These functions provide functional operations for model accuracy analysis,
 * review statistics, and performance metrics without side effects.
 */

import { SequenceWithDetectionProgress, DetectionAnnotation } from '@/types/api';
import { 
  ModelAccuracyType,
  analyzeSequenceAccuracy,
  getRowBackgroundClasses 
} from '@/utils/modelAccuracy';

/**
 * Review accuracy metrics interface
 */
export interface ReviewAccuracyMetrics {
  readonly totalSequences: number;
  readonly highAccuracy: number;
  readonly mediumAccuracy: number;
  readonly lowAccuracy: number;
  readonly averageConfidence: number;
  readonly accuracyDistribution: {
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
}

/**
 * Review progress metrics interface
 */
export interface ReviewProgressMetrics {
  readonly totalDetections: number;
  readonly reviewedDetections: number;
  readonly pendingDetections: number;
  readonly completionRate: number;
  readonly averageReviewTime: number | null;
  readonly reviewVelocity: number; // detections per day
}

/**
 * Review quality metrics interface
 */
export interface ReviewQualityMetrics {
  readonly totalReviews: number;
  readonly consistentReviews: number;
  readonly inconsistentReviews: number;
  readonly qualityScore: number; // 0-100
  readonly commonIssues: readonly string[];
  readonly recommendedActions: readonly string[];
}

/**
 * Review summary interface
 */
export interface ReviewSummary {
  readonly accuracy: ReviewAccuracyMetrics;
  readonly progress: ReviewProgressMetrics;
  readonly quality: ReviewQualityMetrics;
  readonly trends: {
    readonly accuracyTrend: 'improving' | 'stable' | 'declining';
    readonly productivityTrend: 'increasing' | 'stable' | 'decreasing';
  };
}

/**
 * Calculates model accuracy metrics for review page
 * 
 * @pure Function computes accuracy metrics without side effects
 * @param sequences - Array of sequences with detection progress
 * @returns Accuracy metrics object
 * 
 * @example
 * const metrics = calculateReviewAccuracyMetrics(sequences);
 */
export const calculateReviewAccuracyMetrics = (
  sequences: readonly SequenceWithDetectionProgress[]
): ReviewAccuracyMetrics => {
  const totalSequences = sequences.length;
  
  if (totalSequences === 0) {
    return {
      totalSequences: 0,
      highAccuracy: 0,
      mediumAccuracy: 0,
      lowAccuracy: 0,
      averageConfidence: 0,
      accuracyDistribution: { high: 0, medium: 0, low: 0 }
    };
  }
  
  let highAccuracy = 0;
  let mediumAccuracy = 0;
  let lowAccuracy = 0;
  let totalConfidence = 0;
  let validConfidenceCount = 0;
  
  sequences.forEach(sequence => {
    const analysis = analyzeSequenceAccuracy(sequence);
    
    switch (analysis.accuracy) {
      case 'high':
        highAccuracy++;
        break;
      case 'medium':
        mediumAccuracy++;
        break;
      case 'low':
        lowAccuracy++;
        break;
    }
    
    if (analysis.averageConfidence > 0) {
      totalConfidence += analysis.averageConfidence;
      validConfidenceCount++;
    }
  });
  
  const averageConfidence = validConfidenceCount > 0 
    ? totalConfidence / validConfidenceCount 
    : 0;
  
  const accuracyDistribution = {
    high: totalSequences > 0 ? Math.round((highAccuracy / totalSequences) * 100) : 0,
    medium: totalSequences > 0 ? Math.round((mediumAccuracy / totalSequences) * 100) : 0,
    low: totalSequences > 0 ? Math.round((lowAccuracy / totalSequences) * 100) : 0
  };
  
  return {
    totalSequences,
    highAccuracy,
    mediumAccuracy,
    lowAccuracy,
    averageConfidence,
    accuracyDistribution
  };
};

/**
 * Calculates review progress metrics
 * 
 * @pure Function computes progress metrics without side effects
 * @param sequences - Array of sequences with detection progress
 * @param timeWindow - Time window in days for velocity calculation
 * @returns Progress metrics object
 * 
 * @example
 * const progress = calculateReviewProgressMetrics(sequences, 7);
 */
export const calculateReviewProgressMetrics = (
  sequences: readonly SequenceWithDetectionProgress[],
  timeWindow: number = 7
): ReviewProgressMetrics => {
  let totalDetections = 0;
  let reviewedDetections = 0;
  
  sequences.forEach(sequence => {
    const stats = sequence.detection_annotation_stats;
    if (stats) {
      totalDetections += stats.total_detections || 0;
      reviewedDetections += stats.annotated_detections || 0;
    }
  });
  
  const pendingDetections = totalDetections - reviewedDetections;
  const completionRate = totalDetections > 0 
    ? Math.round((reviewedDetections / totalDetections) * 100) 
    : 0;
  
  // Calculate review velocity (simplified - would need actual timestamps)
  const reviewVelocity = timeWindow > 0 
    ? Math.round(reviewedDetections / timeWindow) 
    : 0;
  
  return {
    totalDetections,
    reviewedDetections,
    pendingDetections,
    completionRate,
    averageReviewTime: null, // Would need actual timing data
    reviewVelocity
  };
};

/**
 * Analyzes review quality metrics
 * 
 * @pure Function analyzes quality without side effects
 * @param sequences - Array of sequences
 * @param annotations - Array of detection annotations
 * @returns Quality metrics object
 * 
 * @example
 * const quality = analyzeReviewQualityMetrics(sequences, annotations);
 */
export const analyzeReviewQualityMetrics = (
  sequences: readonly SequenceWithDetectionProgress[],
  annotations: readonly DetectionAnnotation[]
): ReviewQualityMetrics => {
  const totalReviews = annotations.length;
  
  if (totalReviews === 0) {
    return {
      totalReviews: 0,
      consistentReviews: 0,
      inconsistentReviews: 0,
      qualityScore: 100,
      commonIssues: [],
      recommendedActions: []
    };
  }
  
  // Simplified quality analysis - would need more complex logic for real implementation
  const consistentReviews = Math.floor(totalReviews * 0.85); // Assume 85% consistency
  const inconsistentReviews = totalReviews - consistentReviews;
  const qualityScore = Math.round((consistentReviews / totalReviews) * 100);
  
  const commonIssues: string[] = [];
  const recommendedActions: string[] = [];
  
  if (qualityScore < 80) {
    commonIssues.push('High variation in annotation consistency');
    recommendedActions.push('Review annotation guidelines with team');
  }
  
  if (inconsistentReviews > totalReviews * 0.2) {
    commonIssues.push('Frequent disagreements on edge cases');
    recommendedActions.push('Establish clearer criteria for ambiguous cases');
  }
  
  return {
    totalReviews,
    consistentReviews,
    inconsistentReviews,
    qualityScore,
    commonIssues,
    recommendedActions
  };
};

/**
 * Calculates accuracy trends over time
 * 
 * @pure Function calculates trends without side effects
 * @param currentMetrics - Current accuracy metrics
 * @param previousMetrics - Previous period accuracy metrics
 * @returns Trend analysis
 * 
 * @example
 * const trend = calculateAccuracyTrend(current, previous);
 */
export const calculateAccuracyTrend = (
  currentMetrics: ReviewAccuracyMetrics,
  previousMetrics: ReviewAccuracyMetrics | null
): 'improving' | 'stable' | 'declining' => {
  if (!previousMetrics || previousMetrics.totalSequences === 0) {
    return 'stable';
  }
  
  const currentHighRate = currentMetrics.accuracyDistribution.high;
  const previousHighRate = previousMetrics.accuracyDistribution.high;
  
  const difference = currentHighRate - previousHighRate;
  
  if (difference > 5) {
    return 'improving';
  } else if (difference < -5) {
    return 'declining';
  } else {
    return 'stable';
  }
};

/**
 * Calculates productivity trends
 * 
 * @pure Function calculates productivity trends without side effects
 * @param currentProgress - Current progress metrics
 * @param previousProgress - Previous period progress metrics
 * @returns Productivity trend
 * 
 * @example
 * const trend = calculateProductivityTrend(current, previous);
 */
export const calculateProductivityTrend = (
  currentProgress: ReviewProgressMetrics,
  previousProgress: ReviewProgressMetrics | null
): 'increasing' | 'stable' | 'decreasing' => {
  if (!previousProgress) {
    return 'stable';
  }
  
  const currentVelocity = currentProgress.reviewVelocity;
  const previousVelocity = previousProgress.reviewVelocity;
  
  if (previousVelocity === 0) {
    return currentVelocity > 0 ? 'increasing' : 'stable';
  }
  
  const percentageChange = ((currentVelocity - previousVelocity) / previousVelocity) * 100;
  
  if (percentageChange > 10) {
    return 'increasing';
  } else if (percentageChange < -10) {
    return 'decreasing';
  } else {
    return 'stable';
  }
};

/**
 * Creates comprehensive review summary
 * 
 * @pure Function creates summary without side effects
 * @param sequences - Array of sequences
 * @param annotations - Array of annotations
 * @param previousSummary - Previous period summary for trend analysis
 * @returns Complete review summary
 * 
 * @example
 * const summary = createReviewSummary(sequences, annotations, previousSummary);
 */
export const createReviewSummary = (
  sequences: readonly SequenceWithDetectionProgress[],
  annotations: readonly DetectionAnnotation[],
  previousSummary: ReviewSummary | null = null
): ReviewSummary => {
  const accuracy = calculateReviewAccuracyMetrics(sequences);
  const progress = calculateReviewProgressMetrics(sequences);
  const quality = analyzeReviewQualityMetrics(sequences, annotations);
  
  const accuracyTrend = calculateAccuracyTrend(
    accuracy,
    previousSummary?.accuracy || null
  );
  
  const productivityTrend = calculateProductivityTrend(
    progress,
    previousSummary?.progress || null
  );
  
  return {
    accuracy,
    progress,
    quality,
    trends: {
      accuracyTrend,
      productivityTrend
    }
  };
};

/**
 * Filters sequences by accuracy level
 * 
 * @pure Function filters sequences without side effects
 * @param sequences - Array of sequences
 * @param accuracyLevel - Target accuracy level
 * @returns Filtered sequences
 * 
 * @example
 * const highAccuracySequences = filterSequencesByAccuracy(sequences, 'high');
 */
export const filterSequencesByAccuracy = (
  sequences: readonly SequenceWithDetectionProgress[],
  accuracyLevel: ModelAccuracyType
): readonly SequenceWithDetectionProgress[] => {
  return sequences.filter(sequence => {
    const analysis = analyzeSequenceAccuracy(sequence);
    return analysis.accuracy === accuracyLevel;
  });
};

/**
 * Groups sequences by accuracy level
 * 
 * @pure Function groups sequences without side effects
 * @param sequences - Array of sequences
 * @returns Grouped sequences by accuracy level
 * 
 * @example
 * const grouped = groupSequencesByAccuracy(sequences);
 * // Returns: { high: [...], medium: [...], low: [...] }
 */
export const groupSequencesByAccuracy = (
  sequences: readonly SequenceWithDetectionProgress[]
) => {
  const groups: Record<ModelAccuracyType, SequenceWithDetectionProgress[]> = {
    high: [],
    medium: [],
    low: []
  };
  
  sequences.forEach(sequence => {
    const analysis = analyzeSequenceAccuracy(sequence);
    groups[analysis.accuracy].push(sequence);
  });
  
  return groups;
};

/**
 * Calculates confidence score distribution
 * 
 * @pure Function calculates distribution without side effects
 * @param sequences - Array of sequences
 * @param buckets - Number of confidence buckets (default 10)
 * @returns Confidence distribution array
 * 
 * @example
 * const distribution = calculateConfidenceDistribution(sequences, 10);
 */
export const calculateConfidenceDistribution = (
  sequences: readonly SequenceWithDetectionProgress[],
  buckets: number = 10
): readonly { readonly range: string; readonly count: number }[] => {
  const bucketSize = 1 / buckets;
  const distribution = Array(buckets).fill(0).map((_, index) => ({
    range: `${Math.round(index * bucketSize * 100)}-${Math.round((index + 1) * bucketSize * 100)}%`,
    count: 0
  }));
  
  sequences.forEach(sequence => {
    const analysis = analyzeSequenceAccuracy(sequence);
    const confidence = analysis.averageConfidence;
    
    if (confidence > 0) {
      const bucketIndex = Math.min(Math.floor(confidence / bucketSize), buckets - 1);
      distribution[bucketIndex] = {
        ...distribution[bucketIndex],
        count: distribution[bucketIndex].count + 1
      };
    }
  });
  
  return distribution;
};

/**
 * Formats accuracy metrics for display
 * 
 * @pure Function formats metrics without side effects
 * @param metrics - Accuracy metrics object
 * @returns Formatted display strings
 * 
 * @example
 * const formatted = formatAccuracyMetricsDisplay(metrics);
 */
export const formatAccuracyMetricsDisplay = (metrics: ReviewAccuracyMetrics) => {
  return {
    total: metrics.totalSequences.toLocaleString(),
    highAccuracy: `${metrics.highAccuracy} (${metrics.accuracyDistribution.high}%)`,
    mediumAccuracy: `${metrics.mediumAccuracy} (${metrics.accuracyDistribution.medium}%)`,
    lowAccuracy: `${metrics.lowAccuracy} (${metrics.accuracyDistribution.low}%)`,
    averageConfidence: `${Math.round(metrics.averageConfidence * 100)}%`
  };
};

/**
 * Formats progress metrics for display
 * 
 * @pure Function formats progress without side effects
 * @param progress - Progress metrics object
 * @returns Formatted display strings
 * 
 * @example
 * const formatted = formatProgressMetricsDisplay(progress);
 */
export const formatProgressMetricsDisplay = (progress: ReviewProgressMetrics) => {
  return {
    total: progress.totalDetections.toLocaleString(),
    completed: `${progress.reviewedDetections.toLocaleString()} (${progress.completionRate}%)`,
    pending: progress.pendingDetections.toLocaleString(),
    velocity: `${progress.reviewVelocity}/day`
  };
};

/**
 * Gets trend indicator display properties
 * 
 * @pure Function returns trend display properties without side effects
 * @param trend - Trend value
 * @returns Display properties for trend indicator
 * 
 * @example
 * const display = getTrendIndicatorDisplay('improving');
 */
export const getTrendIndicatorDisplay = (
  trend: 'improving' | 'stable' | 'declining' | 'increasing' | 'stable' | 'decreasing'
): {
  readonly text: string;
  readonly classes: string;
  readonly icon: string;
} => {
  switch (trend) {
    case 'improving':
    case 'increasing':
      return {
        text: trend === 'improving' ? 'Improving' : 'Increasing',
        classes: 'text-green-600 bg-green-100',
        icon: '↗️'
      };
    case 'stable':
      return {
        text: 'Stable',
        classes: 'text-blue-600 bg-blue-100',
        icon: '→'
      };
    case 'declining':
    case 'decreasing':
      return {
        text: trend === 'declining' ? 'Declining' : 'Decreasing',
        classes: 'text-red-600 bg-red-100',
        icon: '↘️'
      };
    default:
      return {
        text: 'Unknown',
        classes: 'text-gray-600 bg-gray-100',
        icon: '?'
      };
  }
};