import { ChevronLeft, ChevronRight, Keyboard, Info } from 'lucide-react';
import { 
  AnnotationNavigation,
  createAnnotationNavigation,
  calculateNextIndex,
  calculatePreviousIndex 
} from '@/utils/annotation-state';

/**
 * Props for the NavigationPanel component
 */
interface NavigationPanelProps {
  // Navigation state
  readonly currentIndex: number;
  readonly totalCount: number;
  readonly itemType?: string; // e.g., "sequence", "bbox", "detection"
  
  // Handlers
  readonly onNavigateToIndex: (index: number) => void;
  readonly onNavigateNext: () => void;
  readonly onNavigatePrevious: () => void;
  readonly onNavigateFirst?: () => void;
  readonly onNavigateLast?: () => void;
  
  // Configuration
  readonly allowDirectNavigation?: boolean;
  readonly showKeyboardShortcuts?: boolean;
  readonly showItemType?: boolean;
  readonly enableWrapping?: boolean;
  readonly compactMode?: boolean;
  
  // Styling
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/**
 * Pure navigation panel component for sequential item navigation
 * 
 * Provides comprehensive navigation controls including direct index navigation,
 * keyboard shortcuts, and accessibility features for sequential workflows.
 * 
 * @pure Component renders consistently for same props
 * @param props - Navigation panel configuration
 * @returns JSX element for navigation panel
 * 
 * @example
 * <NavigationPanel
 *   currentIndex={2}
 *   totalCount={10}
 *   itemType="sequence"
 *   onNavigateToIndex={handleNavigateToIndex}
 *   onNavigateNext={handleNext}
 *   onNavigatePrevious={handlePrevious}
 *   showKeyboardShortcuts={true}
 * />
 */
export default function NavigationPanel({
  currentIndex,
  totalCount,
  itemType = 'item',
  onNavigateToIndex,
  onNavigateNext,
  onNavigatePrevious,
  onNavigateFirst,
  onNavigateLast,
  allowDirectNavigation = true,
  showKeyboardShortcuts = true,
  showItemType = true,
  enableWrapping = false,
  compactMode = false,
  className = '',
  'data-testid': testId
}: NavigationPanelProps) {
  
  // Create navigation state using pure utility
  const navigation = createAnnotationNavigation(currentIndex, totalCount);
  
  /**
   * Handles direct navigation input
   */
  const handleDirectNavigation = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    if (!isNaN(value) && value >= 1 && value <= totalCount) {
      onNavigateToIndex(value - 1); // Convert to 0-based index
    }
  };

