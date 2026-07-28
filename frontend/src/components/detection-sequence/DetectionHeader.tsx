/**
 * Single-row sticky header for the detection sequence grid (#227): back,
 * sequence identity, status chips, then navigation, the compact view
 * toolbar, and the primary submit action. Sticky in the page's scroll
 * flow — content can never be hidden beneath it.
 */

import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle, Upload } from 'lucide-react';
import { Sequence, SequenceAnnotation } from '@/types/api';
import { analyzeSequenceAccuracy, getModelAccuracyBadgeClasses } from '@/utils/modelAccuracy';
import { ViewToolbar, CardSize } from './ViewToolbar';

export type { CardSize } from './ViewToolbar';

interface DetectionHeaderProps {
  // Sequence data
  sequence?: Sequence;
  sequenceAnnotation?: SequenceAnnotation;

  // Completion state
  isAllAnnotated: boolean;

  // Navigation
  onBack: () => void;
  canNavigatePrevious: () => boolean;
  canNavigateNext: () => boolean;
  onPreviousSequence: () => void;
  onNextSequence: () => void;

  // Sequences context
  rawSequencesLoading: boolean;
  rawSequencesError: boolean;

  // View controls
  showPredictions: boolean;
  onTogglePredictions: (show: boolean) => void;
  cardSize?: CardSize;
  onCardSizeChange?: (size: CardSize) => void;

  // Submit functionality
  allInVisualCheck: boolean;
  onSave: () => void;
  saveAnnotations: { isPending: boolean };

  // Localize quick submit
  isLocalize?: boolean;
  noBoxCount?: number;
  quickSubmitPending?: boolean;
  quickSubmitConfirming?: boolean;
  onQuickSubmit?: () => void;

  // Localize crop mode
  cropMode?: boolean;
  onToggleCropMode?: (crop: boolean) => void;

  // Localize cropped flipbook view
  showCroppedView?: boolean;
  onToggleCroppedView?: (show: boolean) => void;

  // Annotation pills
  getAnnotationPills: () => React.ReactNode[];
}

export function DetectionHeader({
  sequence,
  sequenceAnnotation,
  isAllAnnotated,
  onBack,
  canNavigatePrevious,
  canNavigateNext,
  onPreviousSequence,
  onNextSequence,
  rawSequencesLoading,
  rawSequencesError,
  showPredictions,
  onTogglePredictions,
  cardSize = 'md',
  onCardSizeChange,
  allInVisualCheck,
  onSave,
  saveAnnotations,
  isLocalize = false,
  noBoxCount = 0,
  quickSubmitPending = false,
  quickSubmitConfirming = false,
  onQuickSubmit,
  cropMode = false,
  onToggleCropMode,
  showCroppedView = false,
  onToggleCroppedView,
  getAnnotationPills,
}: DetectionHeaderProps) {
  const accuracy =
    sequence && sequenceAnnotation
      ? analyzeSequenceAccuracy({ ...sequence, annotation: sequenceAnnotation })
      : null;

  const chevronState = rawSequencesLoading
    ? { disabled: true, title: 'Loading sequences...' }
    : rawSequencesError
      ? { disabled: true, title: 'Error loading sequences' }
      : null;

  return (
    <div
      className={`sticky top-0 z-30 px-6 py-2 backdrop-blur-sm shadow-sm border-b ${
        isAllAnnotated ? 'bg-green-50/90 border-green-200' : 'bg-white/85 border-gray-200'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75"
          title="Back to sequences"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate">
            {sequence?.organisation_name || 'Loading...'}
          </span>
          <span className="text-gray-400">•</span>
          <span className="text-sm text-gray-600 truncate">
            {sequence?.camera_name || 'Loading...'}
          </span>
          <span className="text-gray-400">•</span>
          <span className="text-sm text-gray-600 whitespace-nowrap">
            {sequence?.recorded_at ? new Date(sequence.recorded_at).toLocaleString() : 'Loading...'}
          </span>
        </div>

        {isAllAnnotated && <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}

        {accuracy && (
          <span className={getModelAccuracyBadgeClasses(accuracy, 'sm')}>
            {accuracy.icon} {accuracy.label}
          </span>
        )}
        <div className="flex items-center gap-1">{getAnnotationPills()}</div>

        <div className="flex-1" />

        <button
          onClick={onPreviousSequence}
          disabled={chevronState?.disabled || !canNavigatePrevious()}
          className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            chevronState?.title ??
            (canNavigatePrevious() ? 'Previous sequence' : 'Already at first sequence')
          }
        >
          <ChevronLeft className={`w-4 h-4 ${rawSequencesLoading ? 'animate-pulse' : ''}`} />
        </button>
        <button
          onClick={onNextSequence}
          disabled={chevronState?.disabled || !canNavigateNext()}
          className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            chevronState?.title ??
            (canNavigateNext() ? 'Next sequence' : 'Already at last sequence')
          }
        >
          <ChevronRight className={`w-4 h-4 ${rawSequencesLoading ? 'animate-pulse' : ''}`} />
        </button>

        <ViewToolbar
          cardSize={cardSize}
          onCardSizeChange={onCardSizeChange ?? (() => {})}
          showPredictions={showPredictions}
          onTogglePredictions={onTogglePredictions}
          isLocalize={isLocalize}
          cropMode={cropMode}
          onToggleCropMode={onToggleCropMode}
          showCroppedView={showCroppedView}
          onToggleCroppedView={onToggleCroppedView}
        />

        {isLocalize ? (
          <button
            onClick={e => {
              e.stopPropagation();
              onQuickSubmit?.();
            }}
            disabled={quickSubmitPending}
            className={`inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              quickSubmitConfirming
                ? 'bg-amber-500 hover:bg-amber-600'
                : 'bg-primary-600 hover:bg-primary-700'
            }`}
            title="Accept predicted boxes for all pending frames and submit the sequence (Enter)"
          >
            {quickSubmitPending ? (
              <div className="w-3 h-3 mr-1 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Upload className="w-3 h-3 mr-1" />
            )}
            {quickSubmitConfirming
              ? `${noBoxCount} frame${noBoxCount === 1 ? '' : 's'} with no box — submit anyway?`
              : 'Accept & submit'}
          </button>
        ) : (
          allInVisualCheck && (
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
          )
        )}
      </div>
    </div>
  );
}
