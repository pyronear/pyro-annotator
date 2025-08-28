/**
 * Utility functions and constants for date range filter components.
 * Extracted from DateRangeFilter to maintain React fast refresh compatibility.
 */

/**
 * Configuration for date preset options
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
 * Calculates date range for preset selection
 *
 * @pure Function calculates dates based on preset
 * @param preset - Preset key ('7d', '30d', '90d')
 * @param referenceDate - Reference date for calculation (defaults to today)
 * @returns Object with dateFrom and dateTo strings
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
    dateTo: todayString,
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
  return dateFrom || dateTo ? 1 : 0;
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
      const daysDiff = Math.abs(
        (fromDate.getTime() - expectedFromDate.getTime()) / (24 * 60 * 60 * 1000)
      );
      if (daysDiff <= 1) {
        return preset.key;
      }
    }
  }

  return null;
};