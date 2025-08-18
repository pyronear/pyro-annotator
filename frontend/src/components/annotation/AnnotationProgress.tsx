import { CheckCircle, AlertCircle, Clock, TrendingUp } from 'lucide-react';
import { 
  AnnotationCompletion,
  createAnnotationSummary,
  groupBboxesByStatus 
} from '@/utils/annotation-state';
import { SequenceAnnotation, SequenceBbox } from '@/types/api';

/**
 * Props for the AnnotationProgress component
 */
interface AnnotationProgressProps {
  // Data
  readonly annotation: SequenceAnnotation;
  readonly bboxes: readonly SequenceBbox[];
  readonly missedSmokeReview: 'yes' | 'no' | null;
  
  // Display options
  readonly showDetailedBreakdown?: boolean;
  readonly showValidationStatus?: boolean;
  readonly showMissedSmokeStatus?: boolean;
  readonly compactMode?: boolean;
  
  // Styling
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/**
 * Pure annotation progress component for tracking completion status
 * 
 * Displays comprehensive progress information including completion rates,
 * validation status, and detailed breakdowns of annotation states.
 * 
 * @pure Component renders consistently for same props
 * @param props - Annotation progress configuration
 * @returns JSX element for progress display
 * 
 * @example
 * <AnnotationProgress
 *   annotation={sequenceAnnotation}
 *   bboxes={sequenceBboxes}
 *   missedSmokeReview="no"
 *   showDetailedBreakdown={true}
 *   showValidationStatus={true}
 * />
 */
export default function AnnotationProgress({
  annotation,
  bboxes,
  missedSmokeReview,
  showDetailedBreakdown = true,
  showValidationStatus = true,
  showMissedSmokeStatus = true,
  compactMode = false,
  className = '',
  'data-testid': testId
}: AnnotationProgressProps) {
  
  // Create annotation summary using pure utility
  const summary = createAnnotationSummary(annotation, bboxes, missedSmokeReview);
  const groupedBboxes = groupBboxesByStatus(bboxes);
  
  /**
   * Gets progress bar styling based on completion rate
   * 
   * @pure Function returns styling based on progress
   */
  const getProgressBarStyling = (percentage: number) => {
    if (percentage === 100) {
      return {
        barClass: 'bg-green-500',
        textClass: 'text-green-700',
        bgClass: 'bg-green-50'
      };
    } else if (percentage >= 75) {
      return {
        barClass: 'bg-yellow-500',
        textClass: 'text-yellow-700', 
        bgClass: 'bg-yellow-50'
      };
    } else if (percentage >= 50) {
      return {
        barClass: 'bg-orange-500',
        textClass: 'text-orange-700',
        bgClass: 'bg-orange-50'
      };
    } else {
      return {
        barClass: 'bg-red-500',
        textClass: 'text-red-700',
        bgClass: 'bg-red-50'
      };
    }
  };

  /**
   * Gets overall status display properties
   * 
   * @pure Function returns status display configuration
   */
  const getOverallStatus = () => {
    if (!summary.isValid) {
      return {
        icon: AlertCircle,
        text: 'Issues Found',
        classes: 'text-red-600 bg-red-50 border-red-200'
      };
    } else if (summary.isReadyToComplete) {
      return {
        icon: CheckCircle,
        text: 'Ready to Complete',
        classes: 'text-green-600 bg-green-50 border-green-200'
      };
    } else if (summary.completionRate > 0) {
      return {
        icon: Clock,
        text: 'In Progress',
        classes: 'text-yellow-600 bg-yellow-50 border-yellow-200'
      };
    } else {
      return {
        icon: TrendingUp,
        text: 'Not Started',
        classes: 'text-gray-600 bg-gray-50 border-gray-200'
      };
    }
  };

  const progressStyling = getProgressBarStyling(summary.completionRate);
  const overallStatus = getOverallStatus();
  const OverallStatusIcon = overallStatus.icon;

  if (compactMode) {
    return (
      <div className={`flex items-center space-x-4 ${className}`} data-testid={testId}>
        {/* Compact Progress Bar */}
        <div className="flex-1 bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${progressStyling.barClass}`}
            style={{ width: `${summary.completionRate}%` }}
          />
        </div>
        
        {/* Compact Stats */}
        <div className="text-sm text-gray-600 min-w-0">
          <span className="font-medium">{summary.completionRate}%</span>
          <span className="mx-1">·</span>
          <span>{summary.annotatedBboxes}/{summary.totalBboxes}</span>
        </div>
        
        {/* Compact Status */}
        <div className={`flex items-center space-x-1 ${overallStatus.classes.split(' ')[0]}`}>
          <OverallStatusIcon className="w-4 h-4" />
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-4 space-y-4 ${className}`} data-testid={testId}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">
          Annotation Progress
        </h3>
        
        {/* Overall Status Badge */}
        <div className={`flex items-center space-x-2 px-3 py-1 rounded-full border ${overallStatus.classes}`}>
          <OverallStatusIcon className="w-4 h-4" />
          <span className="text-sm font-medium">
            {overallStatus.text}
          </span>
        </div>
      </div>

      {/* Main Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700">Overall Progress</span>
          <span className={`font-medium ${progressStyling.textClass}`}>
            {summary.completionRate}%
          </span>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-300 ${progressStyling.barClass}`}
            style={{ width: `${summary.completionRate}%` }}
          />
        </div>
        
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>{summary.annotatedBboxes} of {summary.totalBboxes} annotations completed</span>
          {summary.isComplete && (
            <span className="text-green-600 font-medium">Complete!</span>
          )}
        </div>
      </div>

      {/* Detailed Breakdown */}
      {showDetailedBreakdown && summary.totalBboxes > 0 && (
        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
          {/* Annotated */}
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {groupedBboxes.annotated.length}
            </div>
            <div className="text-xs text-gray-600">
              Annotated
            </div>
          </div>
          
          {/* Unannotated */}
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-600">
              {groupedBboxes.unannotated.length}
            </div>
            <div className="text-xs text-gray-600">
              Remaining
            </div>
          </div>
          
          {/* Conflicts */}
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {groupedBboxes.conflicted.length}
            </div>
            <div className="text-xs text-gray-600">
              Conflicts
            </div>
          </div>
        </div>
      )}

      {/* Content Summary */}
      {showDetailedBreakdown && (summary.smokeCount > 0 || summary.falsePositiveCount > 0) && (
        <div className="flex items-center justify-center space-x-6 pt-4 border-t border-gray-200">
          {summary.smokeCount > 0 && (
            <div className="flex items-center space-x-2 text-sm">
              <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
              <span className="text-gray-600">
                {summary.smokeCount} smoke detection{summary.smokeCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          
          {summary.falsePositiveCount > 0 && (
            <div className="flex items-center space-x-2 text-sm">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span className="text-gray-600">
                {summary.falsePositiveCount} false positive{summary.falsePositiveCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Missed Smoke Status */}
      {showMissedSmokeStatus && (
        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          <span className="text-sm font-medium text-gray-700">
            Missed Smoke Review
          </span>
          
          <div className="flex items-center space-x-2">
            {summary.hasMissedSmokeReview ? (
              <>
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-sm text-green-600 font-medium">
                  {missedSmokeReview === 'yes' ? 'Smoke Missed' : 'No Missed Smoke'}
                </span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">
                  Pending Review
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Validation Errors */}
      {showValidationStatus && summary.errors.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-red-800 mb-1">
                Validation Issues ({summary.errors.length})
              </div>
              <ul className="text-sm text-red-700 space-y-1">
                {summary.errors.map((error, index) => (
                  <li key={index} className="flex items-start space-x-1">
                    <span className="text-red-400">•</span>
                    <span>{error}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Simple progress bar component for minimal displays
 * 
 * @pure Component renders minimal progress bar
 * @param props - Minimal progress props
 * @returns JSX element for simple progress bar
 * 
 * @example
 * <SimpleProgressBar
 *   completion={completion}
 *   className="w-full"
 * />
 */
export function SimpleProgressBar({ 
  completion,
  className = '' 
}: {
  readonly completion: AnnotationCompletion;
  readonly className?: string;
}) {
  const progressStyling = {
    barClass: completion.isComplete ? 'bg-green-500' : 'bg-blue-500'
  };

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>{completion.annotatedBboxes}/{completion.totalBboxes}</span>
        <span>{completion.completionRate}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1">
        <div
          className={`h-1 rounded-full transition-all duration-300 ${progressStyling.barClass}`}
          style={{ width: `${completion.completionRate}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Progress statistics component for dashboard display
 * 
 * @pure Component renders progress statistics
 * @param props - Statistics-specific props
 * @returns JSX element for progress statistics
 * 
 * @example
 * <ProgressStatistics
 *   annotation={annotation}
 *   bboxes={bboxes}
 *   missedSmokeReview="no"
 * />
 */
export function ProgressStatistics(props: Pick<AnnotationProgressProps,
  'annotation' | 'bboxes' | 'missedSmokeReview' | 'className'
>) {
  return (
    <AnnotationProgress
      {...props}
      showDetailedBreakdown={true}
      showValidationStatus={false}
      showMissedSmokeStatus={false}
      compactMode={false}
    />
  );
}