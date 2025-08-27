/**
 * Barrel export for annotation hooks.
 */

export { useDrawingCanvas } from './useDrawingCanvas';
export type { DrawingCanvasConfig, DrawingCanvasState } from './useDrawingCanvas';

export {
  useKeyboardShortcuts,
  createSmokeTypeHandler,
  KEYBOARD_SHORTCUTS,
} from './useKeyboardShortcuts';
export type {
  KeyboardShortcutHandlers,
  KeyboardShortcutState,
  KeyboardShortcutConfig,
} from './useKeyboardShortcuts';
