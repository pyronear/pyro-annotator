import { ArrowLeft, RotateCcw, CheckCircle, AlertCircle } from 'lucide-react';
import { 
  AnnotationCompletion, 
  AnnotationNavigation,
  createAnnotationNavigation 
} from '@/utils/annotation-state';

/**
 * Props for the AnnotationControls component
 */
interface AnnotationControlsProps {
  // Navigation state
  readonly currentIndex: number;
  readonly totalCount: number;
  readonly onNavigateBack: () => void;
  readonly onNavigateNext: () => void;
  readonly onNavigatePrevious: () => void;
  readonly canNavigateNext: boolean;
  readonly canNavigatePrevious: boolean;
  
  // Annotation progress
  readonly completion: AnnotationCompletion;
  
  // Actions
  readonly onReset: () => void;
  readonly onComplete: () => void;
  readonly onReturnToList: () => void;
  
  // State
  readonly isLoading: boolean;
  readonly hasChanges: boolean;
  readonly validationErrors: readonly string[];
  
  // Configuration
  readonly showResetButton?: boolean;
  readonly showCompletionButton?: boolean;
  readonly showNavigationCounter?: boolean;
  readonly className?: string;
}

/**
 * Pure annotation controls component for workflow management
 * 
 * Provides navigation, reset, and completion controls for annotation workflows
 * with progress tracking and validation feedback.
 * 
 * @pure Component renders consistently for same props
 * @param props - Annotation controls configuration
 * @returns JSX element for annotation controls
 * 
 * @example
 * <AnnotationControls
 *   currentIndex={2}
 *   totalCount={10}
 *   completion={{ completionRate: 60, isComplete: false, ... }}
 *   onNavigateNext={handleNext}
 *   onNavigatePrevious={handlePrevious}
 *   onComplete={handleComplete}
 *   onReturnToList={handleReturn}
 *   validationErrors={errors}
 * />
 */
