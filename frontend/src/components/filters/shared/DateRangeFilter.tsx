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
   * Handles preset button clicks
   * 
   * @pure Function delegates preset selection
   */
  const handlePresetClick = (presetKey: string) => {
    onPresetSelect(presetKey);
  };

  return (
    <div className={className} data-testid={testId}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>

      {/* Preset Buttons */}
      {showPresets && (
        <div className="flex gap-1 mb-2">
          {presetOptions.map((preset) => (
            <button
              key={preset.key}
              onClick={() => handlePresetClick(preset.key)}
              className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500 transition-colors"
              type="button"
              aria-label={`Set date range to last ${preset.label}`}
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={onClear}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500 text-red-600 transition-colors"
            type="button"
            aria-label="Clear date range"
          >
            Clear
          </button>
        </div>
      )}

      {/* Date Inputs */}
      <div className="flex gap-2">
        <input
          type="date"
          value={dateFrom}
          onChange={handleDateFromChange}
          className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-primary-500 focus:border-primary-500"
          placeholder="From"
          aria-label={`${label} from date`}
        />
        <input
          type="date"
          value={dateTo}
          onChange={handleDateToChange}
          className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-primary-500 focus:border-primary-500"
          placeholder="To"
          aria-label={`${label} to date`}
        />
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