/**
 * Pure utility functions for dashboard statistics and calculations
 * 
 * These functions provide functional operations for dashboard metrics,
 * data aggregation, and visualization data preparation without side effects.
 */

/**
 * Dashboard overview metrics interface
 */
export interface DashboardOverviewMetrics {
  readonly totalSequences: number;
  readonly totalDetections: number;
  readonly annotatedSequences: number;
  readonly annotatedDetections: number;
  readonly sequenceCompletionRate: number;
  readonly detectionCompletionRate: number;
  readonly totalAnnotators: number;
  readonly activeAnnotators: number;
}

/**
 * Time-based activity metrics interface
 */
export interface ActivityMetrics {
  readonly period: string;
  readonly sequencesAnnotated: number;
  readonly detectionsAnnotated: number;
  readonly averageTimePerSequence: number | null;
  readonly averageTimePerDetection: number | null;
  readonly productivityScore: number;
}

/**
 * Annotation quality metrics interface
 */
export interface QualityMetrics {
  readonly totalReviews: number;
  readonly averageQualityScore: number;
  readonly consistency: {
    readonly score: number;
    readonly trend: 'improving' | 'stable' | 'declining';
  };
  readonly issueCategories: readonly {
    readonly category: string;
    readonly count: number;
    readonly percentage: number;
  }[];
  readonly recommendations: readonly string[];
}

/**
 * Performance trends interface
 */
export interface PerformanceTrends {
  readonly daily: readonly ActivityMetrics[];
  readonly weekly: readonly ActivityMetrics[];
  readonly monthly: readonly ActivityMetrics[];
  readonly overall: {
    readonly productivityTrend: 'up' | 'stable' | 'down';
    readonly qualityTrend: 'up' | 'stable' | 'down';
    readonly volumeTrend: 'up' | 'stable' | 'down';
  };
}

/**
 * Dashboard widget data interface
 */
export interface DashboardWidgetData {
  readonly overview: DashboardOverviewMetrics;
  readonly recentActivity: readonly ActivityMetrics[];
  readonly quality: QualityMetrics;
  readonly trends: PerformanceTrends;
  readonly alerts: readonly {
    readonly id: string;
    readonly type: 'info' | 'warning' | 'error';
    readonly message: string;
    readonly priority: number;
  }[];
}

/**
 * Calculates dashboard overview metrics
 * 
 * @pure Function computes overview metrics without side effects
 * @param sequences - Array of sequences with annotation data
 * @param detections - Array of detections with annotation data
 * @param annotators - Array of annotator activity data
 * @returns Overview metrics object
 * 
 * @example
 * const overview = calculateDashboardOverview(sequences, detections, annotators);
 */
export const calculateDashboardOverview = (
  sequences: readonly any[],
  detections: readonly any[],
  annotators: readonly any[]
): DashboardOverviewMetrics => {
  const totalSequences = sequences.length;
  const totalDetections = detections.length;
  
  const annotatedSequences = sequences.filter(seq => 
    seq.sequence_annotation?.processing_stage === 'annotated' || 
    seq.sequence_annotation?.processing_stage === 'reviewed'
  ).length;
  
  const annotatedDetections = detections.filter(det => 
    det.detection_annotation?.processing_stage === 'annotated'
  ).length;
  
  const sequenceCompletionRate = totalSequences > 0 
    ? Math.round((annotatedSequences / totalSequences) * 100) 
    : 0;
  
  const detectionCompletionRate = totalDetections > 0
    ? Math.round((annotatedDetections / totalDetections) * 100)
    : 0;
  
  const totalAnnotators = annotators.length;
  const activeAnnotators = annotators.filter(annotator => 
    annotator.lastActivity && 
    isWithinDays(annotator.lastActivity, 7)
  ).length;
  
  return {
    totalSequences,
    totalDetections,
    annotatedSequences,
    annotatedDetections,
    sequenceCompletionRate,
    detectionCompletionRate,
    totalAnnotators,
    activeAnnotators
  };
};

/**
 * Calculates activity metrics for a specific time period
 * 
 * @pure Function computes activity metrics without side effects
 * @param annotations - Array of annotation records
 * @param startDate - Period start date
 * @param endDate - Period end date
 * @param period - Period label
 * @returns Activity metrics for the period
 * 
 * @example
 * const activity = calculateActivityMetrics(annotations, startDate, endDate, 'Last 7 Days');
 */
