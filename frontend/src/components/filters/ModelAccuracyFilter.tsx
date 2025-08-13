import { ModelAccuracyType } from '@/utils/modelAccuracy';

interface ModelAccuracyFilterProps {
  selectedAccuracy: ModelAccuracyType | 'all';
  onSelectionChange: (accuracy: ModelAccuracyType | 'all') => void;
  label?: string;
  className?: string;
}

export default function ModelAccuracyFilter({
  selectedAccuracy,
  onSelectionChange,
  label = 'Model Accuracy',
  className = '',
}: ModelAccuracyFilterProps) {
  const accuracyOptions: Array<{ value: ModelAccuracyType | 'all'; label: string; icon?: string }> = [
    { value: 'all', label: 'All Results' },
    { value: 'true_positive', label: 'True Positive', icon: '✅' },
    { value: 'false_positive', label: 'False Positive', icon: '❌' },
    { value: 'false_negative', label: 'False Negative', icon: '🔍' },
  ];

  const getDisplayText = (value: ModelAccuracyType | 'all') => {
    const option = accuracyOptions.find(opt => opt.value === value);
    if (option && option.icon) {
      return `${option.icon} ${option.label}`;
    }
    return option?.label || 'All Results';
  };

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <select
        value={selectedAccuracy}
        onChange={(e) => onSelectionChange(e.target.value as ModelAccuracyType | 'all')}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
      >
        {accuracyOptions.map(option => (
          <option key={option.value} value={option.value}>
            {getDisplayText(option.value)}
          </option>
        ))}
      </select>
    </div>
  );
}