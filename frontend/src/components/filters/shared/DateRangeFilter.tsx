import React from 'react';

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
 * Configuration for date range preset buttons
 */
export interface DatePresetOption {
  readonly key: string;
  readonly label: string;
  readonly days?: number;
}

/**
 * Default preset options for common date ranges
 * 
 * @pure Constant array of preset configurations
 */
export const DEFAULT_DATE_PRESETS: readonly DatePresetOption[] = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
] as const;

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
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>

      {/* Preset Buttons */}
      {showPresets && (
        <div className="flex gap-1 mb-3">
          {presetOptions.map((preset) => {
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

/**
 * Calculates date range based on preset selection
 * 
 * @pure Function calculates dates without side effects
 * @param preset - Preset key (e.g., '7d', '30d', '90d')
 * @param referenceDate - Reference date to calculate from (defaults to now)
 * @returns Object with formatted date strings
 * 
 * @example
 * const { dateFrom, dateTo } = calculatePresetDateRange('30d');
 * setDateFrom(dateFrom);
 * setDateTo(dateTo);
 */
export const calculatePresetDateRange = (
  preset: string,
  referenceDate: Date = new Date()
): { readonly dateFrom: string; readonly dateTo: string } => {
  const today = new Date(referenceDate);
  const todayString = formatDateForInput(today);

  // Find preset configuration
  const presetConfig = DEFAULT_DATE_PRESETS.find(p => p.key === preset);
  
  if (!presetConfig || !presetConfig.days) {
    return { dateFrom: '', dateTo: todayString };
  }

  // Calculate start date
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - presetConfig.days);
  const startDateString = formatDateForInput(startDate);

  return {
    dateFrom: startDateString,
    dateTo: todayString
  };
};

/**
 * Formats Date object to YYYY-MM-DD string for date inputs
 * 
 * @pure Function formats dates consistently
 * @param date - Date object to format
 * @returns Date string in YYYY-MM-DD format
 * 
 * @example
 * const dateString = formatDateForInput(new Date());
 * // Returns: "2024-01-15"
 */
export const formatDateForInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Validates if date range is valid (from <= to)
 * 
 * @pure Function validates date range
 * @param dateFrom - Start date string
 * @param dateTo - End date string  
 * @returns True if range is valid or either date is empty
 * 
 * @example
 * const isValid = isValidDateRange('2024-01-01', '2024-01-31');
 * // Returns: true
 */
export const isValidDateRange = (dateFrom: string, dateTo: string): boolean => {
  if (!dateFrom || !dateTo) return true;
  return new Date(dateFrom) <= new Date(dateTo);
};

/**
 * Counts active date filters for badge display
 * 
 * @pure Function counts non-empty date values
 * @param dateFrom - Start date string
 * @param dateTo - End date string
 * @returns Number of active date filters (0-1)
 * 
 * @example
 * const activeCount = countActiveDateFilters('2024-01-01', '2024-01-31');
 * // Returns: 1
 */
export const countActiveDateFilters = (dateFrom: string, dateTo: string): number => {
  return (dateFrom || dateTo) ? 1 : 0;
};

/**
 * Determines which preset matches the given date range
 * 
 * @pure Function analyzes date values against preset options
 * @param dateFrom - Start date string (YYYY-MM-DD)
 * @param dateTo - End date string (YYYY-MM-DD) 
 * @param presetOptions - Array of preset configurations
 * @returns Preset key if match found, null otherwise
 * 
 * @example
 * const preset = detectActivePreset('2024-01-24', '2024-01-31', DEFAULT_DATE_PRESETS);
 * // Returns: '7d' (if dates match 7-day preset)
 */
export const detectActivePreset = (
  dateFrom: string, 
  dateTo: string, 
  presetOptions: readonly DatePresetOption[] = DEFAULT_DATE_PRESETS
): string | null => {
  if (!dateFrom || !dateTo) return null;
  
  const fromDate = new Date(dateFrom);
  const toDate = new Date(dateTo);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Check if 'to' date is today (allow some tolerance)
  const isToDateToday = Math.abs(toDate.getTime() - today.getTime()) <= 24 * 60 * 60 * 1000;
  if (!isToDateToday) return null;
  
  // Check each preset
  for (const preset of presetOptions) {
    if (preset.days) {
      const expectedFromDate = new Date(today);
      expectedFromDate.setDate(expectedFromDate.getDate() - preset.days);
      
      // Allow 1-day tolerance for date matching
      const daysDiff = Math.abs((fromDate.getTime() - expectedFromDate.getTime()) / (24 * 60 * 60 * 1000));
      if (daysDiff <= 1) {
        return preset.key;
      }
    }
  }
  
  return null;
};