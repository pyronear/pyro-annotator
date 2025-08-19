import { useState, useEffect } from 'react';

/**
 * Custom hook for persisting tab state in localStorage
 * @param key - localStorage key for storing the tab state
 * @param defaultValue - default tab value if none exists in localStorage
 * @returns [activeTab, setActiveTab] tuple similar to useState
 */
export function usePersistedTabState<T extends string>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  // Initialize state with value from localStorage or default
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') {
      // SSR safety - return default if window is not available
      return defaultValue;
    }
    
    try {
      const stored = localStorage.getItem(key);
      return stored ? (stored as T) : defaultValue;
    } catch (error) {
      // Handle localStorage errors (e.g., private browsing, storage quota)
      console.warn(`Failed to read from localStorage key "${key}":`, error);
      return defaultValue;
    }
  });

  // Update localStorage whenever state changes
  const setPersistedState = (value: T) => {
    setState(value);
    
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        // Handle localStorage errors gracefully
        console.warn(`Failed to write to localStorage key "${key}":`, error);
      }
    }
  };

  // Sync with localStorage changes from other tabs/windows
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        setState(e.newValue as T);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [state, setPersistedState];
}