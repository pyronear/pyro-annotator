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
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select
        value={value || ''}
        onChange={handleChange}
        disabled={disabled}
        data-testid={testId}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        aria-label={label}
      >
        <option value="">{placeholder}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