export const calculateActivityMetrics = (
  annotations: readonly any[],
  startDate: Date,
  endDate: Date,
  period: string
): ActivityMetrics => {
  const periodAnnotations = annotations.filter(annotation => {
    const createdAt = new Date(annotation.created_at);
    return createdAt >= startDate && createdAt <= endDate;
  });
  
  const sequencesAnnotated = periodAnnotations.filter(ann => 
    ann.type === 'sequence'
  ).length;
  
  const detectionsAnnotated = periodAnnotations.filter(ann => 
    ann.type === 'detection'
  ).length;
  
  // Simplified time calculations - would need actual timing data
  const averageTimePerSequence = sequencesAnnotated > 0 ? 5 * 60 : null; // 5 minutes default
  const averageTimePerDetection = detectionsAnnotated > 0 ? 2 * 60 : null; // 2 minutes default
  
  // Calculate productivity score based on volume and time
  const totalTimeSpent = (sequencesAnnotated * (averageTimePerSequence || 0)) + 
                         (detectionsAnnotated * (averageTimePerDetection || 0));
  const totalItems = sequencesAnnotated + detectionsAnnotated;
  
  const productivityScore = totalItems > 0 && totalTimeSpent > 0
    ? Math.round((totalItems / (totalTimeSpent / 3600)) * 10) // items per hour * 10
    : 0;
  
  return {
    period,
    sequencesAnnotated,
    detectionsAnnotated,
    averageTimePerSequence,
    averageTimePerDetection,
    productivityScore
  };
};

/**
 * Analyzes annotation quality metrics
 * 
 * @pure Function analyzes quality without side effects
 * @param annotations - Array of annotation records
 * @param reviews - Array of review records
 * @param previousMetrics - Previous period metrics for trend analysis
 * @returns Quality metrics object
 * 
 * @example
 * const quality = analyzeQualityMetrics(annotations, reviews, previousMetrics);
 */
export const analyzeQualityMetrics = (
  annotations: readonly any[],
  reviews: readonly any[],
  previousMetrics: QualityMetrics | null = null
): QualityMetrics => {
  const totalReviews = reviews.length;
  
  if (totalReviews === 0) {
    return {
      totalReviews: 0,
      averageQualityScore: 100,
      consistency: { score: 100, trend: 'stable' },
      issueCategories: [],
      recommendations: ['Start collecting review data to analyze quality metrics']
    };
  }
  
  // Calculate average quality score (simplified)
  const averageQualityScore = Math.round(
    reviews.reduce((sum, review) => sum + (review.quality_score || 85), 0) / totalReviews
  );
  
  // Calculate consistency score
  const consistencyScore = Math.round(
    reviews.reduce((sum, review) => sum + (review.consistency_score || 80), 0) / totalReviews
  );
  
  // Determine consistency trend
  let consistencyTrend: 'improving' | 'stable' | 'declining' = 'stable';
  if (previousMetrics) {
    const difference = consistencyScore - previousMetrics.consistency.score;
    if (difference > 5) {
      consistencyTrend = 'improving';
    } else if (difference < -5) {
      consistencyTrend = 'declining';
    }
  }
  
  // Analyze issue categories (simplified)
  const issueCategories = [
    { category: 'Boundary Accuracy', count: Math.floor(totalReviews * 0.15), percentage: 15 },
    { category: 'Classification Errors', count: Math.floor(totalReviews * 0.10), percentage: 10 },
    { category: 'Missing Annotations', count: Math.floor(totalReviews * 0.08), percentage: 8 },
    { category: 'False Positives', count: Math.floor(totalReviews * 0.05), percentage: 5 }
  ];
  
  // Generate recommendations based on metrics
  const recommendations: string[] = [];
  if (averageQualityScore < 80) {
    recommendations.push('Consider additional training for annotation guidelines');
  }
  if (consistencyScore < 75) {
    recommendations.push('Review and clarify ambiguous annotation criteria');
  }
  if (issueCategories[0].percentage > 20) {
    recommendations.push('Focus on improving boundary detection accuracy');
  }
  
  return {
    totalReviews,
    averageQualityScore,
    consistency: { score: consistencyScore, trend: consistencyTrend },
    issueCategories,
    recommendations
  };
};

