/**
 * Utility functions for select filter components.
 * Extracted from SelectFilter to maintain React fast refresh compatibility.
 */

/**
 * Creates option objects from array items for select components
 *
 * @pure Function creates consistent option objects
 * @param items - Array of items with value and name properties
 * @param valueKey - Property name to use as option value
 * @param labelKey - Property name to use as option label
 * @returns Array of option objects
 *
 * @example
 * const cameraOptions = createOptionsFromItems(cameras, 'name', 'name');
 * const orgOptions = createOptionsFromItems(organizations, 'name', 'name');
 */
export const createOptionsFromItems = <T extends Record<string, unknown>>(
  items: readonly T[],
  valueKey: keyof T,
  labelKey: keyof T
): readonly { readonly value: string; readonly label: string }[] => {
  return items.map(item => ({
    value: String(item[valueKey]),
    label: String(item[labelKey]),
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
export const createBooleanOptions = (
  labels: {
    readonly allLabel?: string;
    readonly trueLabel?: string;
    readonly falseLabel?: string;
  } = {}
) => {
  const { allLabel = 'All', trueLabel = 'Yes', falseLabel = 'No' } = labels;

  return [
    { value: '', label: allLabel },
    { value: 'true', label: trueLabel },
    { value: 'false', label: falseLabel },
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