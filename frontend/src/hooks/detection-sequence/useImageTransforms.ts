/**
 * Custom hook for managing image zoom and pan transformations
 * 
 * This hook provides image transformation functionality using pure calculation functions
 * and manages transformation state in a functional way.
 */

import { useState, useCallback, useMemo } from 'react';
import { calculateZoomLevel, constrainPanOffset } from '@/utils/coordinate-transforms';
import { ImageInfo, Transform } from '@/utils/coordinate-transforms';

/**
 * Transform state interface
 */
export interface TransformState {
  readonly zoomLevel: number;
  readonly panOffset: { readonly x: number; readonly y: number };
  readonly transformOrigin: { readonly x: number; readonly y: number };
  readonly isDragging: boolean;
}

/**
 * Transform actions interface
 */
export interface TransformActions {
  readonly setZoom: (zoom: number) => void;
  readonly zoomIn: (delta?: number) => void;
  readonly zoomOut: (delta?: number) => void;
  readonly resetZoom: () => void;
  readonly setPan: (x: number, y: number) => void;
  readonly panBy: (deltaX: number, deltaY: number) => void;
  readonly setTransformOrigin: (x: number, y: number) => void;
  readonly startDrag: () => void;
  readonly endDrag: () => void;
  readonly handleWheel: (event: WheelEvent, imageRect: DOMRect) => void;
  readonly resetTransform: () => void;
}

/**
 * Combined hook return type
 */
export interface UseImageTransformsReturn {
  readonly state: TransformState;
  readonly actions: TransformActions;
  readonly transform: Transform; // Convenience accessor
}

/**
 * Options for the image transforms hook
 */
export interface UseImageTransformsOptions {
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly zoomStep?: number;
  readonly imageInfo?: ImageInfo | null;
}

/**
 * Calculates mouse position relative to image for transform origin
 * 
 * @pure Function has no side effects
 */
const calculateMousePercentage = (
  mouseX: number,
  mouseY: number,
  imageRect: DOMRect
): { x: number; y: number } => {
  const relativeX = mouseX - imageRect.left;
  const relativeY = mouseY - imageRect.top;
  
  return {
    x: (relativeX / imageRect.width) * 100,
    y: (relativeY / imageRect.height) * 100
  };
};

/**
 * Custom hook for managing image transformations (zoom and pan)
 * 
 * This hook provides complete zoom and pan functionality with smooth interactions,
 * boundary constraints, and mouse wheel support. All transformations use pure
 * calculation functions and maintain referential transparency.
 * 
 * @param options - Configuration options for transforms
 * @returns Transform state and action functions
 * 
 * @example
 * const { state, actions, transform } = useImageTransforms({
 *   minZoom: 1.0,
 *   maxZoom: 4.0,
 *   zoomStep: 0.2,
 *   imageInfo: { width: 800, height: 600, offsetX: 10, offsetY: 5 }
 * });
 * 
 * // Zoom in/out
 * actions.zoomIn();
 * actions.zoomOut();
 * 
 * // Reset to default
 * actions.resetTransform();
 * 
 * // Handle mouse wheel
 * const handleWheel = (e: WheelEvent) => {
 *   const imageRect = imageRef.current?.getBoundingClientRect();
 *   if (imageRect) {
 *     actions.handleWheel(e, imageRect);
 *   }
 * };
 */