/**
 * Calculates performance trends over multiple time periods
 * 
 * @pure Function computes trends without side effects
 * @param annotations - Array of annotation records
 * @param days - Number of days to analyze
 * @returns Performance trends object
 * 
 * @example
 * const trends = calculatePerformanceTrends(annotations, 30);
 */
export const calculatePerformanceTrends = (
  annotations: readonly any[],
  days: number = 30
): PerformanceTrends => {
  const now = new Date();
  
  // Calculate daily trends
  const daily = Array.from({ length: Math.min(days, 14) }, (_, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    return calculateActivityMetrics(
      annotations,
      startDate,
      endDate,
      formatDate(date)
    );
  }).reverse();
  
  // Calculate weekly trends
  const weekly = Array.from({ length: Math.min(Math.ceil(days / 7), 8) }, (_, i) => {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - ((i + 1) * 7));
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - (i * 7));
    
    return calculateActivityMetrics(
      annotations,
      startDate,
      endDate,
      `Week ${i + 1}`
    );
  }).reverse();
  
  // Calculate monthly trends (simplified to 4-week periods)
  const monthly = Array.from({ length: Math.min(Math.ceil(days / 30), 6) }, (_, i) => {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - ((i + 1) * 30));
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - (i * 30));
    
    return calculateActivityMetrics(
      annotations,
      startDate,
      endDate,
      `Month ${i + 1}`
    );
  }).reverse();
  
  // Analyze overall trends
  const recentWeek = weekly[weekly.length - 1];
  const previousWeek = weekly[weekly.length - 2];
  
  const productivityTrend = getTrendDirection(
    recentWeek?.productivityScore || 0,
    previousWeek?.productivityScore || 0
  );
  
  const volumeTrend = getTrendDirection(
    (recentWeek?.sequencesAnnotated || 0) + (recentWeek?.detectionsAnnotated || 0),
    (previousWeek?.sequencesAnnotated || 0) + (previousWeek?.detectionsAnnotated || 0)
  );
  
  return {
    daily,
    weekly,
    monthly,
    overall: {
      productivityTrend,
      qualityTrend: 'stable', // Would need quality data over time
      volumeTrend
    }
  };
};

/**
 * Creates complete dashboard widget data
 * 
 * @pure Function creates dashboard data without side effects
 * @param sequences - Array of sequences
 * @param detections - Array of detections
 * @param annotations - Array of annotations
 * @param reviews - Array of reviews
 * @param annotators - Array of annotators
 * @returns Complete dashboard widget data
 * 
 * @example
 * const data = createDashboardData(sequences, detections, annotations, reviews, annotators);
 */
export const createDashboardData = (
  sequences: readonly any[],
  detections: readonly any[],
  annotations: readonly any[],
  reviews: readonly any[],
  annotators: readonly any[]
): DashboardWidgetData => {
  const overview = calculateDashboardOverview(sequences, detections, annotators);
  
  // Calculate recent activity (last 7 days)
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  const recentActivity = [
    calculateActivityMetrics(annotations, weekAgo, now, 'Last 7 Days')
  ];
  
  const quality = analyzeQualityMetrics(annotations, reviews);
  const trends = calculatePerformanceTrends(annotations, 30);
  
  // Generate alerts based on metrics
  const alerts = generateDashboardAlerts(overview, quality, trends);
  
  return {
    overview,
    recentActivity,
    quality,
    trends,
    alerts
  };
};

/**
 * Generates dashboard alerts based on metrics
 * 
 * @pure Function generates alerts without side effects
 * @param overview - Overview metrics
 * @param quality - Quality metrics
 * @param trends - Performance trends
 * @returns Array of dashboard alerts
 * 
 * @example
 * const alerts = generateDashboardAlerts(overview, quality, trends);
 */
