import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Upload,
} from 'lucide-react';
import { Sequence, SequenceAnnotation } from '@/types/api';
import { analyzeSequenceAccuracy, getModelAccuracyBadgeClasses } from '@/utils/modelAccuracy';

interface DetectionHeaderProps {
  // Sequence data
  sequence?: Sequence;
  sequenceAnnotation?: SequenceAnnotation;

  // Progress data
  annotatedCount: number;
  totalCount: number;
  completionPercentage: number;
  isAllAnnotated: boolean;

  // Navigation
  onBack: () => void;
  canNavigatePrevious: () => boolean;
  canNavigateNext: () => boolean;
  onPreviousSequence: () => void;
  onNextSequence: () => void;
  getCurrentSequenceIndex: () => number;

  // Sequences context
  rawSequencesLoading: boolean;
  rawSequencesError: boolean;
  allSequences?: { total: number };

  // Controls
  showPredictions: boolean;
  onTogglePredictions: (show: boolean) => void;

  // Submit functionality
  allInVisualCheck: boolean;
  onSave: () => void;
  saveAnnotations: { isPending: boolean };

  // Annotation pills
  getAnnotationPills: () => React.ReactNode[];
}

export function DetectionHeader({
  sequence,
  sequenceAnnotation,
  annotatedCount,
  totalCount,
  completionPercentage,
  isAllAnnotated,
  onBack,
  canNavigatePrevious,
  canNavigateNext,
  onPreviousSequence,
  onNextSequence,
  getCurrentSequenceIndex,
  rawSequencesLoading,
  rawSequencesError,
  allSequences,
  showPredictions,
  onTogglePredictions,
  allInVisualCheck,
  onSave,
  saveAnnotations,
  getAnnotationPills,
}: DetectionHeaderProps) {
  return (
    <div
      className={`fixed top-0 left-0 md:left-64 right-0 backdrop-blur-sm shadow-sm z-30 ${
        isAllAnnotated
          ? 'bg-green-50/90 border-b border-green-200 border-l-4 border-l-green-500'
          : 'bg-white/85 border-b border-gray-200'
      }`}
    >
      <div className="px-10 py-3">
        {/* Top Row: Context + Action Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75"
              title="Back to sequences"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-900">
                {sequence?.organisation_name || 'Loading...'}
              </span>
              <span className="text-gray-400">•</span>
              <span className="text-sm text-gray-600">{sequence?.camera_name || 'Loading...'}</span>
              <span className="text-gray-400">•</span>
              <span className="text-sm text-gray-600">
                {sequence?.recorded_at
                  ? new Date(sequence.recorded_at).toLocaleString()
                  : 'Loading...'}
              </span>
              {sequence?.azimuth !== null && sequence?.azimuth !== undefined && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-xs text-gray-500">{sequence.azimuth}°</span>
                </>
              )}
              {sequence?.lat !== null &&
                sequence?.lat !== undefined &&
                sequence?.lon !== null &&
                sequence?.lon !== undefined && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {sequence.lat.toFixed(3)}, {sequence.lon.toFixed(3)}
                    </span>
                  </>
                )}

              {/* Sequence context */}
              {rawSequencesLoading ? (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-xs text-gray-500 animate-pulse">Loading sequences...</span>
                </>
              ) : rawSequencesError ? (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-xs text-red-500">Error loading sequences</span>
                </>
              ) : allSequences && allSequences.total > 0 ? (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-xs text-blue-600 font-medium">
                    Sequence {getCurrentSequenceIndex() + 1} of {allSequences.total}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-xs text-gray-500">No sequences found</span>
                </>
              )}

              {/* Completion Badge */}
              {isAllAnnotated && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="inline-flex items-center text-xs text-green-600 font-medium">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Completed
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Navigation Buttons */}
            {rawSequencesLoading ? (
              <>
                <button
                  disabled
                  className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                  title="Loading sequences..."
                >
                  <ChevronLeft className="w-4 h-4 animate-pulse" />
                </button>
                <button
                  disabled
                  className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                  title="Loading sequences..."
                >
                  <ChevronRight className="w-4 h-4 animate-pulse" />
                </button>
              </>
            ) : rawSequencesError ? (
              <>
                <button
                  disabled
                  className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                  title="Error loading sequences"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled
                  className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                  title="Error loading sequences"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onPreviousSequence}
                  disabled={!canNavigatePrevious()}
                  className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={canNavigatePrevious() ? 'Previous sequence' : 'Already at first sequence'}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={onNextSequence}
                  disabled={!canNavigateNext()}
                  className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={canNavigateNext() ? 'Next sequence' : 'Already at last sequence'}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Predictions Toggle */}
            <label className="flex items-center space-x-2 px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={showPredictions}
                onChange={e => onTogglePredictions(e.target.checked)}
                className="w-3 h-3 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <span>Show predictions</span>
            </label>

            {allInVisualCheck && (
              <button
                onClick={onSave}
                disabled={saveAnnotations.isPending}
                className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Submit all detection annotations (Enter) - All flagged as false positive sequences"
              >
                {saveAnnotations.isPending ? (
                  <div className="w-3 h-3 mr-1 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Upload className="w-3 h-3 mr-1" />
                )}
                Submit All
              </button>
            )}
          </div>
        </div>

        {/* Bottom Row: Progress + Model Accuracy + Annotation Pills */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-medium text-gray-900">
              Review:{' '}
              {isAllAnnotated ? (
                <span className="text-green-600">Done</span>
              ) : (
                <span className="text-orange-600">Pending</span>
              )}{' '}
              • {annotatedCount} of {totalCount} detections • {completionPercentage}% complete
            </span>

            {/* Model Accuracy Context */}
            {sequence && sequenceAnnotation && (
              <div className="flex items-center space-x-2">
                {(() => {
                  const accuracy = analyzeSequenceAccuracy({
                    ...sequence,
                    annotation: sequenceAnnotation,
                  });
                  return (
                    <span className={getModelAccuracyBadgeClasses(accuracy, 'sm')}>
                      {accuracy.icon} {accuracy.label}
                    </span>
                  );
                })()}
              </div>
            )}

            {/* Annotation pills */}
            <div className="flex items-center space-x-2">{getAnnotationPills()}</div>
          </div>

          <div className="flex items-center space-x-3">
            {isAllAnnotated ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <AlertCircle className="w-4 h-4 text-orange-500" />
            )}
            <div className="w-24 bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  isAllAnnotated ? 'bg-green-600' : 'bg-primary-600'
                }`}
                style={{ width: `${completionPercentage}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
