/**
 * State-minimal drawing canvas hook.
 * Manages only essential drawing interaction state while deriving everything else.
 */

import { useState, useCallback, useMemo } from 'react';
import { SmokeType } from '@/types/api';
import {
  DrawnRectangle,
  CurrentDrawing,
  Point,
  ImageBounds,
  createDrawnRectangle,
  validateDrawingSize,
  getRectangleAtPoint,
  updateRectangleSmokeType,
  removeRectangle,
  importPredictionsAsRectangles,
} from '@/utils/annotation';

/**
 * Configuration for the drawing canvas hook.
 */
export interface DrawingCanvasConfig {
  /** Default smoke type for new rectangles */
  defaultSmokeType: SmokeType;
  /** Minimum drawing size in pixels */
  minDrawingSize: number;
  /** Whether to enable undo functionality */
  enableUndo: boolean;
  /** Maximum undo history size */
  maxUndoSize: number;
}

/**
 * Drawing canvas state and actions.
 */
export interface DrawingCanvasState {
  // Essential state (only what cannot be derived)
  isDrawMode: boolean;
  isActivelyDrawing: boolean;
  currentDrawing: CurrentDrawing | null;
  selectedRectangleId: string | null;

  // Derived state (computed from props and essential state)
  hasRectangles: boolean;
  hasSelection: boolean;
  canUndo: boolean;

  // Actions
  setDrawMode: (enabled: boolean) => void;
  startDrawing: (point: Point) => void;
  updateDrawing: (point: Point) => void;
  finishDrawing: (imageBounds: ImageBounds, smokeType: SmokeType) => DrawnRectangle | null;
  cancelDrawing: () => void;
  selectRectangle: (rectangleId: string | null) => void;
  selectRectangleAtPoint: (
    point: Point,
    rectangles: DrawnRectangle[],
    imageBounds: ImageBounds
  ) => void;
  updateSelectedRectangleSmokeType: (
    rectangles: DrawnRectangle[],
    smokeType: SmokeType
  ) => DrawnRectangle[];
  deleteSelectedRectangle: (rectangles: DrawnRectangle[]) => DrawnRectangle[];
  deleteAllRectangles: () => void;
  importPredictions: (
    predictions: Array<{ xyxyn: [number, number, number, number] }>,
    rectangles: DrawnRectangle[],
    smokeType: SmokeType
  ) => DrawnRectangle[];
  undo: () => DrawnRectangle[] | null;
  pushUndoState: (rectangles: DrawnRectangle[]) => void;
  reset: () => void;
}

/**
 * Default configuration for drawing canvas.
 */
const defaultConfig: DrawingCanvasConfig = {
  defaultSmokeType: 'wildfire',
  minDrawingSize: 10,
  enableUndo: true,
  maxUndoSize: 20,
};

/**
 * State-minimal drawing canvas hook.
 * Only stores essential interaction state, derives everything else.
 *
 * @param config - Configuration options
 * @returns Drawing canvas state and actions
 *
 * @example
 * ```typescript
 * const drawing = useDrawingCanvas({
 *   defaultSmokeType: 'wildfire',
 *   minDrawingSize: 15
 * });
 *
 * // Use in mouse handlers
 * const handleMouseDown = (e: MouseEvent) => {
 *   const point = { x: e.clientX, y: e.clientY };
 *   drawing.startDrawing(point);
 * };
 * ```
 */
