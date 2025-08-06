import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { ANNOTATION_LABELS, AnnotationLabel } from '@/utils/constants';

interface LabelSelectorProps {
  selectedLabels: AnnotationLabel[];
  onLabelsChange: (labels: AnnotationLabel[]) => void;
  disabled?: boolean;
  required?: boolean;
  showMissedSmoke?: boolean;
  missedSmoke?: boolean;
  onMissedSmokeChange?: (missed: boolean) => void;
}

export default function LabelSelector({
  selectedLabels,
  onLabelsChange,
  disabled = false,
  required = false,
  showMissedSmoke = true,
  missedSmoke = false,
  onMissedSmokeChange,
}: LabelSelectorProps) {
  const [hoveredLabel, setHoveredLabel] = useState<AnnotationLabel | null>(null);

  const handleLabelToggle = (label: AnnotationLabel) => {
    if (disabled) return;

    const isSelected = selectedLabels.includes(label);
    let newLabels: AnnotationLabel[];

    if (isSelected) {
      newLabels = selectedLabels.filter(l => l !== label);
    } else {
      newLabels = [...selectedLabels, label];
    }

    onLabelsChange(newLabels);
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onLabelsChange([...ANNOTATION_LABELS]);
  };

  const handleClearAll = () => {
    if (disabled) return;
    onLabelsChange([]);
  };

  const getLabelColor = (label: AnnotationLabel): string => {
    const colorMap: Record<AnnotationLabel, string> = {
      'Smoke': 'bg-red-100 text-red-800 border-red-300',
      'Industrial_smoke': 'bg-orange-100 text-orange-800 border-orange-300',
      'Sun flare': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'Cloud': 'bg-blue-100 text-blue-800 border-blue-300',
      'Building': 'bg-gray-100 text-gray-800 border-gray-300',
      'Antenna': 'bg-purple-100 text-purple-800 border-purple-300',
      'Other': 'bg-indigo-100 text-indigo-800 border-indigo-300',
    };
    return colorMap[label];
  };

  const getLabelDescription = (label: AnnotationLabel): string => {
    const descriptions: Record<AnnotationLabel, string> = {
      'Smoke': 'Wildfire smoke plume',
      'Industrial_smoke': 'Industrial or controlled burn smoke',
      'Sun flare': 'Bright sunlight reflection or lens flare',
      'Cloud': 'Natural cloud formation',
      'Building': 'Building or structure in the frame',
      'Antenna': 'Communication antenna or tower',
      'Other': 'Other false positive or unclear object',
    };
    return descriptions[label];
  };

  const isComplete = selectedLabels.length > 0 || missedSmoke;
  const showValidation = required && !disabled;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">
            Label Selection
          </h3>
          <p className="text-sm text-gray-600">
            Select all applicable labels for this detection
          </p>
        </div>
        
        {!disabled && (
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSelectAll}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              Select All
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={handleClearAll}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {/* Label Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {ANNOTATION_LABELS.map((label) => {
          const isSelected = selectedLabels.includes(label);
          const isHovered = hoveredLabel === label;
          
          return (
            <button
              key={label}
              onClick={() => handleLabelToggle(label)}
              onMouseEnter={() => setHoveredLabel(label)}
              onMouseLeave={() => setHoveredLabel(null)}
              disabled={disabled}
              className={clsx(
                'relative p-3 rounded-lg border-2 text-left transition-all duration-200',
                'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
                disabled && 'cursor-not-allowed opacity-50',
                !disabled && 'cursor-pointer hover:shadow-md',
                isSelected
                  ? [getLabelColor(label), 'border-current shadow-sm']
                  : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300',
                isHovered && !isSelected && 'bg-gray-50'
              )}
              title={getLabelDescription(label)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {label.replace('_', ' ')}
                  </div>
                </div>
                
                {isSelected && (
                  <Check className="w-5 h-5 flex-shrink-0 ml-2" />
                )}
              </div>
              
              {isHovered && (
                <div className="absolute bottom-full left-0 right-0 mb-2 p-2 bg-gray-900 text-white text-xs rounded shadow-lg z-10">
                  {getLabelDescription(label)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Missed Smoke Option */}
      {showMissedSmoke && (
        <div className="border-t border-gray-200 pt-4">
          <label className="flex items-start space-x-3 cursor-pointer">
            <div className="flex items-center h-5">
              <input
                type="checkbox"
                checked={missedSmoke}
                onChange={(e) => onMissedSmokeChange?.(e.target.checked)}
                disabled={disabled}
                className={clsx(
                  'h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500',
                  disabled && 'cursor-not-allowed opacity-50'
                )}
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="font-medium text-gray-900">
                  Missed Detection
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                There is a smoke event not detected by the model
              </p>
            </div>
          </label>
        </div>
      )}

      {/* Selection Summary */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-gray-900">
              Selected: {selectedLabels.length} label{selectedLabels.length !== 1 ? 's' : ''}
            </span>
            {missedSmoke && (
              <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs bg-amber-100 text-amber-800">
                + Missed Detection
              </span>
            )}
          </div>
          
          {showValidation && (
            <div className="flex items-center space-x-2">
              {isComplete ? (
                <div className="flex items-center text-green-600">
                  <Check className="w-4 h-4 mr-1" />
                  <span className="text-sm font-medium">Complete</span>
                </div>
              ) : (
                <div className="flex items-center text-amber-600">
                  <AlertTriangle className="w-4 h-4 mr-1" />
                  <span className="text-sm font-medium">Required</span>
                </div>
              )}
            </div>
          )}
        </div>

        {selectedLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {selectedLabels.map((label) => (
              <span
                key={label}
                className={clsx(
                  'inline-flex items-center px-2 py-1 rounded text-xs font-medium',
                  getLabelColor(label)
                )}
              >
                {label.replace('_', ' ')}
                {!disabled && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLabelToggle(label);
                    }}
                    className="ml-1 hover:text-current/80"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}