export default function AnnotationControls({
  currentIndex,
  totalCount,
  onNavigateBack,
  onNavigateNext,
  onNavigatePrevious,
  canNavigateNext,
  canNavigatePrevious,
  completion,
  onReset,
  onComplete,
  onReturnToList,
  isLoading,
  hasChanges,
  validationErrors,
  showResetButton = true,
  showCompletionButton = true,
  showNavigationCounter = true,
  className = ''
}: AnnotationControlsProps) {
  
  // Create navigation state using pure utility
  const navigation = createAnnotationNavigation(currentIndex, totalCount);
  
  /**
   * Handles keyboard shortcuts for navigation
   */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        if (canNavigatePrevious) {
          onNavigatePrevious();
        }
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (canNavigateNext) {
          onNavigateNext();
        }
        break;
      case 'Escape':
        event.preventDefault();
        onReturnToList();
        break;
    }
  };

  /**
   * Gets completion status display properties
   * 
   * @pure Function returns display properties based on completion
   */
  const getCompletionDisplay = () => {
    if (completion.isComplete) {
      return {
        text: 'Complete',
        icon: CheckCircle,
        classes: 'text-green-600 bg-green-50'
      };
    } else {
      return {
        text: `${completion.completionRate}% Complete`,
        icon: AlertCircle,
        classes: completion.completionRate > 50 
          ? 'text-yellow-600 bg-yellow-50' 
          : 'text-red-600 bg-red-50'
      };
    }
  };

  const completionDisplay = getCompletionDisplay();
  const CompletionIcon = completionDisplay.icon;

  return (
    <div 
      className={`bg-white border-b border-gray-200 px-6 py-4 ${className}`}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Top Row: Back Button and Title */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={onReturnToList}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Return to sequence list"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to List</span>
          </button>
          
          {showNavigationCounter && (
            <div className="text-sm text-gray-500">
              Sequence {navigation.currentIndex + 1} of {navigation.totalCount}
            </div>
          )}
        </div>

        <div className="flex items-center space-x-4">
          {/* Completion Status */}
          <div className={`flex items-center space-x-2 px-3 py-1 rounded-lg ${completionDisplay.classes}`}>
            <CompletionIcon className="w-4 h-4" />
            <span className="text-sm font-medium">
              {completionDisplay.text}
            </span>
          </div>
          
          {/* Progress Indicator */}
          <div className="text-sm text-gray-600">
            {completion.annotatedBboxes} / {completion.totalBboxes} annotations
          </div>
        </div>
      </div>

      {/* Bottom Row: Actions and Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {/* Reset Button */}
          {showResetButton && (
            <button
              onClick={onReset}
              disabled={isLoading || !hasChanges}
              className="flex items-center space-x-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Reset all annotations for this sequence"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reset</span>
            </button>
          )}
          
          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="flex items-center space-x-2 text-red-600">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">
                {validationErrors.length} validation error{validationErrors.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {/* Navigation Controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={onNavigatePrevious}
              disabled={!canNavigatePrevious || isLoading}
              className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Previous sequence (←)"
            >
              Previous
            </button>
            
            <button
              onClick={onNavigateNext}
              disabled={!canNavigateNext || isLoading}
              className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Next sequence (→)"
            >
              Next
            </button>
          </div>
          
          {/* Complete Button */}
          {showCompletionButton && (
            <button
              onClick={onComplete}
              disabled={isLoading || validationErrors.length > 0 || !completion.isComplete}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Complete annotation for this sequence"
            >
              <CheckCircle className="w-4 h-4" />
              <span>Complete</span>
            </button>
          )}
        </div>
      </div>

      {/* Validation Error Details */}
      {validationErrors.length > 0 && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="text-sm text-red-800">
            <div className="font-medium mb-1">Please fix the following issues:</div>
            <ul className="list-disc list-inside space-y-1">
              {validationErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help */}
      <div className="mt-3 text-xs text-gray-500">
        <span className="mr-4">← → Navigate</span>
        <span className="mr-4">Esc Return to list</span>
        {hasChanges && <span className="text-yellow-600">● Unsaved changes</span>}
      </div>
    </div>
  );
}

/**
 * Compact annotation controls variant for smaller spaces
 * 
 * @pure Component renders minimal control set
 * @param props - Subset of AnnotationControlsProps
 * @returns JSX element for compact controls
 * 
 * @example
 * <CompactAnnotationControls
 *   currentIndex={2}
 *   totalCount={10}
 *   completion={completion}
 *   onNavigateNext={handleNext}
 *   onNavigatePrevious={handlePrevious}
 * />
 */
export function CompactAnnotationControls(props: Pick<AnnotationControlsProps, 
  'currentIndex' | 'totalCount' | 'completion' | 'onNavigateNext' | 'onNavigatePrevious' |
  'canNavigateNext' | 'canNavigatePrevious' | 'className'
>) {
  return (
    <AnnotationControls
      {...props}
      onReset={() => {}}
      onComplete={() => {}}
      onReturnToList={() => {}}
      onNavigateBack={() => {}}
      isLoading={false}
      hasChanges={false}
      validationErrors={[]}
      showResetButton={false}
      showCompletionButton={false}
      showNavigationCounter={true}
    />
  );
}

/**
 * Navigation-only controls for read-only contexts
 * 
 * @pure Component renders navigation-only controls
 * @param props - Navigation-specific props
 * @returns JSX element for navigation controls
 * 
 * @example
 * <NavigationOnlyControls
 *   currentIndex={2}
 *   totalCount={10}
 *   onNavigateNext={handleNext}
 *   onNavigatePrevious={handlePrevious}
 * />
 */
export function NavigationOnlyControls(props: Pick<AnnotationControlsProps,
  'currentIndex' | 'totalCount' | 'onNavigateNext' | 'onNavigatePrevious' |
  'canNavigateNext' | 'canNavigatePrevious' | 'onReturnToList' | 'className'
>) {
  const mockCompletion: AnnotationCompletion = {
    totalBboxes: 0,
    annotatedBboxes: 0,
    completionRate: 100,
    isComplete: true
  };

  return (
    <AnnotationControls
      {...props}
      completion={mockCompletion}
      onReset={() => {}}
      onComplete={() => {}}
      onNavigateBack={() => {}}
      isLoading={false}
      hasChanges={false}
      validationErrors={[]}
      showResetButton={false}
      showCompletionButton={false}
      showNavigationCounter={true}
    />
  );
}