export const useDrawingCanvas = (config: Partial<DrawingCanvasConfig> = {}): DrawingCanvasState => {
  const finalConfig = { ...defaultConfig, ...config };

  // Essential state only (cannot be derived)
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isActivelyDrawing, setIsActivelyDrawing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<CurrentDrawing | null>(null);
  const [selectedRectangleId, setSelectedRectangleId] = useState<string | null>(null);

  // Undo stack (only if enabled)
  const [undoStack, setUndoStack] = useState<DrawnRectangle[][]>([]);

  // Derived state (computed, not stored)
  const hasSelection = selectedRectangleId !== null;
  const canUndo = finalConfig.enableUndo && undoStack.length > 0;

  // Actions
  const setDrawMode = useCallback(
    (enabled: boolean) => {
      setIsDrawMode(enabled);
      // Cancel any active drawing when switching modes
      if (!enabled && isActivelyDrawing) {
        setCurrentDrawing(null);
        setIsActivelyDrawing(false);
      }
    },
    [isActivelyDrawing]
  );

  const startDrawing = useCallback(
    (point: Point) => {
      if (!isDrawMode) return;

      setCurrentDrawing({
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
      });
      setIsActivelyDrawing(true);
      setSelectedRectangleId(null); // Clear selection when starting new drawing
    },
    [isDrawMode]
  );

  const updateDrawing = useCallback(
    (point: Point) => {
      if (!isActivelyDrawing || !currentDrawing) return;

      setCurrentDrawing(prev =>
        prev
          ? {
              ...prev,
              currentX: point.x,
              currentY: point.y,
            }
          : null
      );
    },
    [isActivelyDrawing, currentDrawing]
  );

  const finishDrawing = useCallback(
    (imageBounds: ImageBounds, smokeType: SmokeType): DrawnRectangle | null => {
      if (!isActivelyDrawing || !currentDrawing) return null;

      // Validate drawing size
      if (!validateDrawingSize(currentDrawing, finalConfig.minDrawingSize)) {
        setCurrentDrawing(null);
        setIsActivelyDrawing(false);
        return null;
      }

      // Create new rectangle
      const newRectangle = createDrawnRectangle(currentDrawing, imageBounds, smokeType);

      // Clear drawing state
      setCurrentDrawing(null);
      setIsActivelyDrawing(false);

      return newRectangle;
    },
    [isActivelyDrawing, currentDrawing, finalConfig.minDrawingSize]
  );

  const cancelDrawing = useCallback(() => {
    setCurrentDrawing(null);
    setIsActivelyDrawing(false);
  }, []);

  const selectRectangle = useCallback((rectangleId: string | null) => {
    setSelectedRectangleId(rectangleId);
  }, []);

  const selectRectangleAtPoint = useCallback(
    (point: Point, rectangles: DrawnRectangle[], imageBounds: ImageBounds) => {
      const rectangle = getRectangleAtPoint(point, rectangles, imageBounds);
      setSelectedRectangleId(rectangle?.id || null);
    },
    []
  );

  const updateSelectedRectangleSmokeType = useCallback(
    (rectangles: DrawnRectangle[], smokeType: SmokeType): DrawnRectangle[] => {
      if (!selectedRectangleId) return rectangles;

      return updateRectangleSmokeType(rectangles, selectedRectangleId, smokeType);
    },
    [selectedRectangleId]
  );

  const deleteSelectedRectangle = useCallback(
    (rectangles: DrawnRectangle[]): DrawnRectangle[] => {
      if (!selectedRectangleId) return rectangles;

      const newRectangles = removeRectangle(rectangles, selectedRectangleId);
      setSelectedRectangleId(null); // Clear selection after deletion

      return newRectangles;
    },
    [selectedRectangleId]
  );

  const deleteAllRectangles = useCallback(() => {
    setSelectedRectangleId(null); // Clear selection when deleting all
  }, []);

  const importPredictions = useCallback(
    (
      predictions: Array<{ xyxyn: [number, number, number, number] }>,
      rectangles: DrawnRectangle[],
      smokeType: SmokeType
    ): DrawnRectangle[] => {
      const importedRectangles = importPredictionsAsRectangles(predictions, smokeType, rectangles);
      return [...rectangles, ...importedRectangles];
    },
    []
  );

  const pushUndoState = useCallback(
    (rectangles: DrawnRectangle[]) => {
      if (!finalConfig.enableUndo) return;

      setUndoStack(prev => {
        const newStack = [...prev, rectangles];
        // Limit stack size
        if (newStack.length > finalConfig.maxUndoSize) {
          return newStack.slice(1);
        }
        return newStack;
      });
    },
    [finalConfig.enableUndo, finalConfig.maxUndoSize]
  );

  const undo = useCallback((): DrawnRectangle[] | null => {
    if (!finalConfig.enableUndo || undoStack.length === 0) return null;

    const lastState = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setSelectedRectangleId(null); // Clear selection after undo

    return lastState;
  }, [finalConfig.enableUndo, undoStack]);

  const reset = useCallback(() => {
    setIsDrawMode(false);
    setIsActivelyDrawing(false);
    setCurrentDrawing(null);
    setSelectedRectangleId(null);
    setUndoStack([]);
  }, []);

  // Return state and actions
  return useMemo(
    () => ({
      // Essential state
      isDrawMode,
      isActivelyDrawing,
      currentDrawing,
      selectedRectangleId,

      // Derived state
      hasSelection,
      canUndo,
      get hasRectangles() {
        // This will be provided by the component using the hook
        return false; // Placeholder - actual value derived from rectangles prop
      },

      // Actions
      setDrawMode,
      startDrawing,
      updateDrawing,
      finishDrawing,
      cancelDrawing,
      selectRectangle,
      selectRectangleAtPoint,
      updateSelectedRectangleSmokeType,
      deleteSelectedRectangle,
      deleteAllRectangles,
      importPredictions,
      undo,
      pushUndoState,
      reset,
    }),
    [
      isDrawMode,
      isActivelyDrawing,
      currentDrawing,
      selectedRectangleId,
      hasSelection,
      canUndo,
      setDrawMode,
      startDrawing,
      updateDrawing,
      finishDrawing,
      cancelDrawing,
      selectRectangle,
      selectRectangleAtPoint,
      updateSelectedRectangleSmokeType,
      deleteSelectedRectangle,
      deleteAllRectangles,
      importPredictions,
      undo,
      pushUndoState,
      reset,
    ]
  );
};
