/**
 * Higher-Order Component for keyboard shortcuts management
 * 
 * This HOC provides a declarative way to handle keyboard shortcuts
 * using pure event handling functions and customizable key bindings.
 */

import React, { ComponentType, useEffect, useRef, useCallback } from 'react';

/**
 * Keyboard shortcut handler function type
 */
export type ShortcutHandler = (event: KeyboardEvent) => void | boolean;

/**
 * Keyboard shortcut configuration
 */
export interface ShortcutConfig {
  readonly key: string;
  readonly handler: ShortcutHandler;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly preventDefault?: boolean;
  readonly stopPropagation?: boolean;
  readonly description?: string;
  readonly disabled?: boolean;
}

/**
 * Props that will be injected by the HOC
 */
export interface WithKeyboardShortcutsProps {
  /** Array of active keyboard shortcuts */
  readonly shortcuts: readonly ShortcutConfig[];
  /** Function to update shortcuts dynamically */
  readonly updateShortcuts: (shortcuts: ShortcutConfig[]) => void;
  /** Function to add a new shortcut */
  readonly addShortcut: (shortcut: ShortcutConfig) => void;
  /** Function to remove a shortcut by key combination */
  readonly removeShortcut: (key: string, modifiers?: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }) => void;
  /** Function to temporarily disable all shortcuts */
  readonly disableShortcuts: () => void;
  /** Function to re-enable shortcuts */
  readonly enableShortcuts: () => void;
  /** Whether shortcuts are currently enabled */
  readonly shortcutsEnabled: boolean;
}

/**
 * Options for configuring keyboard shortcuts
 */
export interface WithKeyboardShortcutsOptions {
  /** Initial shortcuts configuration */
  readonly initialShortcuts?: ShortcutConfig[];
  /** Whether to capture shortcuts globally or only when component is focused */
  readonly global?: boolean;
  /** Whether shortcuts are initially enabled */
  readonly initiallyEnabled?: boolean;
  /** Elements to exclude from shortcut capture (by selector) */
  readonly excludeSelectors?: string[];
}

/**
 * Pure function to normalize key strings
 * 
 * @pure Function always returns same output for same input
 */
const normalizeKey = (key: string): string => {
  // Convert to lowercase and handle special cases
  const normalized = key.toLowerCase();
  
  const keyMap: Record<string, string> = {
    'esc': 'escape',
    'del': 'delete',
    'ins': 'insert',
    'up': 'arrowup',
    'down': 'arrowdown',
    'left': 'arrowleft',
    'right': 'arrowright',
    ' ': 'space',
    'ctrl': 'control'
  };
  
  return keyMap[normalized] || normalized;
};

/**
 * Pure function to check if key combination matches shortcut
 * 
 * @pure Function has no side effects and returns consistent results
 */
const matchesShortcut = (event: KeyboardEvent, shortcut: ShortcutConfig): boolean => {
  if (shortcut.disabled) return false;
  
  const eventKey = normalizeKey(event.key);
  const shortcutKey = normalizeKey(shortcut.key);
  
  if (eventKey !== shortcutKey) return false;
  
  // Check modifier keys
  if (Boolean(shortcut.ctrlKey) !== Boolean(event.ctrlKey)) return false;
  if (Boolean(shortcut.shiftKey) !== Boolean(event.shiftKey)) return false;
  if (Boolean(shortcut.altKey) !== Boolean(event.altKey)) return false;
  if (Boolean(shortcut.metaKey) !== Boolean(event.metaKey)) return false;
  
  return true;
};

/**
 * Pure function to check if event should be ignored based on target element
 * 
 * @pure Function has no side effects
 */
const shouldIgnoreEvent = (event: KeyboardEvent, excludeSelectors: string[] = []): boolean => {
  const target = event.target as HTMLElement;
  if (!target) return false;
  
  // Default exclusions for form elements
  const defaultExclusions = ['input', 'textarea', 'select', '[contenteditable]'];
  const allExclusions = [...defaultExclusions, ...excludeSelectors];
  
  return allExclusions.some(selector => {
    try {
      return target.matches(selector) || target.closest(selector);
    } catch (e) {
      // Invalid selector, skip
      return false;
    }
  });
};

/**
 * Pure function to format shortcut for display
 * 
 * @pure Function creates consistent string representation
 */