  /**
   * Handles keyboard shortcuts for navigation
   */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowLeft':
      case 'h':
        event.preventDefault();
        if (navigation.canNavigatePrevious) {
          onNavigatePrevious();
        } else if (enableWrapping && onNavigateLast) {
          onNavigateLast();
        }
        break;
      case 'ArrowRight':
      case 'l':
        event.preventDefault();
        if (navigation.canNavigateNext) {
          onNavigateNext();
        } else if (enableWrapping && onNavigateFirst) {
          onNavigateFirst();
        }
        break;
      case 'Home':
        event.preventDefault();
        if (onNavigateFirst) {
          onNavigateFirst();
        }
        break;
      case 'End':
        event.preventDefault();
        if (onNavigateLast) {
          onNavigateLast();
        }
        break;
    }
  };

  /**
   * Gets navigation button styling and state
   * 
   * @pure Function returns button configuration
   */
  const getNavigationButtonConfig = () => {
    const baseClasses = "flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500";
    const enabledClasses = "text-gray-700 bg-white hover:bg-gray-50";
    const disabledClasses = "text-gray-400 bg-gray-50 cursor-not-allowed";
    
    return {
      previous: {
        disabled: !navigation.canNavigatePrevious && !enableWrapping,
        classes: `${baseClasses} ${(!navigation.canNavigatePrevious && !enableWrapping) ? disabledClasses : enabledClasses}`
      },
      next: {
        disabled: !navigation.canNavigateNext && !enableWrapping,
        classes: `${baseClasses} ${(!navigation.canNavigateNext && !enableWrapping) ? disabledClasses : enabledClasses}`
      }
    };
  };

  const buttonConfig = getNavigationButtonConfig();

  if (compactMode) {
    return (
      <div className={`flex items-center space-x-2 ${className}`} data-testid={testId}>
        {/* Compact Previous Button */}
        <button
          onClick={onNavigatePrevious}
          disabled={buttonConfig.previous.disabled}
          className={`p-1 rounded ${buttonConfig.previous.classes}`}
          title="Previous"
          aria-label="Navigate to previous item"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Compact Counter */}
        <span className="text-sm text-gray-600 min-w-0 text-center">
          {navigation.currentIndex + 1} / {navigation.totalCount}
        </span>

        {/* Compact Next Button */}
        <button
          onClick={onNavigateNext}
          disabled={buttonConfig.next.disabled}
          className={`p-1 rounded ${buttonConfig.next.classes}`}
          title="Next"
          aria-label="Navigate to next item"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div 
      className={`bg-white border border-gray-200 rounded-lg p-4 space-y-4 ${className}`}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      data-testid={testId}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <h3 className="text-sm font-medium text-gray-900">Navigation</h3>
          {showItemType && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
              {itemType}
            </span>
          )}
        </div>
        
        {showKeyboardShortcuts && (
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600"
            title="Keyboard shortcuts: ← → or H L keys, Home/End for first/last"
          >
            <Keyboard className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation Controls */}
      <div className="flex items-center space-x-3">
        {/* Previous Button */}
        <button
          onClick={onNavigatePrevious}
          disabled={buttonConfig.previous.disabled}
          className={buttonConfig.previous.classes}
          title={enableWrapping && !navigation.canNavigatePrevious ? "Previous (wraps to last)" : "Previous"}
          aria-label="Navigate to previous item"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Previous
        </button>

        {/* Direct Navigation Input */}
        {allowDirectNavigation && (
          <div className="flex items-center space-x-2">
            <input
              type="number"
              min={1}
              max={totalCount}
              value={navigation.currentIndex + 1}
              onChange={handleDirectNavigation}
              className="w-16 px-2 py-1 text-sm border border-gray-300 rounded text-center focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              aria-label={`Navigate to ${itemType} number`}
            />
            <span className="text-sm text-gray-500">
              of {navigation.totalCount}
            </span>
          </div>
        )}

        {/* Counter Only (if direct navigation disabled) */}
        {!allowDirectNavigation && (
          <div className="flex items-center justify-center px-3 py-2 bg-gray-50 rounded-md">
            <span className="text-sm font-medium text-gray-700">
              {navigation.currentIndex + 1} of {navigation.totalCount}
            </span>
          </div>
        )}

        {/* Next Button */}
        <button
          onClick={onNavigateNext}
          disabled={buttonConfig.next.disabled}
          className={buttonConfig.next.classes}
          title={enableWrapping && !navigation.canNavigateNext ? "Next (wraps to first)" : "Next"}
          aria-label="Navigate to next item"
        >
          Next
          <ChevronRight className="w-4 h-4 ml-1" />
        </button>
      </div>

      {/* Quick Navigation */}
      {(onNavigateFirst || onNavigateLast) && (
        <div className="flex items-center justify-center space-x-2 pt-2 border-t border-gray-200">
          {onNavigateFirst && (
            <button
              onClick={onNavigateFirst}
              disabled={navigation.isFirstItem}
              className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
              title="Go to first item"
            >
              First
            </button>
          )}
          
          <span className="text-xs text-gray-400">•</span>
          
          {onNavigateLast && (
            <button
              onClick={onNavigateLast}
              disabled={navigation.isLastItem}
              className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
              title="Go to last item"
            >
              Last
            </button>
          )}
        </div>
      )}

      {/* Progress Indicator */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>Progress</span>
          <span>{Math.round(((navigation.currentIndex + 1) / navigation.totalCount) * 100)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1">
          <div
            className="bg-primary-600 h-1 rounded-full transition-all duration-300"
            style={{ 
              width: `${((navigation.currentIndex + 1) / navigation.totalCount) * 100}%` 
            }}
          />
        </div>
      </div>

      {/* Keyboard Shortcuts Help */}
      {showKeyboardShortcuts && (
        <div className="pt-2 border-t border-gray-200">
          <div className="flex items-start space-x-2">
            <Info className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-gray-500 space-y-1">
              <div>Use ← → arrow keys or H/L to navigate</div>
              <div>Home/End for first/last item</div>
              {allowDirectNavigation && (
                <div>Click number field to jump to specific item</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Simple navigation arrows for inline use
 * 
 * @pure Component renders minimal navigation arrows
 * @param props - Minimal navigation props
 * @returns JSX element for simple navigation
 * 
 * @example
 * <SimpleNavigation
 *   currentIndex={2}
 *   totalCount={10}
 *   onNavigateNext={handleNext}
 *   onNavigatePrevious={handlePrevious}
 * />
 */
export function SimpleNavigation(props: Pick<NavigationPanelProps,
  'currentIndex' | 'totalCount' | 'onNavigateNext' | 'onNavigatePrevious' | 'className'
>) {
  return (
    <NavigationPanel
      {...props}
      onNavigateToIndex={() => {}}
      allowDirectNavigation={false}
      showKeyboardShortcuts={false}
      showItemType={false}
      compactMode={true}
    />
  );
}

/**
 * Navigation panel with wrapping support
 * 
 * @pure Component renders navigation with wrapping
 * @param props - Navigation props with wrapping
 * @returns JSX element for wrapping navigation
 * 
 * @example
 * <WrappingNavigation
 *   currentIndex={2}
 *   totalCount={10}
 *   onNavigateNext={handleNext}
 *   onNavigatePrevious={handlePrevious}
 *   onNavigateFirst={handleFirst}
 *   onNavigateLast={handleLast}
 * />
 */
export function WrappingNavigation(props: NavigationPanelProps) {
  return (
    <NavigationPanel
      {...props}
      enableWrapping={true}
      showKeyboardShortcuts={true}
    />
  );
}

/**
 * Read-only navigation display for status indication
 * 
 * @pure Component renders read-only navigation status
 * @param props - Read-only navigation props
 * @returns JSX element for navigation status
 * 
 * @example
 * <NavigationStatus
 *   currentIndex={2}
 *   totalCount={10}
 *   itemType="sequence"
 * />
 */
export function NavigationStatus(props: Pick<NavigationPanelProps,
  'currentIndex' | 'totalCount' | 'itemType' | 'className'
>) {
  return (
    <NavigationPanel
      {...props}
      onNavigateToIndex={() => {}}
      onNavigateNext={() => {}}
      onNavigatePrevious={() => {}}
      allowDirectNavigation={false}
      showKeyboardShortcuts={false}
      compactMode={true}
    />
  );
}