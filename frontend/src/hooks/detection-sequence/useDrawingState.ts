/**
 * Custom hook for managing drawing state in a functional way
 * 
 * This hook provides drawing functionality while maintaining referential transparency
 * and managing state at the edge of the system.
 */

import { useState, useCallback, useMemo } from 'react';
import { SmokeType } from '@/types/api';
import { DrawnRectangle, CurrentDrawing } from '@/components/detection-sequence/DrawingOverlay';
import { createNormalizedBboxFromPoints } from '@/utils/bbox-calculations';
import { imageToNormalized, ContainerInfo, NaturalImageInfo } from '@/utils/coordinate-transforms';

/**
 * Drawing state interface
 */
export interface DrawingState {
  readonly isDrawMode: boolean;
  readonly isActivelyDrawing: boolean;
  readonly drawnRectangles: readonly DrawnRectangle[];
  readonly currentDrawing: CurrentDrawing | null;
  readonly selectedRectangleId: string | null;
  readonly undoStack: readonly (readonly DrawnRectangle[])[];
  readonly selectedSmokeType: SmokeType;
}

/**
 * Drawing actions interface
 */
export interface DrawingActions {
  readonly setDrawMode: (enabled: boolean) => void;
  readonly startDrawing: (x: number, y: number) => void;
  readonly updateDrawing: (x: number, y: number) => void;
  readonly finishDrawing: () => void;
  readonly cancelDrawing: () => void;
  readonly selectRectangle: (id: string | null) => void;
  readonly deleteRectangle: (id: string) => void;
  readonly deleteAllRectangles: () => void;
  readonly setSmokeType: (smokeType: SmokeType) => void;
  readonly changeSelectedRectangleSmokeType: (smokeType: SmokeType) => void;
  readonly importRectangles: (rectangles: readonly DrawnRectangle[]) => void;
  readonly undo: () => void;
  readonly canUndo: boolean;
}

/**
 * Combined hook return type
 */
export interface UseDrawingStateReturn {
  readonly state: DrawingState;
  readonly actions: DrawingActions;
}

/**
 * Options for the drawing state hook
 */
export interface UseDrawingStateOptions {
  readonly initialSmokeType?: SmokeType;
  readonly maxUndoSteps?: number;
  readonly containerInfo?: ContainerInfo;
  readonly naturalImageInfo?: NaturalImageInfo;
}

/**
 * Generates a unique ID for drawn rectangles
 * 
 * @pure Function generates consistent IDs based on timestamp and random values
 */