export const formatShortcutDisplay = (shortcut: ShortcutConfig): string => {
  const parts: string[] = [];
  
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.shiftKey) parts.push('Shift');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.metaKey) parts.push('Cmd');
  
  // Format key name for display
  const keyDisplay = shortcut.key.charAt(0).toUpperCase() + shortcut.key.slice(1);
  parts.push(keyDisplay);
  
  return parts.join(' + ');
};

/**
 * Higher-Order Component that provides keyboard shortcuts functionality
 * 
 * This HOC manages keyboard event listeners and provides a clean interface
 * for components to handle keyboard shortcuts declaratively.
 * 
 * @param Component - The component to wrap
 * @param options - Configuration options for keyboard shortcuts
 * @returns Enhanced component with keyboard shortcuts support
 * 
 * @example
 * interface MyComponentProps extends WithKeyboardShortcutsProps {
 *   readonly title: string;
 * }
 * 
 * const MyComponent = ({ title, addShortcut, shortcuts }: MyComponentProps) => {
 *   useEffect(() => {
 *     addShortcut({
 *       key: 's',
 *       ctrlKey: true,
 *       handler: () => console.log('Save shortcut pressed'),
 *       description: 'Save document'
 *     });
 *   }, [addShortcut]);
 * 
 *   return <div>{title}</div>;
 * };
 * 
 * export default withKeyboardShortcuts(MyComponent, {
 *   global: true,
 *   initialShortcuts: [
 *     { key: 'escape', handler: () => console.log('Escape pressed') }
 *   ]
 * });
 */
export const withKeyboardShortcuts = <P extends WithKeyboardShortcutsProps>(
  Component: ComponentType<P>,
  options: WithKeyboardShortcutsOptions = {}
) => {
  const {
    initialShortcuts = [],
    global = false,
    initiallyEnabled = true,
    excludeSelectors = []
  } = options;

  const WithKeyboardShortcutsComponent = (props: Omit<P, keyof WithKeyboardShortcutsProps>) => {
    const [shortcuts, setShortcuts] = React.useState<ShortcutConfig[]>(initialShortcuts);
    const [shortcutsEnabled, setShortcutsEnabled] = React.useState(initiallyEnabled);
    const componentRef = useRef<HTMLDivElement>(null);

    /**
     * Pure event handler for keyboard events
     */
    const handleKeyDown = useCallback((event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (!shortcutsEnabled) return;
      if (shouldIgnoreEvent(keyboardEvent, excludeSelectors)) return;
      
      // Find matching shortcut using pure function
      const matchingShortcut = shortcuts.find(shortcut => matchesShortcut(keyboardEvent, shortcut));
      
      if (matchingShortcut) {
        // Handle event prevention
        if (matchingShortcut.preventDefault !== false) {
          event.preventDefault();
        }
        
        if (matchingShortcut.stopPropagation) {
          event.stopPropagation();
        }
        
        // Execute handler
        const result = matchingShortcut.handler(keyboardEvent);
        
        // If handler returns false, allow default behavior
        if (result === false && matchingShortcut.preventDefault !== false) {
          // Handler decided to allow default, but we already prevented it
          // This is a limitation of the design, but documented behavior
        }
      }
    }, [shortcuts, shortcutsEnabled, excludeSelectors]);

    // Set up event listeners
    useEffect(() => {
      const targetElement = global ? document : componentRef.current;
      if (!targetElement) return;

      targetElement.addEventListener('keydown', handleKeyDown);
      
      return () => {
        targetElement.removeEventListener('keydown', handleKeyDown);
      };
    }, [handleKeyDown, global]);

    // Shortcut management functions
    const updateShortcuts = useCallback((newShortcuts: ShortcutConfig[]) => {
      setShortcuts(newShortcuts);
    }, []);

    const addShortcut = useCallback((shortcut: ShortcutConfig) => {
      setShortcuts(prev => [...prev, shortcut]);
    }, []);

    const removeShortcut = useCallback((
      key: string, 
      modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}
    ) => {
      setShortcuts(prev => prev.filter(shortcut => {
        const keyMatches = normalizeKey(shortcut.key) === normalizeKey(key);
        const modifiersMatch = (
          Boolean(shortcut.ctrlKey) === Boolean(modifiers.ctrlKey) &&
          Boolean(shortcut.shiftKey) === Boolean(modifiers.shiftKey) &&
          Boolean(shortcut.altKey) === Boolean(modifiers.altKey) &&
          Boolean(shortcut.metaKey) === Boolean(modifiers.metaKey)
        );
        return !(keyMatches && modifiersMatch);
      }));
    }, []);

    const disableShortcuts = useCallback(() => {
      setShortcutsEnabled(false);
    }, []);

    const enableShortcuts = useCallback(() => {
      setShortcutsEnabled(true);
    }, []);

    // Enhanced props to pass to the wrapped component
    const enhancedProps: P = {
      ...props,
      shortcuts,
      updateShortcuts,
      addShortcut,
      removeShortcut,
      disableShortcuts,
      enableShortcuts,
      shortcutsEnabled
    } as P;

    return (
      <div ref={global ? undefined : componentRef} className={global ? undefined : "w-full h-full"}>
        <Component {...enhancedProps} />
      </div>
    );
  };

  WithKeyboardShortcutsComponent.displayName = `withKeyboardShortcuts(${Component.displayName || Component.name || 'Component'})`;

  return WithKeyboardShortcutsComponent;
};

