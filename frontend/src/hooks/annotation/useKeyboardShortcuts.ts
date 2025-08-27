/**
 * Pure keyboard shortcuts hook for annotation interface.
 * Uses pure event handlers with no internal state - all state passed as parameters.
 */

import { useCallback, useEffect } from 'react';
import { SmokeType } from '@/types/api';

/**
 * Keyboard shortcut handlers configuration.
 */
export interface KeyboardShortcutHandlers {
  /** Toggle drawing mode (D key) */
  onToggleDrawMode: () => void;
  /** Toggle predictions visibility (P key) */
  onTogglePredictions: () => void;
  /** Delete selected rectangle or all rectangles (Delete key) */
  onDeleteRectangle: () => void;
  /** Undo last action (Ctrl+Z) */
  onUndo: () => void;
  /** Submit annotation (Enter/Space) */
  onSubmit: () => void;
  /** Import AI predictions (A key) */
  onImportPredictions: () => void;
  /** Show keyboard shortcuts help (? key) */
  onShowHelp: () => void;
  /** Select smoke type - wildfire (1 key) */
  onSelectWildfire: () => void;
  /** Select smoke type - industrial (2 key) */
  onSelectIndustrial: () => void;
  /** Select smoke type - other (3 key) */
  onSelectOther: () => void;
  /** Zoom in (+ key) */
  onZoomIn?: () => void;
  /** Zoom out (- key) */
  onZoomOut?: () => void;
  /** Reset zoom (0 key) */
  onResetZoom?: () => void;
}

/**
 * Current state needed for keyboard shortcut logic.
 */
export interface KeyboardShortcutState {
  /** Whether drawing mode is active */
  isDrawMode: boolean;
  /** Whether actively drawing a rectangle */
  isActivelyDrawing: boolean;
  /** Whether a rectangle is selected */
  hasSelectedRectangle: boolean;
  /** Whether there are any rectangles */
  hasRectangles: boolean;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether predictions are visible */
  showPredictions: boolean;
  /** Whether submission is in progress */
  isSubmitting: boolean;
  /** Whether keyboard shortcuts modal is open */
  showKeyboardShortcuts: boolean;
}

/**
 * Configuration for keyboard shortcuts behavior.
 */
export interface KeyboardShortcutConfig {
  /** Whether to enable shortcuts (default: true) */
  enabled: boolean;
  /** Whether to prevent default for handled keys (default: true) */
  preventDefault: boolean;
  /** Whether to stop event propagation (default: true) */
  stopPropagation: boolean;
}

const defaultConfig: KeyboardShortcutConfig = {
  enabled: true,
  preventDefault: true,
  stopPropagation: true,
};

/**
 * Pure keyboard shortcuts hook with no internal state.
 * All behavior is determined by passed state and handlers.
 *
 * @param handlers - Callback functions for different shortcuts
 * @param state - Current application state
 * @param config - Configuration options
 *
 * @example
 * ```typescript
 * useKeyboardShortcuts({
 *   onToggleDrawMode: () => setDrawMode(!drawMode),
 *   onSubmit: () => submitAnnotation(),
 *   onUndo: () => undoLastAction(),
 *   // ... other handlers
 * }, {
 *   isDrawMode: drawMode,
 *   hasSelectedRectangle: selectedId !== null,
 *   canUndo: undoStack.length > 0,
 *   // ... other state
 * });
 * ```
 */
