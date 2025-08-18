import { ExtendedSequenceFilters } from '@/types/api';
import { ModelAccuracyType } from '@/utils/modelAccuracy';

/**
 * Filter categories for tabbed filtering
 */
export type FilterCategory = 'simple' | 'advanced';

/**
 * Configuration for filter counting and validation
 */
interface FilterConfig {
  readonly includeSharedFilters: boolean;
  readonly includeAdvancedFilters: boolean;
  readonly showModelAccuracy: boolean;
  readonly showFalsePositiveTypes: boolean;
}

/**
 * Extended filter state including UI-specific values
 */
export interface ExtendedFilterState {
  readonly filters: ExtendedSequenceFilters;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly selectedFalsePositiveTypes: readonly string[];
  readonly selectedModelAccuracy: ModelAccuracyType | 'all';
}

/**
 * Filter state transition for tab switching
 */
export interface FilterStateTransition {
  readonly newFilters: ExtendedSequenceFilters;
  readonly resetValues?: {
    readonly dateFrom?: string;
    readonly dateTo?: string;
    readonly selectedFalsePositiveTypes?: readonly string[];
  };
}

/**
 * Counts active filters for a specific category (simple/advanced)
 * 
 * @pure Function calculates filter counts without side effects
 * @param state - Current filter state
 * @param category - Filter category to count
 * @param config - Configuration options
 * @returns Number of active filters
 * 
 * @example
 * const simpleCount = countActiveFilters(filterState, 'simple', {
 *   includeSharedFilters: true,
 *   includeAdvancedFilters: false,
 *   showModelAccuracy: true,
 *   showFalsePositiveTypes: false
 * });
 */
export const countActiveFilters = (
  state: ExtendedFilterState,
  category: FilterCategory,
  config: FilterConfig
): number => {
  let count = 0;
  
  // Shared filters (available in both simple and advanced)
  if (config.includeSharedFilters) {
    if (state.filters.camera_name) count++;
    if (state.filters.organisation_name) count++;
    if (config.showModelAccuracy && 
        state.selectedModelAccuracy && 
        state.selectedModelAccuracy !== 'all') {
      count++;
    }
  }
  
  // Advanced-only filters
  if (category === 'advanced' && config.includeAdvancedFilters) {
    if (state.filters.source_api) count++;
    if (state.filters.is_wildfire_alertapi !== undefined) count++;
    if (state.dateFrom || state.dateTo) count++;
    if (config.showFalsePositiveTypes && state.selectedFalsePositiveTypes.length > 0) {
      count++;
    }
  }
  
  return count;
};

/**
 * Calculates filter state transition when switching tabs
 * 
 * @pure Function determines state changes for tab switching
 * @param currentState - Current filter state
 * @param targetCategory - Target filter category
 * @returns State transition object
 * 
 * @example
 * const transition = calculateTabTransition(currentState, 'simple');
 * onFiltersChange(transition.newFilters);
 * if (transition.resetValues) {
 *   onDateFromChange(transition.resetValues.dateFrom || '');
 *   onDateToChange(transition.resetValues.dateTo || '');
 * }
 */
export const calculateTabTransition = (
  currentState: ExtendedFilterState,
  targetCategory: FilterCategory
): FilterStateTransition => {
  // Preserve shared filter values
  const sharedFilters = {
    camera_name: currentState.filters.camera_name,
    organisation_name: currentState.filters.organisation_name,
  };
  
  if (targetCategory === 'simple') {
    // Reset advanced-only filters when switching to simple
    return {
      newFilters: {
        ...sharedFilters,
        source_api: undefined,
        is_wildfire_alertapi: undefined,
        recorded_at_gte: undefined,
        recorded_at_lte: undefined,
      },
      resetValues: {
        dateFrom: '',
        dateTo: '',
        selectedFalsePositiveTypes: [],
      }
    };
  } else {
    // When switching to advanced, keep all current values
    return {
      newFilters: currentState.filters
    };
  }
};

/**
 * Validates filter values and returns validation results
 * 
 * @pure Function validates filter state
 * @param state - Filter state to validate
 * @returns Validation result with errors
 * 
 * @example
 * const validation = validateFilterState(filterState);
 * if (!validation.isValid) {
 *   console.warn('Filter validation errors:', validation.errors);
 * }
 */
