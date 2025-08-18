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
      processing_stage: defaultProcessingStage as any,
    },
    dateFrom: '',
    dateTo: '',
    selectedFalsePositiveTypes: [],
    selectedModelAccuracy: 'all',
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
        // Merge with defaults to handle missing properties in stored data
        return {
          ...defaultState,
          ...parsed,
          filters: {
            ...defaultState.filters,
            ...parsed.filters,
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
    updateState({ ...state, filters });
  };

  const setDateFrom = (dateFrom: string) => {
    updateState({ ...state, dateFrom });
  };

  const setDateTo = (dateTo: string) => {
    updateState({ ...state, dateTo });
  };

  const setSelectedFalsePositiveTypes = (selectedFalsePositiveTypes: string[]) => {
    updateState({ ...state, selectedFalsePositiveTypes });
  };

  const setSelectedModelAccuracy = (selectedModelAccuracy: ModelAccuracyType | 'all') => {
    updateState({ ...state, selectedModelAccuracy });
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
    
    // Setters
    setFilters,
    setDateFrom,
    setDateTo,
    setSelectedFalsePositiveTypes,
    setSelectedModelAccuracy,
  };
}