export const useKeyboardShortcuts = (
  handlers: KeyboardShortcutHandlers,
  state: KeyboardShortcutState,
  config: Partial<KeyboardShortcutConfig> = {}
): void => {
  const finalConfig = { ...defaultConfig, ...config };

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!finalConfig.enabled) return;

      // Don't handle shortcuts if keyboard shortcuts modal is open
      if (state.showKeyboardShortcuts) {
        // Only handle Escape to close modal
        if (event.key === 'Escape') {
          handlers.onShowHelp();
          if (finalConfig.preventDefault) event.preventDefault();
          if (finalConfig.stopPropagation) event.stopPropagation();
        }
        return;
      }

      // Don't handle shortcuts if user is typing in an input/textarea
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true'
      ) {
        return;
      }

      const { key, ctrlKey, metaKey, shiftKey } = event;
      let handled = false;

      // Drawing mode shortcuts
      if (key === 'd' || key === 'D') {
        handlers.onToggleDrawMode();
        handled = true;
      }

      // Predictions visibility
      else if (key === 'p' || key === 'P') {
        handlers.onTogglePredictions();
        handled = true;
      }

      // Delete shortcuts
      else if (key === 'Delete' || key === 'Backspace') {
        if (state.hasSelectedRectangle || state.hasRectangles) {
          handlers.onDeleteRectangle();
          handled = true;
        }
      }

      // Undo shortcut
      else if ((ctrlKey || metaKey) && key === 'z' && !shiftKey) {
        if (state.canUndo) {
          handlers.onUndo();
          handled = true;
        }
      }

      // Submit shortcuts
      else if ((key === 'Enter' || key === ' ') && !state.isSubmitting) {
        // Only submit if not actively drawing
        if (!state.isActivelyDrawing) {
          handlers.onSubmit();
          handled = true;
        }
      }

      // Import predictions
      else if (key === 'a' || key === 'A') {
        handlers.onImportPredictions();
        handled = true;
      }

      // Help modal
      else if (key === '?' || (shiftKey && key === '/')) {
        handlers.onShowHelp();
        handled = true;
      }

      // Smoke type shortcuts
      else if (key === '1') {
        // If a rectangle is selected, update its smoke type
        if (state.hasSelectedRectangle) {
          handlers.onSelectWildfire();
        } else {
          // Otherwise, set as default smoke type for new drawings
          handlers.onSelectWildfire();
        }
        handled = true;
      } else if (key === '2' || key === 'i' || key === 'I') {
        if (state.hasSelectedRectangle) {
          handlers.onSelectIndustrial();
        } else {
          handlers.onSelectIndustrial();
        }
        handled = true;
      } else if (key === '3' || key === 'o' || key === 'O') {
        if (state.hasSelectedRectangle) {
          handlers.onSelectOther();
        } else {
          handlers.onSelectOther();
        }
        handled = true;
      }

      // Zoom shortcuts (optional)
      else if (key === '+' || key === '=') {
        if (handlers.onZoomIn) {
          handlers.onZoomIn();
          handled = true;
        }
      } else if (key === '-') {
        if (handlers.onZoomOut) {
          handlers.onZoomOut();
          handled = true;
        }
      } else if (key === '0') {
        if (handlers.onResetZoom) {
          handlers.onResetZoom();
          handled = true;
        }
      }

      // Handle event if a shortcut was matched
      if (handled) {
        if (finalConfig.preventDefault) {
          event.preventDefault();
        }
        if (finalConfig.stopPropagation) {
          event.stopPropagation();
        }
      }
    },
    [handlers, state, finalConfig.enabled, finalConfig.preventDefault, finalConfig.stopPropagation]
  );

  useEffect(() => {
    if (!finalConfig.enabled) return;

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, finalConfig.enabled]);
};

/**
 * Helper function to create smoke type handler that works for both selected rectangles and default type.
 *
 * @param smokeType - The smoke type to set
 * @param hasSelectedRectangle - Whether a rectangle is currently selected
 * @param onUpdateSelectedRectangle - Handler to update selected rectangle smoke type
 * @param onSetDefaultSmokeType - Handler to set default smoke type
 * @returns Combined handler function
 *
 * @example
 * ```typescript
 * const handleWildfireShortcut = createSmokeTypeHandler(
 *   'wildfire',
 *   hasSelectedRectangle,
 *   (type) => updateSelectedRectangleSmokeType(rectangles, type),
 *   (type) => setDefaultSmokeType(type)
 * );
 * ```
 */
export const createSmokeTypeHandler = (
  smokeType: SmokeType,
  hasSelectedRectangle: boolean,
  onUpdateSelectedRectangle: (smokeType: SmokeType) => void,
  onSetDefaultSmokeType: (smokeType: SmokeType) => void
) => {
  return () => {
    if (hasSelectedRectangle) {
      onUpdateSelectedRectangle(smokeType);
    } else {
      onSetDefaultSmokeType(smokeType);
    }
  };
};

/**
 * Keyboard shortcut reference for display in help modal.
 */
export const KEYBOARD_SHORTCUTS = {
  general: [
    { key: '?', description: 'Show keyboard shortcuts' },
    { key: 'Escape', description: 'Close modal' },
    { key: 'Ctrl+Z', description: 'Undo last action' },
    { key: 'Enter/Space', description: 'Submit annotation' },
  ],
  drawing: [
    { key: 'D', description: 'Toggle drawing mode' },
    { key: 'Delete', description: 'Delete selected/all rectangles' },
    { key: 'P', description: 'Toggle predictions visibility' },
    { key: 'A', description: 'Import AI predictions' },
  ],
  smokeTypes: [
    { key: '1', description: '🔥 Wildfire' },
    { key: '2', description: '🏭 Industrial' },
    { key: '3', description: '💨 Other' },
  ],
  zoom: [
    { key: '+', description: 'Zoom in' },
    { key: '-', description: 'Zoom out' },
    { key: '0', description: 'Reset zoom' },
  ],
} as const;
