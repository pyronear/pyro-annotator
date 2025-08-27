/**
 * Fixed header component for sequence annotation interface.
 * Contains navigation, sequence metadata, progress display, and action controls.
 */

import React from 'react';
import { ArrowLeft, AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Keyboard, RotateCcw, Upload } from 'lucide-react';
import { Sequence, SequenceAnnotation } from '@/types/api';
import { AnnotationProgress, formatProgressDisplay, getProgressColor } from '@/utils/annotation/progressUtils';

interface AnnotationHeaderProps {
  // Navigation
  onBack: () => void;

  // Sequence data
  sequence: Sequence | undefined;
  annotation: SequenceAnnotation | undefined;
  
  // Progress
  progress: AnnotationProgress;
  isUnsure: boolean;
  missedSmokeReview: 'yes' | 'no' | null;
  
  // Workflow
  annotationWorkflow: any; // TODO: type this properly
  canNavigatePrevious: () => boolean;
  canNavigateNext: () => boolean;
  onPreviousSequence: () => void;
  onNextSequence: () => void;
  
  // Controls
  onToggleKeyboardModal: () => void;
  onReset: () => void;
  onSave: () => void;
  isAnnotationComplete: boolean;
  isSaving: boolean;
  onUnsureChange: (checked: boolean) => void;
  
  // Display options
  fromParam?: string | null;
}

export const AnnotationHeader: React.FC<AnnotationHeaderProps> = ({
  onBack,
  sequence,
  annotation,
  progress,
  isUnsure,
  missedSmokeReview,
  annotationWorkflow,
  canNavigatePrevious,
  canNavigateNext,
  onPreviousSequence,
  onNextSequence,
  onToggleKeyboardModal,
  onReset,
  onSave,
  isAnnotationComplete,
  isSaving,
  onUnsureChange,
  fromParam
}) => {
  const headerBgClass = isUnsure
    ? 'bg-amber-50/90 border-b border-amber-200 border-l-4 border-l-amber-500'
    : annotation?.processing_stage === 'annotated' 
    ? 'bg-green-50/90 border-b border-green-200 border-l-4 border-l-green-500' 
    : 'bg-white/85 border-b border-gray-200';

  return (
    <div className={`fixed top-0 left-0 md:left-64 right-0 backdrop-blur-sm shadow-sm z-30 ${headerBgClass}`}>
      <div className="px-10 py-3">
        {/* Top Row: Context + Action Buttons + Keyboard Shortcuts */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75"
              title="Back to sequence"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-900">
                {sequence?.organisation_name || 'Loading...'}
              </span>
              <span className="text-gray-400">•</span>
              <span className="text-sm text-gray-600">
                {sequence?.camera_name || 'Loading...'}
              </span>
              <span className="text-gray-400">•</span>
              <span className="text-sm text-gray-600">
                {sequence?.recorded_at ? new Date(sequence.recorded_at).toLocaleString() : 'Loading...'}
              </span>
              
              {/* Azimuth */}
              {sequence?.azimuth !== null && sequence?.azimuth !== undefined && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-xs text-gray-500">
                    {sequence.azimuth}°
                  </span>
                </>
              )}
              
              {/* Coordinates */}
              {sequence?.lat !== null && sequence?.lat !== undefined && 
               sequence?.lon !== null && sequence?.lon !== undefined && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-xs text-gray-500">
                    {sequence.lat.toFixed(3)}, {sequence.lon.toFixed(3)}
                  </span>
                </>
              )}
              
              {/* Workflow Progress Indicator */}
              {annotationWorkflow && annotationWorkflow.isActive && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-xs text-blue-600 font-medium">
                    Sequence {annotationWorkflow.currentIndex + 1} of {annotationWorkflow.sequences.length}
                  </span>
                </>
              )}
              
              {/* Completion Badge for Annotated Sequences */}
              {annotation?.processing_stage === 'annotated' && fromParam !== 'review' && (
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
            {/* Workflow Navigation Buttons */}
            {annotationWorkflow && annotationWorkflow.isActive && (
              <>
                <button
                  onClick={onPreviousSequence}
                  disabled={!canNavigatePrevious()}
                  className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={canNavigatePrevious() ? "Previous sequence" : "Already at first sequence"}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={onNextSequence}
                  disabled={!canNavigateNext()}
                  className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={canNavigateNext() ? "Next sequence" : "Already at last sequence"}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
            
            <label className="flex items-center space-x-1 px-2 py-1.5 border border-gray-200 rounded-md bg-white">
              <input
                type="checkbox"
                checked={isUnsure}
                onChange={(e) => onUnsureChange(e.target.checked)}
                className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs font-medium text-gray-700">Unsure</span>
            </label>
            
            <button
              onClick={onReset}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
              title="Reset annotation (Ctrl+Z)"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </button>
            
            <button
              onClick={onSave}
              disabled={(!isAnnotationComplete && !isUnsure) || isSaving}
              className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={isUnsure ? "Submit as unsure (Enter)" : annotation?.processing_stage === 'annotated' ? "Save changes (Enter)" : "Submit annotation (Enter)"}
            >
              {isSaving ? (
                <div className="w-3 h-3 mr-1 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Upload className="w-3 h-3 mr-1" />
              )}
              {isUnsure ? 'Submit Unsure' : annotation?.processing_stage === 'annotated' ? 'Save Changes' : 'Submit'}
            </button>
            
            <button
              onClick={onToggleKeyboardModal}
              className="inline-flex items-center px-2 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
              title="Show keyboard shortcuts (?)"
            >
              <Keyboard className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Bottom Row: Progress + Status + Shortcuts Hint */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-medium text-gray-900">
              Review: {formatProgressDisplay(progress, missedSmokeReview)}
            </span>
          </div>
          
          <div className="flex items-center space-x-3">
            <span className="text-xs text-gray-500">
              Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">?</kbd> for shortcuts
            </span>
            {progress.isComplete ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <AlertCircle className="w-4 h-4 text-orange-500" />
            )}
            <div className="w-24 bg-gray-200 rounded-full h-1.5">
              <div 
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  isUnsure 
                    ? 'bg-amber-600' 
                    : getProgressColor(progress, annotation?.processing_stage)
                }`}
                style={{ width: `${progress.percentage}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};