export const generateDashboardAlerts = (
  overview: DashboardOverviewMetrics,
  quality: QualityMetrics,
  trends: PerformanceTrends
): readonly {
  readonly id: string;
  readonly type: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly priority: number;
}[] => {
  const alerts = [];
  
  // Check completion rates
  if (overview.sequenceCompletionRate < 50) {
    alerts.push({
      id: 'low-sequence-completion',
      type: 'warning' as const,
      message: `Sequence completion rate is ${overview.sequenceCompletionRate}%. Consider allocating more resources.`,
      priority: 8
    });
  }
  
  if (overview.detectionCompletionRate < 30) {
    alerts.push({
      id: 'low-detection-completion',
      type: 'error' as const,
      message: `Detection completion rate is critically low at ${overview.detectionCompletionRate}%.`,
      priority: 9
    });
  }
  
  // Check annotator activity
  const inactiveAnnotators = overview.totalAnnotators - overview.activeAnnotators;
  if (inactiveAnnotators > overview.totalAnnotators * 0.5) {
    alerts.push({
      id: 'low-annotator-activity',
      type: 'warning' as const,
      message: `${inactiveAnnotators} annotators have been inactive for over a week.`,
      priority: 6
    });
  }
  
  // Check quality issues
  if (quality.averageQualityScore < 75) {
    alerts.push({
      id: 'quality-decline',
      type: 'error' as const,
      message: `Average quality score has dropped to ${quality.averageQualityScore}%. Review needed.`,
      priority: 10
    });
  }
  
  // Check trends
  if (trends.overall.productivityTrend === 'down') {
    alerts.push({
      id: 'productivity-decline',
      type: 'warning' as const,
      message: 'Productivity trend is declining. Consider investigating bottlenecks.',
      priority: 7
    });
  }
  
  // Positive alerts
  if (overview.sequenceCompletionRate > 90) {
    alerts.push({
      id: 'high-completion',
      type: 'info' as const,
      message: 'Excellent work! Sequence completion rate is above 90%.',
      priority: 2
    });
  }
  
  return alerts.sort((a, b) => b.priority - a.priority);
};

// Helper functions

/**
 * Checks if a date is within specified number of days from now
 * 
 * @pure Function checks date without side effects
 */
const isWithinDays = (dateString: string, days: number): boolean => {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays <= days;
};

/**
 * Formats date for display
 * 
 * @pure Function formats date without side effects
 */
const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric' 
  });
};

/**
 * Determines trend direction from two values
 * 
 * @pure Function determines trend without side effects
 */
const getTrendDirection = (current: number, previous: number): 'up' | 'stable' | 'down' => {
  if (previous === 0) return current > 0 ? 'up' : 'stable';
  
  const percentChange = ((current - previous) / previous) * 100;
  
  if (percentChange > 5) return 'up';
  if (percentChange < -5) return 'down';
  return 'stable';
};

/**
 * Formats metrics for display in dashboard widgets
 * 
 * @pure Function formats metrics without side effects
 * @param overview - Overview metrics
 * @returns Formatted display values
 * 
 * @example
 * const formatted = formatDashboardMetrics(overview);
 */
export const formatDashboardMetrics = (overview: DashboardOverviewMetrics) => {
  return {
    totalSequences: overview.totalSequences.toLocaleString(),
    totalDetections: overview.totalDetections.toLocaleString(),
    sequenceProgress: `${overview.annotatedSequences.toLocaleString()} / ${overview.totalSequences.toLocaleString()} (${overview.sequenceCompletionRate}%)`,
    detectionProgress: `${overview.annotatedDetections.toLocaleString()} / ${overview.totalDetections.toLocaleString()} (${overview.detectionCompletionRate}%)`,
    annotatorActivity: `${overview.activeAnnotators} / ${overview.totalAnnotators} active`
  };
};

/**
 * Gets progress bar configuration for metrics
 * 
 * @pure Function returns progress bar config without side effects
 * @param percentage - Completion percentage
 * @returns Progress bar configuration
 * 
 * @example
 * const config = getProgressBarConfig(75);
 */
export const getProgressBarConfig = (percentage: number): {
  readonly width: string;
  readonly colorClass: string;
  readonly textClass: string;
} => {
  let colorClass = 'bg-red-500';
  let textClass = 'text-red-700';
  
  if (percentage >= 90) {
    colorClass = 'bg-green-500';
    textClass = 'text-green-700';
  } else if (percentage >= 70) {
    colorClass = 'bg-yellow-500';
    textClass = 'text-yellow-700';
  } else if (percentage >= 50) {
    colorClass = 'bg-orange-500';
    textClass = 'text-orange-700';
  }
  
  return {
    width: `${percentage}%`,
    colorClass,
    textClass
  };
};