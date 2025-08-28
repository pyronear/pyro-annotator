import React from 'react';
import {
  DatePresetOption,
  DEFAULT_DATE_PRESETS,
  detectActivePreset,
} from './dateRangeUtils';

/**
 * Props for the DateRangeFilter component
 */
interface DateRangeFilterProps {
  readonly label?: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly onDateFromChange: (date: string) => void;
  readonly onDateToChange: (date: string) => void;
  readonly onPresetSelect: (preset: string) => void;
  readonly onClear: () => void;
  readonly presetOptions?: readonly DatePresetOption[];
  readonly className?: string;
  readonly showPresets?: boolean;
  readonly 'data-testid'?: string;
}


/**
 * Pure date range filter component with preset buttons
 *
 * Provides a complete date range selection interface with:
 * - From/To date inputs
 * - Preset quick selection buttons (7d, 30d, 90d)
 * - Clear functionality
 * - Consistent styling and accessibility
 *
 * @pure Component renders consistently for same props
 * @param props - Date range filter configuration
 * @returns JSX element for date range selection
 *
 * @example
 * <DateRangeFilter
 *   label="Date Range (Recorded)"
 *   dateFrom={dateFrom}
 *   dateTo={dateTo}
 *   onDateFromChange={handleDateFromChange}
 *   onDateToChange={handleDateToChange}
 *   onPresetSelect={handlePresetSelect}
 *   onClear={handleDateClear}
 * />
 */
export default function DateRangeFilter({
  label = 'Date Range',
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onPresetSelect,
  onClear,
  presetOptions = DEFAULT_DATE_PRESETS,
  className = '',
  showPresets = true,
  'data-testid': testId,
}: DateRangeFilterProps) {
  /**
   * Handles date input changes and ensures valid values
   *
   * @pure Function processes date input events
   */
  const handleDateFromChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onDateFromChange(event.target.value);
  };

  const handleDateToChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onDateToChange(event.target.value);
  };

  /**
   * Determines which preset (if any) matches the current date range
   *
   * @pure Function analyzes current date values against presets
   */
  const getCurrentPreset = (): string | null => {
    return detectActivePreset(dateFrom, dateTo, presetOptions);
  };

  /**
   * Handles preset button clicks
   *
   * @pure Function delegates preset selection to parent component
   */
  const handlePresetClick = (presetKey: string) => {
    onPresetSelect(presetKey);
  };

  const currentPreset = getCurrentPreset();

  return (
    <div className={className} data-testid={testId}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>

      {/* Preset Buttons */}
      {showPresets && (
        <div className="flex gap-1 mb-3">
          {presetOptions.map(preset => {
            const isActive = currentPreset === preset.key;
            return (
              <button
                key={preset.key}
                onClick={() => handlePresetClick(preset.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                  isActive
                    ? 'bg-primary-600 text-white border border-primary-600 shadow-sm hover:bg-primary-700 focus:ring-primary-500'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 focus:ring-primary-500'
                }`}
                type="button"
                aria-label={`Set date range to last ${preset.label}`}
                aria-pressed={isActive}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            onClick={onClear}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md text-red-600 bg-white hover:bg-red-50 hover:border-red-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500 transition-all duration-200"
            type="button"
            aria-label="Clear date range"
          >
            Clear
          </button>
        </div>
      )}

      {/* Date Inputs */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs text-gray-600 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={handleDateFromChange}
            className={`w-full border rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
              dateFrom ? 'border-primary-300 bg-primary-50/50' : 'border-gray-300 bg-white'
            }`}
            aria-label={`${label} from date`}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-600 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={handleDateToChange}
            className={`w-full border rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
              dateTo ? 'border-primary-300 bg-primary-50/50' : 'border-gray-300 bg-white'
            }`}
            aria-label={`${label} to date`}
          />
        </div>
      </div>
    </div>
  );
}