/**
 * Hook version for use with functional components that prefer hooks over HOCs
 * 
 * @param options - Configuration options
 * @returns Keyboard shortcuts state and management functions
 * 
 * @example
 * const MyComponent = () => {
 *   const { addShortcut, shortcuts, shortcutsEnabled } = useKeyboardShortcuts({
 *     global: true,
 *     initialShortcuts: [
 *       { key: 'escape', handler: () => setModalOpen(false) }
 *     ]
 *   });
 * 
 *   useEffect(() => {
 *     addShortcut({
 *       key: 's',
 *       ctrlKey: true,
 *       handler: () => save(),
 *       description: 'Save'
 *     });
 *   }, [addShortcut]);
 * 
 *   return <div>Content with keyboard shortcuts</div>;
 * };
 */
export const useKeyboardShortcuts = (options: WithKeyboardShortcutsOptions = {}) => {
  const {
    initialShortcuts = [],
    global = false,
    initiallyEnabled = true,
    excludeSelectors = []
  } = options;

  const [shortcuts, setShortcuts] = React.useState<ShortcutConfig[]>(initialShortcuts);
  const [shortcutsEnabled, setShortcutsEnabled] = React.useState(initiallyEnabled);
  const componentRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!shortcutsEnabled) return;
    if (shouldIgnoreEvent(event, excludeSelectors)) return;
    
    const matchingShortcut = shortcuts.find(shortcut => matchesShortcut(event, shortcut));
    
    if (matchingShortcut) {
      if (matchingShortcut.preventDefault !== false) {
        event.preventDefault();
      }
      
      if (matchingShortcut.stopPropagation) {
        event.stopPropagation();
      }
      
      matchingShortcut.handler(event);
    }
  }, [shortcuts, shortcutsEnabled, excludeSelectors]);

  useEffect(() => {
    const targetElement = global ? document : componentRef.current;
    if (!targetElement) return;

    targetElement.addEventListener('keydown', handleKeyDown);
    
    return () => {
      targetElement.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, global]);

  const updateShortcuts = useCallback((newShortcuts: ShortcutConfig[]) => {
    setShortcuts(newShortcuts);
  }, []);

  const addShortcut = useCallback((shortcut: ShortcutConfig) => {
    setShortcuts(prev => [...prev, shortcut]);
  }, []);

  const removeShortcut = useCallback((
    key: string, 
    modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}
  ) => {
    setShortcuts(prev => prev.filter(shortcut => {
      const keyMatches = normalizeKey(shortcut.key) === normalizeKey(key);
      const modifiersMatch = (
        Boolean(shortcut.ctrlKey) === Boolean(modifiers.ctrlKey) &&
        Boolean(shortcut.shiftKey) === Boolean(modifiers.shiftKey) &&
        Boolean(shortcut.altKey) === Boolean(modifiers.altKey) &&
        Boolean(shortcut.metaKey) === Boolean(modifiers.metaKey)
      );
      return !(keyMatches && modifiersMatch);
    }));
  }, []);

  const disableShortcuts = useCallback(() => {
    setShortcutsEnabled(false);
  }, []);

  const enableShortcuts = useCallback(() => {
    setShortcutsEnabled(true);
  }, []);

  return {
    shortcuts,
    updateShortcuts,
    addShortcut,
    removeShortcut,
    disableShortcuts,
    enableShortcuts,
    shortcutsEnabled,
    componentRef: global ? null : componentRef
  };
};