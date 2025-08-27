/**
 * Progress header showing detection annotation progress and navigation.
 * Displays current position, progress bar, and navigation controls.
 */

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { Detection } from '@/types/api';
import { calculateWorkflowProgress } from '@/utils/annotation';

interface DetectionProgressHeaderProps {
  currentIndex: number;
  totalCount: number;
  detection: Detection;
  isAnnotated: boolean;
  isSubmitting: boolean;
  canNavigatePrev: boolean;
  canNavigateNext: boolean;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  completedCount?: number;
}

export function DetectionProgressHeader({
  currentIndex,
  totalCount,
  detection,
  isAnnotated,
  isSubmitting,
  canNavigatePrev,
  canNavigateNext,
  onClose,
  onNavigate,
  completedCount = 0,
}: DetectionProgressHeaderProps) {
  const progress = calculateWorkflowProgress(completedCount, totalCount);

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      {/* Top row - Title and close button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Back to sequence view"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>

          <div>
            <h1 className="text-xl font-semibold text-gray-900">Detection Annotation</h1>
            <p className="text-sm text-gray-500">Sequence detection #{detection.id}</p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center space-x-2">
          {isSubmitting ? (
            <div className="flex items-center space-x-2 text-blue-600">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm font-medium">Saving...</span>
            </div>
          ) : isAnnotated ? (
            <div className="flex items-center space-x-2 text-green-600">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Annotated</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-orange-600">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-medium">Pending</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress row */}
      <div className="flex items-center justify-between">
        {/* Navigation controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onNavigate('prev')}
            disabled={!canNavigatePrev}
            className={`
              flex items-center space-x-1 px-3 py-2 rounded-lg border transition-colors
              ${
                canNavigatePrev
                  ? 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                  : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
              }
            `}
            title="Previous detection (←)"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Previous</span>
          </button>

          <button
            onClick={() => onNavigate('next')}
            disabled={!canNavigateNext}
            className={`
              flex items-center space-x-1 px-3 py-2 rounded-lg border transition-colors
              ${
                canNavigateNext
                  ? 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                  : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
              }
            `}
            title="Next detection (→)"
          >
            <span className="text-sm font-medium">Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Progress info */}
        <div className="flex-1 mx-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              Detection {currentIndex + 1} of {totalCount}
            </span>
            <span className="text-sm text-gray-600">
              {progress.message} ({progress.percentage}%)
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>

        {/* Detection metadata */}
        <div className="text-right">
          <div className="text-sm text-gray-900 font-medium">ID #{detection.id}</div>

          <div className="text-xs text-gray-500">
            {detection.confidence && <>Confidence: {(detection.confidence * 100).toFixed(1)}%</>}
          </div>

          <div className="text-xs text-gray-500">
            {new Date(detection.recorded_at).toLocaleString()}
          </div>

          {detection.algo_predictions?.predictions?.length && (
            <div className="flex items-center justify-end space-x-1 text-xs text-blue-600 mt-1">
              <AlertCircle className="w-3 h-3" />
              <span>
                {detection.algo_predictions.predictions.length} AI prediction
                {detection.algo_predictions.predictions.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