const generateRectangleId = (): string => {
  return `rect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Pushes current state to undo stack with size limit
 * 
 * @pure Function creates new array without mutating input
 */
const pushToUndoStack = (
  currentStack: DrawnRectangle[][],
  currentRectangles: DrawnRectangle[],
  maxSize: number
): DrawnRectangle[][] => {
  const newStack = [...currentStack, currentRectangles];
  return newStack.length > maxSize ? newStack.slice(1) : newStack;
};

/**
 * Custom hook for managing drawing state in detection annotation interface
 * 
 * This hook provides a complete drawing interface with undo/redo functionality,
 * rectangle selection, smoke type management, and coordinate transformations.
 * 
 * All state changes are managed functionally with immutable updates, and
 * coordinate transformations are handled through pure utility functions.
 * 
 * @param options - Configuration options for the drawing hook
 * @returns Drawing state and action functions
 * 
 * @example
 * const { state, actions } = useDrawingState({
 *   initialSmokeType: 'wildfire',
 *   maxUndoSteps: 50,
 *   containerInfo: { width: 1000, height: 800 },
 *   naturalImageInfo: { width: 1920, height: 1080 }
 * });
 * 
 * // Enable drawing mode
 * actions.setDrawMode(true);
 * 
 * // Start drawing on mouse down
 * actions.startDrawing(mouseX, mouseY);
 * 
 * // Update drawing on mouse move
 * actions.updateDrawing(mouseX, mouseY);
 * 
 * // Finish drawing on mouse up
 * actions.finishDrawing();
 */
export const useDrawingState = (options: UseDrawingStateOptions = {}): UseDrawingStateReturn => {
  const {
    initialSmokeType = 'wildfire',
    maxUndoSteps = 50,
    containerInfo,
    naturalImageInfo
  } = options;
  
  // Core drawing state
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isActivelyDrawing, setIsActivelyDrawing] = useState(false);
  const [drawnRectangles, setDrawnRectangles] = useState<DrawnRectangle[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<CurrentDrawing | null>(null);
  const [selectedRectangleId, setSelectedRectangleId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<DrawnRectangle[][]>([]);
  const [selectedSmokeType, setSelectedSmokeType] = useState<SmokeType>(initialSmokeType);
  
  // Memoized state object
  const state: DrawingState = useMemo(() => ({
    isDrawMode,
    isActivelyDrawing,
    drawnRectangles,
    currentDrawing,
    selectedRectangleId,
    undoStack,
    selectedSmokeType
  }), [isDrawMode, isActivelyDrawing, drawnRectangles, currentDrawing, selectedRectangleId, undoStack, selectedSmokeType]);
  
  // Action: Set drawing mode
  const setDrawMode = useCallback((enabled: boolean) => {
    setIsDrawMode(enabled);
    if (!enabled) {
      // Cancel any active drawing when exiting draw mode
      setIsActivelyDrawing(false);
      setCurrentDrawing(null);
    }
  }, []);
  
  // Action: Start drawing
  const startDrawing = useCallback((x: number, y: number) => {
    if (!isDrawMode) return;
    
    setIsActivelyDrawing(true);
    setCurrentDrawing({
      startX: x,
      startY: y,
      currentX: x,
      currentY: y
    });
    
    // Clear selection when starting new drawing
    setSelectedRectangleId(null);
  }, [isDrawMode]);
  
  // Action: Update current drawing
  const updateDrawing = useCallback((x: number, y: number) => {
    if (!isActivelyDrawing || !currentDrawing) return;
    
    setCurrentDrawing(prev => prev ? {
      ...prev,
      currentX: x,
      currentY: y
    } : null);
  }, [isActivelyDrawing, currentDrawing]);
  
  // Action: Finish drawing and create rectangle
  const finishDrawing = useCallback(() => {
    if (!isActivelyDrawing || !currentDrawing || !containerInfo || !naturalImageInfo) {
      setIsActivelyDrawing(false);
      setCurrentDrawing(null);
      return;
    }
    
    // Convert image coordinates to normalized coordinates
    const startNormalized = imageToNormalized(
      currentDrawing.startX,
      currentDrawing.startY,
      containerInfo,
      naturalImageInfo
    );
    
    const endNormalized = imageToNormalized(
      currentDrawing.currentX,
      currentDrawing.currentY,
      containerInfo,
      naturalImageInfo
    );
    
    // Create normalized bbox using pure function
    const normalizedBbox = createNormalizedBboxFromPoints(startNormalized, endNormalized);
    
    // Only create rectangle if it has minimum dimensions
    const minSize = 0.01; // 1% of image size
    if ((normalizedBbox.x2 - normalizedBbox.x1) > minSize && 
        (normalizedBbox.y2 - normalizedBbox.y1) > minSize) {
      
      // Push current state to undo stack
      setUndoStack(prev => pushToUndoStack(prev, drawnRectangles, maxUndoSteps));
      
      // Create new rectangle
      const newRectangle: DrawnRectangle = {
        id: generateRectangleId(),
        xyxyn: [normalizedBbox.x1, normalizedBbox.y1, normalizedBbox.x2, normalizedBbox.y2],
        smokeType: selectedSmokeType
      };
      
      setDrawnRectangles(prev => [...prev, newRectangle]);
      setSelectedRectangleId(newRectangle.id);
    }
    
    setIsActivelyDrawing(false);
    setCurrentDrawing(null);
  }, [isActivelyDrawing, currentDrawing, containerInfo, naturalImageInfo, drawnRectangles, maxUndoSteps, selectedSmokeType]);
  
  // Action: Cancel current drawing
  const cancelDrawing = useCallback(() => {
    setIsActivelyDrawing(false);
    setCurrentDrawing(null);
  }, []);
  
  // Action: Select rectangle
  const selectRectangle = useCallback((id: string | null) => {
    setSelectedRectangleId(id);
  }, []);
  
  // Action: Delete specific rectangle
  const deleteRectangle = useCallback((id: string) => {
    setUndoStack(prev => pushToUndoStack(prev, drawnRectangles, maxUndoSteps));
    setDrawnRectangles(prev => prev.filter(rect => rect.id !== id));
    if (selectedRectangleId === id) {
      setSelectedRectangleId(null);
    }
  }, [drawnRectangles, maxUndoSteps, selectedRectangleId]);
  
  // Action: Delete all rectangles
  const deleteAllRectangles = useCallback(() => {
    if (drawnRectangles.length === 0) return;
    
    setUndoStack(prev => pushToUndoStack(prev, drawnRectangles, maxUndoSteps));
    setDrawnRectangles([]);
    setSelectedRectangleId(null);
  }, [drawnRectangles, maxUndoSteps]);
  
  // Action: Set smoke type for new rectangles
  const setSmokeType = useCallback((smokeType: SmokeType) => {
    setSelectedSmokeType(smokeType);
  }, []);
  
  // Action: Change smoke type of selected rectangle
  const changeSelectedRectangleSmokeType = useCallback((smokeType: SmokeType) => {
    if (!selectedRectangleId) return;
    
    setUndoStack(prev => pushToUndoStack(prev, drawnRectangles, maxUndoSteps));
    setDrawnRectangles(prev => prev.map(rect => 
      rect.id === selectedRectangleId 
        ? { ...rect, smokeType }
        : rect
    ));
  }, [selectedRectangleId, drawnRectangles, maxUndoSteps]);
  
  // Action: Import rectangles (e.g., from AI predictions)
  const importRectangles = useCallback((rectangles: readonly DrawnRectangle[]) => {
    if (rectangles.length === 0) return;
    
    setUndoStack(prev => pushToUndoStack(prev, drawnRectangles, maxUndoSteps));
    setDrawnRectangles(prev => [...prev, ...rectangles]);
  }, [drawnRectangles, maxUndoSteps]);
  
  // Action: Undo last operation
  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    
    // Cancel any active drawing first
    if (isActivelyDrawing) {
      setCurrentDrawing(null);
      setIsActivelyDrawing(false);
    }
    
    // Restore previous state
    const lastState = undoStack[undoStack.length - 1];
    setDrawnRectangles(lastState);
    setUndoStack(prev => prev.slice(0, -1));
    
    // Clear selection since rectangles changed
    setSelectedRectangleId(null);
  }, [undoStack, isActivelyDrawing]);
  
  // Computed property: Can undo
  const canUndo = useMemo(() => undoStack.length > 0, [undoStack.length]);
  
  // Memoized actions object
  const actions: DrawingActions = useMemo(() => ({
    setDrawMode,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    selectRectangle,
    deleteRectangle,
    deleteAllRectangles,
    setSmokeType,
    changeSelectedRectangleSmokeType,
    importRectangles,
    undo,
    canUndo
  }), [
    setDrawMode,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    selectRectangle,
    deleteRectangle,
    deleteAllRectangles,
    setSmokeType,
    changeSelectedRectangleSmokeType,
    importRectangles,
    undo,
    canUndo
  ]);
  
  return { state, actions };
};