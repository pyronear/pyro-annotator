import { Eye, CheckCircle, AlertCircle, X } from 'lucide-react';
import { SequenceBbox, FalsePositiveType } from '@/types/api';
import { 
  BboxAnnotationState,
  createBboxAnnotationState,
  updateBboxAnnotation 
} from '@/utils/annotation-state';
import { FALSE_POSITIVE_TYPES } from '@/utils/constants';
import GifViewer from '@/components/media/GifViewer';

/**
 * Props for the BboxAnnotationCard component
 */
interface BboxAnnotationCardProps {
  // Bbox data
  readonly bbox: SequenceBbox;
  readonly index: number;
  
  // Annotation state
  readonly isSelected: boolean;
  readonly isCurrentlyAnnotating: boolean;
  
  // Handlers
  readonly onSelect: () => void;
  readonly onSmokeChange: (isSmoke: boolean) => void;
  readonly onFalsePositiveChange: (types: readonly FalsePositiveType[]) => void;
  readonly onAnnotationComplete: () => void;
  
  // Configuration
  readonly showGifPreview?: boolean;
  readonly allowSmokeAnnotation?: boolean;
  readonly allowFalsePositiveAnnotation?: boolean;
  readonly compactMode?: boolean;
  
  // Styling
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/**
 * Pure bbox annotation card component for individual bbox annotation
 * 
 * Provides a complete interface for annotating individual bboxes within a sequence,
 * including smoke detection, false positive classification, and GIF preview.
 * 
 * @pure Component renders consistently for same props
 * @param props - Bbox annotation card configuration
 * @returns JSX element for bbox annotation
 * 
 * @example
 * <BboxAnnotationCard
 *   bbox={sequenceBbox}
 *   index={0}
 *   isSelected={true}
 *   onSelect={handleSelect}
 *   onSmokeChange={handleSmokeChange}
 *   onFalsePositiveChange={handleFalsePositiveChange}
 *   showGifPreview={true}
 * />
 */
export default function BboxAnnotationCard({
  bbox,
  index,
  isSelected,
  isCurrentlyAnnotating,
  onSelect,
  onSmokeChange,
  onFalsePositiveChange,
  onAnnotationComplete,
  showGifPreview = true,
  allowSmokeAnnotation = true,
  allowFalsePositiveAnnotation = true,
  compactMode = false,
  className = '',
  'data-testid': testId
}: BboxAnnotationCardProps) {
  
  // Create bbox annotation state using pure utility
  const annotationState = createBboxAnnotationState(bbox, index);
  
  /**
   * Handles smoke annotation toggle
   */
  const handleSmokeToggle = (checked: boolean) => {
    onSmokeChange(checked);
    
    // If marking as smoke, clear false positive types
    if (checked && bbox.false_positive_types.length > 0) {
      onFalsePositiveChange([]);
    }
  };

  /**
   * Handles false positive type selection
   */
  const handleFalsePositiveToggle = (type: FalsePositiveType, checked: boolean) => {
    let newTypes: FalsePositiveType[];
    
    if (checked) {
      // Add the type if not already present
      newTypes = bbox.false_positive_types.includes(type)
        ? bbox.false_positive_types
        : [...bbox.false_positive_types, type];
      
      // If adding false positive types, clear smoke annotation
      if (bbox.is_smoke) {
        onSmokeChange(false);
      }
    } else {
      // Remove the type
      newTypes = bbox.false_positive_types.filter(t => t !== type);
    }
    
    onFalsePositiveChange(newTypes);
  };

  /**
   * Handles annotation completion
   */
  const handleComplete = () => {
    if (annotationState.isAnnotated && !annotationState.hasConflict) {
      onAnnotationComplete();
    }
  };

  /**
   * Gets card styling based on annotation state
   * 
   * @pure Function returns styling classes based on state
   */
  const getCardStyling = () => {
    let borderClass = 'border-gray-200';
    let backgroundClass = 'bg-white';
    
    if (isSelected) {
      borderClass = 'border-blue-500 ring-1 ring-blue-500';
    } else if (annotationState.hasConflict) {
      borderClass = 'border-red-300';
      backgroundClass = 'bg-red-50';
    } else if (annotationState.isAnnotated) {
      borderClass = 'border-green-300';
      backgroundClass = 'bg-green-50';
    }
    
    return `${borderClass} ${backgroundClass}`;
  };

  /**
   * Gets annotation status display
   * 
   * @pure Function returns status display properties
   */
  const getStatusDisplay = () => {
    if (annotationState.hasConflict) {
      return {
        icon: AlertCircle,
        text: 'Conflict',
        classes: 'text-red-600'
      };
    } else if (annotationState.isAnnotated) {
      return {
        icon: CheckCircle,
        text: 'Annotated',
        classes: 'text-green-600'
      };
    } else {
      return {
        icon: Eye,
        text: 'Review',
        classes: 'text-gray-500'
      };
    }
  };

  const cardStyling = getCardStyling();
  const statusDisplay = getStatusDisplay();
  const StatusIcon = statusDisplay.icon;

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-all duration-200 hover:shadow-md ${cardStyling} ${className}`}
      onClick={onSelect}
      data-testid={testId}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Bbox ${index + 1} annotation`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h3 className="text-sm font-medium text-gray-900">
              Bbox {index + 1}
            </h3>
            
            {/* Status Indicator */}
            <div className={`flex items-center space-x-1 ${statusDisplay.classes}`}>
              <StatusIcon className="w-4 h-4" />
              <span className="text-xs font-medium">
                {statusDisplay.text}
              </span>
            </div>
          </div>
          
          {/* Detection Count */}
          <div className="text-xs text-gray-500">
            {bbox.bboxes.length} detection{bbox.bboxes.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={`p-4 space-y-4 ${compactMode ? 'p-3 space-y-3' : ''}`}>
        {/* GIF Preview */}
        {showGifPreview && !compactMode && (bbox.gif_key_main || bbox.gif_key_crop) && (
          <div className="aspect-video bg-gray-100 rounded-md overflow-hidden">
            <GifViewer
              mainGifUrl={bbox.gif_key_main}
              cropGifUrl={bbox.gif_key_crop}
              title={`Bbox ${index + 1} GIF`}
              className="w-full h-full"
            />
          </div>
        )}

        {/* Smoke Annotation */}
        {allowSmokeAnnotation && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Smoke Detection
            </label>
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={bbox.is_smoke}
                onChange={(e) => handleSmokeToggle(e.target.checked)}
                disabled={!isCurrentlyAnnotating}
                className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500 disabled:opacity-50"
              />
              <span className="text-sm text-gray-900">
                This bbox contains smoke
              </span>
              {bbox.is_smoke && (
                <span className="text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded-full">
                  Smoke Detected
                </span>
              )}
            </label>
          </div>
        )}

        {/* False Positive Annotation */}
        {allowFalsePositiveAnnotation && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              False Positive Types
            </label>
            <div className={`grid gap-2 ${compactMode ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {FALSE_POSITIVE_TYPES.map((type) => (
                <label
                  key={type.value}
                  className="flex items-center space-x-2 cursor-pointer p-2 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={bbox.false_positive_types.includes(type.value)}
                    onChange={(e) => handleFalsePositiveToggle(type.value, e.target.checked)}
                    disabled={!isCurrentlyAnnotating}
                    className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                  />
                  <span className="text-xs text-gray-700 flex-1">
                    {type.emoji} {type.label}
                  </span>
                </label>
              ))}
            </div>
            
            {/* Selected False Positive Types */}
            {bbox.false_positive_types.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {bbox.false_positive_types.map((type) => {
                  const typeConfig = FALSE_POSITIVE_TYPES.find(t => t.value === type);
                  return (
                    <span
                      key={type}
                      className="inline-flex items-center space-x-1 text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded-full"
                    >
                      <span>{typeConfig?.emoji || ''}</span>
                      <span>{typeConfig?.label || type}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFalsePositiveToggle(type, false);
                        }}
                        className="ml-1 text-blue-600 hover:text-blue-800"
                        aria-label={`Remove ${type} false positive type`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Conflict Warning */}
        {annotationState.hasConflict && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <div className="font-medium text-red-800">Annotation Conflict</div>
                <div className="text-red-700 mt-1">
                  This bbox cannot be marked as both smoke and false positive. 
                  Please choose one annotation type.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Complete Button */}
        {isCurrentlyAnnotating && annotationState.isAnnotated && !annotationState.hasConflict && (
          <button
            onClick={handleComplete}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            <span>Complete Annotation</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Compact bbox annotation card for list views
 * 
 * @pure Component renders minimal bbox card
 * @param props - Subset of BboxAnnotationCardProps
 * @returns JSX element for compact bbox card
 * 
 * @example
 * <CompactBboxCard
 *   bbox={bbox}
 *   index={0}
 *   onSelect={handleSelect}
 *   isSelected={isSelected}
 * />
 */
export function CompactBboxCard(props: Pick<BboxAnnotationCardProps,
  'bbox' | 'index' | 'isSelected' | 'onSelect' | 'className'
>) {
  return (
    <BboxAnnotationCard
      {...props}
      isCurrentlyAnnotating={false}
      onSmokeChange={() => {}}
      onFalsePositiveChange={() => {}}
      onAnnotationComplete={() => {}}
      showGifPreview={false}
      allowSmokeAnnotation={false}
      allowFalsePositiveAnnotation={false}
      compactMode={true}
    />
  );
}

/**
 * Read-only bbox annotation card for review contexts
 * 
 * @pure Component renders read-only bbox card
 * @param props - Read-only specific props
 * @returns JSX element for read-only bbox card
 * 
 * @example
 * <ReadOnlyBboxCard
 *   bbox={bbox}
 *   index={0}
 *   showGifPreview={true}
 * />
 */
export function ReadOnlyBboxCard(props: Pick<BboxAnnotationCardProps,
  'bbox' | 'index' | 'showGifPreview' | 'className'
>) {
  return (
    <BboxAnnotationCard
      {...props}
      isSelected={false}
      isCurrentlyAnnotating={false}
      onSelect={() => {}}
      onSmokeChange={() => {}}
      onFalsePositiveChange={() => {}}
      onAnnotationComplete={() => {}}
      allowSmokeAnnotation={false}
      allowFalsePositiveAnnotation={false}
    />
  );
}