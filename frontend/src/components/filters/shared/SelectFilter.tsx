import React from 'react';

/**
 * Props for the SelectFilter component
 */
interface SelectFilterProps {
  readonly label: string;
  readonly value: string | undefined;
  readonly onChange: (value: string | undefined) => void;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/**
 * Pure select filter component for reusable dropdown filtering
 * 
 * This component provides a consistent interface for select-based filters
 * with proper accessibility and TypeScript safety.
 * 
 * @pure Component renders consistently for same props
 * @param props - Select filter configuration
 * @returns JSX element for select dropdown
 * 
 * @example
 * <SelectFilter
 *   label="Camera"
 *   value={selectedCamera}
 *   onChange={handleCameraChange}
 *   options={[
 *     { value: 'camera-1', label: 'Camera 1' },
 *     { value: 'camera-2', label: 'Camera 2' }
 *   ]}
 *   placeholder="All Cameras"
 * />
 */
export default function SelectFilter({
  label,
  value,
  onChange,
  options,
  placeholder = 'All',
  disabled = false,
  className = '',
  'data-testid': testId,
}: SelectFilterProps) {
  /**
   * Handles select change events and converts to proper value types
   * 
   * @pure Function converts DOM events to clean values
   */
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    onChange(newValue === '' ? undefined : newValue);
  };

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <select
        value={value || ''}
        onChange={handleChange}
        disabled={disabled}
        data-testid={testId}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        aria-label={label}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Creates option objects from simple arrays for use with SelectFilter
 * 
 * @pure Function transforms array to options format
 * @param items - Array of items with value and name properties
 * @param valueKey - Property name to use as option value
 * @param labelKey - Property name to use as option label
 * @returns Array of option objects
 * 
 * @example
 * const cameraOptions = createOptionsFromItems(cameras, 'name', 'name');
 * const orgOptions = createOptionsFromItems(organizations, 'name', 'name');
 */
export const createOptionsFromItems = <T extends Record<string, any>>(
  items: readonly T[],
  valueKey: keyof T,
  labelKey: keyof T
): readonly { readonly value: string; readonly label: string }[] => {
  return items.map(item => ({
    value: String(item[valueKey]),
    label: String(item[labelKey])
  }));
};

/**
 * Creates boolean option objects for yes/no/all selections
 * 
 * @pure Function creates consistent boolean options
 * @param labels - Custom labels for true/false/all options
 * @returns Array of boolean option objects
 * 
 * @example
 * const wildfireOptions = createBooleanOptions({
 *   allLabel: 'All',
 *   trueLabel: 'Wildfire Alert', 
 *   falseLabel: 'No Alert'
 * });
 */
export const createBooleanOptions = (labels: {
  readonly allLabel?: string;
  readonly trueLabel?: string;
  readonly falseLabel?: string;
} = {}) => {
  const {
    allLabel = 'All',
    trueLabel = 'Yes',
    falseLabel = 'No'
  } = labels;

  return [
    { value: '', label: allLabel },
    { value: 'true', label: trueLabel },
    { value: 'false', label: falseLabel }
  ] as const;
};

/**
 * Converts string values back to boolean or undefined for API calls
 * 
 * @pure Function converts select values to proper types
 * @param value - String value from select element
 * @returns Boolean, undefined, or null based on input
 * 
 * @example
 * const booleanValue = parseBooleanValue(selectValue);
 * onFiltersChange({ is_wildfire_alertapi: booleanValue });
 */
export const parseBooleanValue = (value: string): boolean | undefined => {
  if (value === '') return undefined;
  return value === 'true';
};