export const validateFilterState = (
  state: ExtendedFilterState
): { readonly isValid: boolean; readonly errors: readonly string[] } => {
  const errors: string[] = [];
  
  // Validate date range
  if (state.dateFrom && state.dateTo) {
    const fromDate = new Date(state.dateFrom);
    const toDate = new Date(state.dateTo);
    
    if (fromDate > toDate) {
      errors.push('Start date must be before or equal to end date');
    }
    
    // Check for reasonable date range (not more than 5 years)
    const maxDays = 5 * 365;
    const daysDiff = Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > maxDays) {
      errors.push('Date range cannot exceed 5 years');
    }
  }
  
  // Validate false positive types
  if (state.selectedFalsePositiveTypes.length > 10) {
    errors.push('Too many false positive types selected (maximum 10)');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Merges filter state with new partial values
 * 
 * @pure Function creates new state with merged values
 * @param currentState - Current filter state
 * @param updates - Partial updates to apply
 * @returns New filter state with updates applied
 * 
 * @example
 * const newState = mergeFilterState(currentState, {
 *   filters: { camera_name: 'New Camera' },
 *   dateFrom: '2024-01-01'
 * });
 */
export const mergeFilterState = (
  currentState: ExtendedFilterState,
  updates: Partial<ExtendedFilterState>
): ExtendedFilterState => {
  return {
    ...currentState,
    ...updates,
    filters: {
      ...currentState.filters,
      ...updates.filters
    }
  };
};

/**
 * Creates initial filter state with default values
 * 
 * @pure Function creates consistent initial state
 * @param overrides - Optional overrides for default values
 * @returns Initial filter state
 * 
 * @example
 * const initialState = createInitialFilterState({
 *   selectedModelAccuracy: 'high'
 * });
 */
export const createInitialFilterState = (
  overrides: Partial<ExtendedFilterState> = {}
): ExtendedFilterState => {
  return {
    filters: {},
    dateFrom: '',
    dateTo: '',
    selectedFalsePositiveTypes: [],
    selectedModelAccuracy: 'all',
    ...overrides,
    filters: {
      ...overrides.filters
    }
  };
};

/**
 * Serializes filter state to URL search parameters
 * 
 * @pure Function converts filter state to URL parameters
 * @param state - Filter state to serialize
 * @returns URLSearchParams object
 * 
 * @example
 * const searchParams = serializeFilterState(filterState);
 * const url = `${baseUrl}?${searchParams.toString()}`;
 */
export const serializeFilterState = (state: ExtendedFilterState): URLSearchParams => {
  const params = new URLSearchParams();
  
  // Add basic filters
  if (state.filters.camera_name) params.set('camera', state.filters.camera_name);
  if (state.filters.organisation_name) params.set('org', state.filters.organisation_name);
  if (state.filters.source_api) params.set('source', state.filters.source_api);
  if (state.filters.is_wildfire_alertapi !== undefined) {
    params.set('wildfire', state.filters.is_wildfire_alertapi.toString());
  }
  
  // Add date range
  if (state.dateFrom) params.set('from', state.dateFrom);
  if (state.dateTo) params.set('to', state.dateTo);
  
  // Add model accuracy
  if (state.selectedModelAccuracy !== 'all') {
    params.set('accuracy', state.selectedModelAccuracy);
  }
  
  // Add false positive types
  if (state.selectedFalsePositiveTypes.length > 0) {
    params.set('fp_types', state.selectedFalsePositiveTypes.join(','));
  }
  
  return params;
};

/**
 * Deserializes URL search parameters to filter state
 * 
 * @pure Function parses URL parameters to filter state
 * @param searchParams - URLSearchParams to parse
 * @returns Filter state parsed from parameters
 * 
 * @example
 * const filterState = deserializeFilterState(new URLSearchParams(location.search));
 */
export const deserializeFilterState = (searchParams: URLSearchParams): ExtendedFilterState => {
  const filters: ExtendedSequenceFilters = {};
  
  // Parse basic filters
  const camera = searchParams.get('camera');
  if (camera) filters.camera_name = camera;
  
  const org = searchParams.get('org');
  if (org) filters.organisation_name = org;
  
  const source = searchParams.get('source');
  if (source) filters.source_api = source as any;
  
  const wildfire = searchParams.get('wildfire');
  if (wildfire) filters.is_wildfire_alertapi = wildfire === 'true';
  
  // Parse dates
  const dateFrom = searchParams.get('from') || '';
  const dateTo = searchParams.get('to') || '';
  
  // Parse model accuracy
  const accuracy = searchParams.get('accuracy') || 'all';
  const selectedModelAccuracy = (accuracy as ModelAccuracyType | 'all');
  
  // Parse false positive types
  const fpTypesStr = searchParams.get('fp_types');
  const selectedFalsePositiveTypes = fpTypesStr ? fpTypesStr.split(',') : [];
  
  return {
    filters,
    dateFrom,
    dateTo,
    selectedFalsePositiveTypes,
    selectedModelAccuracy
  };
};