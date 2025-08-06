import { useState } from 'react';
import { Check, AlertTriangle, Flame, X } from 'lucide-react';
import { clsx } from 'clsx';
import { SmokeType, FalsePositiveType } from '@/types/api';
import { SMOKE_LABELS, FALSE_POSITIVE_LABELS } from '@/utils/constants';

interface AnnotationInterfaceProps {
  onAnnotationSubmit: (annotation: AnnotationData) => void;
  onSkip: () => void;
  disabled?: boolean;
  required?: boolean;
}

export interface AnnotationData {
  is_smoke: boolean;
  smoke_type?: SmokeType;
  false_positive_types: FalsePositiveType[];
  has_missed_smoke: boolean;
}

export default function AnnotationInterface({
  onAnnotationSubmit,
  onSkip,
  disabled = false,
  required = false,
}: AnnotationInterfaceProps) {
  const [isSmoke, setIsSmoke] = useState(false);
  const [smokeType, setSmokeType] = useState<SmokeType | undefined>();
  const [falsePositiveTypes, setFalsePositiveTypes] = useState<FalsePositiveType[]>([]);
  const [hasMissedSmoke, setHasMissedSmoke] = useState(false);

  const handleSmokeToggle = (smoke: boolean) => {
    setIsSmoke(smoke);
    if (!smoke) {
      setSmokeType(undefined);
    } else {
      setFalsePositiveTypes([]);
    }
  };

  const handleFalsePositiveToggle = (type: FalsePositiveType) => {
    setFalsePositiveTypes(prev => {
      if (prev.includes(type)) {
        return prev.filter(t => t !== type);
      } else {
        return [...prev, type];
      }
    });
  };

  const handleSubmit = () => {
    const annotation: AnnotationData = {
      is_smoke: isSmoke,
      smoke_type: smokeType,
      false_positive_types: falsePositiveTypes,
      has_missed_smoke: hasMissedSmoke,
    };
    onAnnotationSubmit(annotation);
  };

  const handleReset = () => {
    setIsSmoke(false);
    setSmokeType(undefined);
    setFalsePositiveTypes([]);
    setHasMissedSmoke(false);
  };

  const isComplete = isSmoke || falsePositiveTypes.length > 0 || hasMissedSmoke;
  const isValidSmoke = !isSmoke || (isSmoke && smokeType);

  const getLabelColor = (type: 'smoke' | 'false_positive', value: string): string => {
    if (type === 'smoke') {
      const colorMap: Record<string, string> = {
        'wildfire': 'bg-red-100 text-red-800 border-red-300',
        'industrial': 'bg-orange-100 text-orange-800 border-orange-300',
        'other': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      };
      return colorMap[value] || 'bg-gray-100 text-gray-800 border-gray-300';
    } else {
      const colorMap: Record<string, string> = {
        'antenna': 'bg-purple-100 text-purple-800 border-purple-300',
        'building': 'bg-gray-100 text-gray-800 border-gray-300',
        'cliff': 'bg-stone-100 text-stone-800 border-stone-300',
        'dark': 'bg-slate-100 text-slate-800 border-slate-300',
        'dust': 'bg-amber-100 text-amber-800 border-amber-300',
        'high_cloud': 'bg-sky-100 text-sky-800 border-sky-300',
        'low_cloud': 'bg-blue-100 text-blue-800 border-blue-300',
        'lens_flare': 'bg-yellow-100 text-yellow-800 border-yellow-300',
        'lens_droplet': 'bg-cyan-100 text-cyan-800 border-cyan-300',
        'light': 'bg-lime-100 text-lime-800 border-lime-300',
        'rain': 'bg-indigo-100 text-indigo-800 border-indigo-300',
        'trail': 'bg-emerald-100 text-emerald-800 border-emerald-300',
        'road': 'bg-zinc-100 text-zinc-800 border-zinc-300',
        'sky': 'bg-blue-100 text-blue-800 border-blue-300',
        'tree': 'bg-green-100 text-green-800 border-green-300',
        'water_body': 'bg-teal-100 text-teal-800 border-teal-300',
        'other': 'bg-gray-100 text-gray-800 border-gray-300',
      };
      return colorMap[value] || 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const formatLabel = (label: string): string => {
    return label
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">
          Detection Classification
        </h3>
        <button
          onClick={handleReset}
          disabled={disabled}
          className="text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      {/* Smoke vs False Positive Choice */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handleSmokeToggle(true)}
            disabled={disabled}
            className={clsx(
              'p-4 rounded-lg border-2 text-left transition-all duration-200',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
              disabled && 'cursor-not-allowed opacity-50',
              !disabled && 'cursor-pointer hover:shadow-md',
              isSmoke
                ? 'bg-red-50 text-red-800 border-red-300 shadow-sm'
                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Flame className="w-5 h-5 mr-3" />
                <div>
                  <div className="font-medium">Smoke Detected</div>
                  <div className="text-sm opacity-75">This is actual smoke</div>
                </div>
              </div>
              {isSmoke && <Check className="w-5 h-5" />}
            </div>
          </button>

          <button
            onClick={() => handleSmokeToggle(false)}
            disabled={disabled}
            className={clsx(
              'p-4 rounded-lg border-2 text-left transition-all duration-200',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
              disabled && 'cursor-not-allowed opacity-50',
              !disabled && 'cursor-pointer hover:shadow-md',
              !isSmoke && (falsePositiveTypes.length > 0 || !isSmoke)
                ? 'bg-blue-50 text-blue-800 border-blue-300 shadow-sm'
                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <X className="w-5 h-5 mr-3" />
                <div>
                  <div className="font-medium">False Positive</div>
                  <div className="text-sm opacity-75">Not actual smoke</div>
                </div>
              </div>
              {!isSmoke && falsePositiveTypes.length > 0 && <Check className="w-5 h-5" />}
            </div>
          </button>
        </div>

        {/* Smoke Type Selection */}
        {isSmoke && (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              What type of smoke? *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SMOKE_LABELS.map((type) => {
                const isSelected = smokeType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setSmokeType(type)}
                    disabled={disabled}
                    className={clsx(
                      'p-3 rounded-lg border-2 text-left transition-all duration-200',
                      'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
                      disabled && 'cursor-not-allowed opacity-50',
                      !disabled && 'cursor-pointer hover:shadow-sm',
                      isSelected
                        ? [getLabelColor('smoke', type), 'border-current shadow-sm']
                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{formatLabel(type)}</span>
                      {isSelected && <Check className="w-4 h-4" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* False Positive Type Selection */}
        {!isSmoke && (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              What caused the false positive? (Select all that apply)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {FALSE_POSITIVE_LABELS.map((type) => {
                const isSelected = falsePositiveTypes.includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => handleFalsePositiveToggle(type)}
                    disabled={disabled}
                    className={clsx(
                      'p-2 rounded-lg border-2 text-left transition-all duration-200',
                      'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
                      disabled && 'cursor-not-allowed opacity-50',
                      !disabled && 'cursor-pointer hover:shadow-sm',
                      isSelected
                        ? [getLabelColor('false_positive', type), 'border-current shadow-sm']
                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{formatLabel(type)}</span>
                      {isSelected && <Check className="w-3 h-3" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Missed Smoke Option */}
      <div className="border-t border-gray-200 pt-4">
        <label className="flex items-start space-x-3 cursor-pointer">
          <div className="flex items-center h-5">
            <input
              type="checkbox"
              checked={hasMissedSmoke}
              onChange={(e) => setHasMissedSmoke(e.target.checked)}
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

      {/* Summary */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-gray-900">
              Classification: 
            </span>
            {isSmoke ? (
              <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">
                Smoke {smokeType && `(${formatLabel(smokeType)})`}
              </span>
            ) : falsePositiveTypes.length > 0 ? (
              <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                False Positive
              </span>
            ) : (
              <span className="ml-2 text-sm text-gray-500">Not classified</span>
            )}
            {hasMissedSmoke && (
              <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs bg-amber-100 text-amber-800">
                + Missed Detection
              </span>
            )}
          </div>
          
          {required && (
            <div className="flex items-center space-x-2">
              {isComplete && isValidSmoke ? (
                <div className="flex items-center text-green-600">
                  <Check className="w-4 h-4 mr-1" />
                  <span className="text-sm font-medium">Ready</span>
                </div>
              ) : (
                <div className="flex items-center text-amber-600">
                  <AlertTriangle className="w-4 h-4 mr-1" />
                  <span className="text-sm font-medium">
                    {!isComplete ? 'Required' : 'Select smoke type'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {falsePositiveTypes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {falsePositiveTypes.map((type) => (
              <span
                key={type}
                className={clsx(
                  'inline-flex items-center px-2 py-1 rounded text-xs font-medium',
                  getLabelColor('false_positive', type)
                )}
              >
                {formatLabel(type)}
                {!disabled && (
                  <button
                    onClick={() => handleFalsePositiveToggle(type)}
                    className="ml-1 hover:opacity-80"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center space-x-4">
        <button
          onClick={handleSubmit}
          disabled={!isComplete || !isValidSmoke || disabled}
          className={clsx(
            'flex items-center px-6 py-3 rounded-md text-sm font-medium transition-colors',
            (isComplete && isValidSmoke && !disabled)
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          )}
        >
          Submit Classification
        </button>

        <button
          onClick={onSkip}
          disabled={disabled}
          className="flex items-center px-6 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Skip This Detection
        </button>
      </div>
    </div>
  );
}