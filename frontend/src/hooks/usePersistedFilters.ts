import { useState, useEffect } from 'react';
import { ExtendedSequenceFilters } from '@/types/api';
import { ModelAccuracyType } from '@/utils/modelAccuracy';
import { PAGINATION_DEFAULTS } from '@/utils/constants';

/**
 * Complete filter state that should be persisted across page navigation
 */
export interface PersistedFilterState {
  filters: ExtendedSequenceFilters;
  dateFrom: string;
  dateTo: string;
  selectedFalsePositiveTypes: string[];
  selectedModelAccuracy: ModelAccuracyType | 'all';
  selectedUnsure: 'all' | 'unsure' | 'not-unsure';
}

/**
 * Default filter state factory
 */
export function createDefaultFilterState(
  defaultProcessingStage?: string
): PersistedFilterState {
  return {
    filters: {
      page: PAGINATION_DEFAULTS.PAGE,
      size: PAGINATION_DEFAULTS.SIZE,
      // Note: processing_stage is a system filter, not a user-visible filter
      // It's used to determine which sequences to show based on the page context
      processing_stage: defaultProcessingStage as any,
    },
    dateFrom: '',
    dateTo: '',
    selectedFalsePositiveTypes: [],
    selectedModelAccuracy: 'all',
    selectedUnsure: 'all',
  };
}

/**
 * Custom hook for persisting complete filter state in localStorage
 * @param storageKey - unique localStorage key for this page/route
 * @param defaultState - default filter state if none exists in localStorage
 * @returns [filterState, updateFunctions] object with state and individual setters
 */
export function usePersistedFilters(
  storageKey: string,
  defaultState: PersistedFilterState
) {
  // Initialize state with value from localStorage or default
  const [state, setState] = useState<PersistedFilterState>(() => {
    if (typeof window === 'undefined') {
      // SSR safety - return default if window is not available
      return defaultState;
    }
    
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as PersistedFilterState;
        
        // Clean up filters - only keep user-visible filter values, not empty strings
        const cleanedFilters = { ...parsed.filters };
        
        // Remove empty string values that should be undefined
        if (cleanedFilters.camera_name === '') delete cleanedFilters.camera_name;
        if (cleanedFilters.organisation_name === '') delete cleanedFilters.organisation_name;
        // source_api is an enum type, so we check differently
        if (!cleanedFilters.source_api) delete cleanedFilters.source_api;
        
        // Merge with defaults to handle missing properties in stored data
        // Always preserve the processing_stage from defaultState as it's a system filter
        return {
          ...defaultState,
          ...parsed,
          filters: {
            ...defaultState.filters,
            ...cleanedFilters,
            // Always use the processing_stage from defaultState, not from localStorage
            processing_stage: defaultState.filters.processing_stage,
          },
        };
      }
      return defaultState;
    } catch (error) {
      // Handle localStorage errors (e.g., private browsing, storage quota, invalid JSON)
      console.warn(`Failed to read from localStorage key "${storageKey}":`, error);
      return defaultState;
    }
  });

  // Update localStorage whenever state changes
  const updateState = (newState: PersistedFilterState) => {
    setState(newState);
    
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(storageKey, JSON.stringify(newState));
      } catch (error) {
        // Handle localStorage errors gracefully
        console.warn(`Failed to write to localStorage key "${storageKey}":`, error);
      }
    }
  };

  // Individual setter functions for each piece of state
  const setFilters = (filters: ExtendedSequenceFilters) => {
    // Use functional update to get the latest state
    setState((currentState) => {
      const newState = { ...currentState, filters };
      
      // Update localStorage
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(storageKey, JSON.stringify(newState));
        } catch (error) {
          console.warn(`Failed to write to localStorage key "${storageKey}":`, error);
        }
      }
      
      return newState;
    });
  };

  const setDateFrom = (dateFrom: string) => {
    // Use functional update to get the latest state
    setState((currentState) => {
      const newState = { ...currentState, dateFrom };
      
      // Update localStorage
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(storageKey, JSON.stringify(newState));
        } catch (error) {
          console.warn(`Failed to write to localStorage key "${storageKey}":`, error);
        }
      }
      
      return newState;
    });
  };

  const setDateTo = (dateTo: string) => {
    // Use functional update to get the latest state
    setState((currentState) => {
      const newState = { ...currentState, dateTo };
      
      // Update localStorage
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(storageKey, JSON.stringify(newState));
        } catch (error) {
          console.warn(`Failed to write to localStorage key "${storageKey}":`, error);
        }
      }
      
      return newState;
    });
  };

  const setSelectedFalsePositiveTypes = (selectedFalsePositiveTypes: string[]) => {
    // ATOMIC UPDATE: Update both selectedFalsePositiveTypes AND filters together
    const newFilters = {
      ...state.filters,
      false_positive_types: selectedFalsePositiveTypes.length > 0 ? selectedFalsePositiveTypes : undefined,
      page: 1
    };
    
    const newState = { 
      ...state, 
      selectedFalsePositiveTypes,
      filters: newFilters
    };
    
    updateState(newState);
  };

  const setSelectedModelAccuracy = (selectedModelAccuracy: ModelAccuracyType | 'all') => {
    updateState({ ...state, selectedModelAccuracy });
  };

  const setSelectedUnsure = (selectedUnsure: 'all' | 'unsure' | 'not-unsure') => {
    // ATOMIC UPDATE: Update both selectedUnsure AND filters together
    const newFilters = {
      ...state.filters,
      is_unsure: selectedUnsure === 'all' ? undefined : selectedUnsure === 'unsure',
      page: 1
    };
    
    const newState = { 
      ...state, 
      selectedUnsure,
      filters: newFilters
    };
    
    updateState(newState);
  };

  // Atomic update for false positive types + filters to avoid race conditions
  const setSelectedFalsePositiveTypesAndFilters = (
    selectedFalsePositiveTypes: string[], 
    additionalFilters: Partial<ExtendedSequenceFilters> = {}
  ) => {
    const newFilters = {
      ...state.filters,
      false_positive_types: selectedFalsePositiveTypes.length > 0 ? selectedFalsePositiveTypes : undefined,
      page: 1,
      ...additionalFilters
    };
    
    updateState({ 
      ...state, 
      selectedFalsePositiveTypes,
      filters: newFilters
    });
  };

  // Reset all filters to default state
  const resetFilters = () => {
    updateState(defaultState);
  };

  // Sync with localStorage changes from other tabs/windows
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as PersistedFilterState;
          setState(parsed);
        } catch (error) {
          console.warn(`Failed to parse localStorage change for key "${storageKey}":`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [storageKey]);

  return {
    // State values
    filters: state.filters,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    selectedFalsePositiveTypes: state.selectedFalsePositiveTypes,
    selectedModelAccuracy: state.selectedModelAccuracy,
    selectedUnsure: state.selectedUnsure,
    
    // Setters
    setFilters,
    setDateFrom,
    setDateTo,
    setSelectedFalsePositiveTypes,
    setSelectedFalsePositiveTypesAndFilters,
    setSelectedModelAccuracy,
    setSelectedUnsure,
    resetFilters,
  };
}