export const useImageTransforms = (options: UseImageTransformsOptions = {}): UseImageTransformsReturn => {
  const {
    minZoom = 1.0,
    maxZoom = 4.0,
    zoomStep = 0.2,
    imageInfo = null
  } = options;
  
  // Core transform state
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [transformOrigin, setTransformOrigin] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  
  // Memoized state object
  const state: TransformState = useMemo(() => ({
    zoomLevel,
    panOffset,
    transformOrigin,
    isDragging
  }), [zoomLevel, panOffset, transformOrigin, isDragging]);
  
  // Memoized transform object for convenience
  const transform: Transform = useMemo(() => ({
    zoomLevel,
    panOffset,
    transformOrigin
  }), [zoomLevel, panOffset, transformOrigin]);
  
  // Action: Set specific zoom level
  const setZoom = useCallback((zoom: number) => {
    const newZoom = calculateZoomLevel(zoom, 0, minZoom, maxZoom);
    setZoomLevel(newZoom);
    
    // Reset pan if zoomed back to minimum
    if (newZoom === minZoom) {
      setPanOffset({ x: 0, y: 0 });
      setTransformOrigin({ x: 50, y: 50 });
    } else if (imageInfo) {
      // Constrain pan to keep image in bounds
      const constrainedPan = constrainPanOffset(panOffset, newZoom, imageInfo);
      setPanOffset(constrainedPan);
    }
  }, [minZoom, maxZoom, panOffset, imageInfo]);
  
  // Action: Zoom in
  const zoomIn = useCallback((delta: number = zoomStep) => {
    const newZoom = calculateZoomLevel(zoomLevel, delta, minZoom, maxZoom);
    setZoom(newZoom);
  }, [zoomLevel, zoomStep, minZoom, maxZoom, setZoom]);
  
  // Action: Zoom out
  const zoomOut = useCallback((delta: number = zoomStep) => {
    const newZoom = calculateZoomLevel(zoomLevel, -delta, minZoom, maxZoom);
    setZoom(newZoom);
  }, [zoomLevel, zoomStep, minZoom, maxZoom, setZoom]);
  
  // Action: Reset zoom to minimum
  const resetZoom = useCallback(() => {
    setZoom(minZoom);
  }, [minZoom, setZoom]);
  
  // Action: Set pan offset
  const setPan = useCallback((x: number, y: number) => {
    const newPanOffset = { x, y };
    
    if (imageInfo) {
      const constrainedPan = constrainPanOffset(newPanOffset, zoomLevel, imageInfo);
      setPanOffset(constrainedPan);
    } else {
      setPanOffset(newPanOffset);
    }
  }, [zoomLevel, imageInfo]);
  
  // Action: Pan by delta amounts
  const panBy = useCallback((deltaX: number, deltaY: number) => {
    setPan(panOffset.x + deltaX, panOffset.y + deltaY);
  }, [panOffset, setPan]);
  
  // Action: Set transform origin
  const setOrigin = useCallback((x: number, y: number) => {
    setTransformOrigin({ x, y });
  }, []);
  
  // Action: Start drag operation
  const startDrag = useCallback(() => {
    setIsDragging(true);
  }, []);
  
  // Action: End drag operation
  const endDrag = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  // Action: Handle mouse wheel zoom
  const handleWheel = useCallback((event: WheelEvent, imageRect: DOMRect) => {
    event.preventDefault();
    
    // Calculate mouse position as percentage for transform origin
    const mousePercentage = calculateMousePercentage(event.clientX, event.clientY, imageRect);
    setOrigin(mousePercentage.x, mousePercentage.y);
    
    // Calculate zoom delta
    const delta = event.deltaY < 0 ? zoomStep : -zoomStep;
    const newZoom = calculateZoomLevel(zoomLevel, delta, minZoom, maxZoom);
    setZoom(newZoom);
  }, [zoomLevel, zoomStep, minZoom, maxZoom, setZoom, setOrigin]);
  
  // Action: Reset all transformations
  const resetTransform = useCallback(() => {
    setZoomLevel(minZoom);
    setPanOffset({ x: 0, y: 0 });
    setTransformOrigin({ x: 50, y: 50 });
    setIsDragging(false);
  }, [minZoom]);
  
  // Memoized actions object
  const actions: TransformActions = useMemo(() => ({
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
    setPan,
    panBy,
    setTransformOrigin: setOrigin,
    startDrag,
    endDrag,
    handleWheel,
    resetTransform
  }), [
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
    setPan,
    panBy,
    setOrigin,
    startDrag,
    endDrag,
    handleWheel,
    resetTransform
  ]);
  
  return { state, actions, transform };
};