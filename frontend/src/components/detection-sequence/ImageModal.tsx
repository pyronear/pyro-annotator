import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Keyboard } from 'lucide-react';
import {
  Detection,
  DetectionAnnotation,
  DetectionAnnotationBbox,
  SmokeType,
} from '@/types/api';
import {
  DrawnRectangle,
  CurrentDrawing,
  Point,
  ImageBounds,
  calculateImageBounds,
  screenToImageCoordinates,
  imageToNormalizedCoordinates,
  normalizedToImageCoordinates,
  getRectangleAtPoint,
  importPredictionsAsRectangles,
  updateRectangleSmokeType,
  removeRectangle,
  getWinningModelLayer,
  materializeReviewAnnotation,
} from '@/utils/annotation';
import {
  KeyboardShortcutsModal,
  AnnotationToolbar,
  SubmissionControls,
  DetectionAnnotationCanvas,
} from '@/components/detection-annotation';
import { useKeyboardShortcuts } from '@/hooks/annotation';

interface ImageModalProps {
  detection: Detection;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onSubmit: (
    detection: Detection,
    items: DetectionAnnotationBbox[],
    currentDrawMode: boolean
  ) => void;
  onTogglePredictions: (show: boolean) => void;
  canNavigatePrev: boolean;
  canNavigateNext: boolean;
  currentIndex: number;
  totalCount: number;
  showPredictions?: boolean;
  isSubmitting?: boolean;
  isAnnotated?: boolean;
  existingAnnotation?: DetectionAnnotation | null;
  // Persistent smoke type props
  selectedSmokeType: SmokeType;
  onSmokeTypeChange: (smokeType: SmokeType) => void;
  // Drawing mode persistence props
  persistentDrawMode: boolean;
  onDrawModeChange: (drawMode: boolean) => void;
  isAutoAdvance: boolean;
}

export function ImageModal({
  detection,
  onClose,
  onNavigate,
  onSubmit,
  onTogglePredictions,
  canNavigatePrev,
  canNavigateNext,
  currentIndex,
  totalCount,
  showPredictions = false,
  isSubmitting = false,
  isAnnotated = false,
  existingAnnotation = null,
  selectedSmokeType,
  onSmokeTypeChange,
  persistentDrawMode,
  onDrawModeChange,
  isAutoAdvance,
}: ImageModalProps) {
  // Image data is now handled by DetectionAnnotationCanvas
  const [imageInfo, setImageInfo] = useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Zoom state management
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [transformOrigin, setTransformOrigin] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Drawing state management
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isActivelyDrawing, setIsActivelyDrawing] = useState(false);
  const [drawnRectangles, setDrawnRectangles] = useState<DrawnRectangle[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<CurrentDrawing | null>(null);
  const [selectedRectangleId, setSelectedRectangleId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<DrawnRectangle[][]>([]);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

  // Transition state management for smooth overlay animations
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Per-layer visibility for the read-only model reference layers. Default to
  // the winning layer only (auto if present, else engine); the other layer is
  // hidden and can be toggled on to investigate.
  const winningLayer = getWinningModelLayer(detection);
  const hasEngine = (detection.algo_predictions?.predictions?.length ?? 0) > 0;
  const hasAuto = (detection.auto_predictions?.predictions?.length ?? 0) > 0;
  const [showEngine, setShowEngine] = useState(winningLayer === 'engine');
  const [showAuto, setShowAuto] = useState(winningLayer === 'auto');
  // Seed-at-submit review: per-box status on the winning layer. Indices refer
  // to the winning layer's prediction list.
  const [rejectedBoxes, setRejectedBoxes] = useState<Set<number>>(new Set());
  const [selectedModelBox, setSelectedModelBox] = useState<number | null>(null);
  // Reset to the winning layer only when the *detection* changes (navigation),
  // not when a background refetch repopulates the same detection's
  // auto_predictions — which would otherwise clobber a manual toggle mid-review.
  const layerInitFor = useRef<number | null>(null);
  useEffect(() => {
    if (layerInitFor.current === detection.id) return;
    layerInitFor.current = detection.id;
    const winning = getWinningModelLayer(detection);
    setShowEngine(winning === 'engine');
    setShowAuto(winning === 'auto');
    setRejectedBoxes(new Set());
    setSelectedModelBox(null);
  }, [detection]);

  // Winning model layer being reviewed (auto if present, else engine).
  const winningPredictions =
    winningLayer === 'auto'
      ? detection.auto_predictions?.predictions
      : detection.algo_predictions?.predictions;

  const handleSelectModelBox = (index: number) =>
    setSelectedModelBox(prev => (prev === index ? null : index));

  const handleRejectModelBox = (index: number) => {
    setRejectedBoxes(prev => new Set(prev).add(index));
    setSelectedModelBox(null);
  };

  const handleAdjustModelBox = (index: number) => {
    const box = winningPredictions?.[index];
    if (!box) return;
    // Reject the original and seed an editable human copy to drag/correct.
    setRejectedBoxes(prev => new Set(prev).add(index));
    const seeded: DrawnRectangle = {
      id: `adjust-${detection.id}-${index}`,
      xyxyn: box.xyxyn,
      smokeType: selectedSmokeType,
    };
    setDrawnRectangles(prev => [...prev, seeded]);
    setSelectedRectangleId(seeded.id);
    setSelectedModelBox(null);
  };

  // Materialize the committed annotation for submit: accepted winning boxes
  // (origin auto/engine) + human boxes (origin human), minus rejected.
  const buildReviewItems = (): DetectionAnnotationBbox[] =>
    materializeReviewAnnotation({
      winningBoxes: winningPredictions ?? [],
      winningLayer,
      rejected: rejectedBoxes,
      humanRects: drawnRectangles,
      smokeType: selectedSmokeType,
    });

  // Handle image load to get dimensions and position using DOM positioning
  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      // Get actual rendered positions from DOM
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();

      // Calculate the image position relative to the container
      const offsetX = imgRect.left - containerRect.left;
      const offsetY = imgRect.top - containerRect.top;

      // Use the actual rendered dimensions
      const width = imgRect.width;
      const height = imgRect.height;

      setImageInfo({
        width: width,
        height: height,
        offsetX: offsetX,
        offsetY: offsetY,
      });

      // If transitioning, complete the fade-in animation
      if (isTransitioning) {
        setTimeout(() => {
          setOverlaysVisible(true);
          setIsTransitioning(false);
        }, 50); // Small delay to ensure imageInfo is set
      }
    }
  };

  // Track previous detection ID to know when it actually changes
  const prevDetectionIdRef = useRef(detection.id);

  // Reset zoom and drawing when detection changes, load existing annotations
  useEffect(() => {
    // Only reset states if detection actually changed
    if (prevDetectionIdRef.current !== detection.id) {
      prevDetectionIdRef.current = detection.id;

      setZoomLevel(1.0);
      setPanOffset({ x: 0, y: 0 });
      setTransformOrigin({ x: 50, y: 50 });

      // Start transition: fade out overlays smoothly
      setIsTransitioning(true);
      setOverlaysVisible(false);

      // Reset imageInfo to null to prevent stale overlays during image loading
      setTimeout(() => {
        setImageInfo(null);
      }, 150); // Allow fade out animation to start

      // Fallback: recalculate imageInfo after a short delay if handleImageLoad doesn't fire
      setTimeout(() => {
        if (imgRef.current && containerRef.current) {
          const img = imgRef.current;
          const containerRect = containerRef.current.getBoundingClientRect();
          const imgRect = img.getBoundingClientRect();

          // Only recalculate if we have valid dimensions (image is loaded)
          if (imgRect.width > 0 && imgRect.height > 0) {
            const offsetX = imgRect.left - containerRect.left;
            const offsetY = imgRect.top - containerRect.top;
            const width = imgRect.width;
            const height = imgRect.height;

            setImageInfo({
              width: width,
              height: height,
              offsetX: offsetX,
              offsetY: offsetY,
            });

            // Complete transition: fade overlays back in
            setTimeout(() => {
              setOverlaysVisible(true);
              setIsTransitioning(false);
            }, 50); // Small delay to ensure imageInfo is set
          }
        }
      }, 200); // Give image time to load

      // Handle drawing mode based on navigation type
      if (isAutoAdvance) {
        // During auto-advance, preserve the drawing mode state
        setIsDrawMode(persistentDrawMode);
      } else {
        // Manual navigation - reset drawing mode
        setIsDrawMode(false);
      }

      setIsActivelyDrawing(false);
      setCurrentDrawing(null);
      setSelectedRectangleId(null);
      setUndoStack([]);
    }

    // Always update rectangles based on annotation (even if detection didn't change)
    if (existingAnnotation?.annotation?.annotation) {
      // false-positive items (no smoke_type) are not editable smoke rectangles
      const existingRects: DrawnRectangle[] = existingAnnotation.annotation.annotation
        .filter(item => item.smoke_type != null)
        .map((item, index) => ({
          id: `existing-${index}`,
          xyxyn: item.xyxyn,
          smokeType: item.smoke_type as SmokeType,
        }));
      setDrawnRectangles(existingRects);
    } else {
      setDrawnRectangles([]);
    }
  }, [detection.id, existingAnnotation, isAutoAdvance, persistentDrawMode]);

  // Get current image and container information for coordinate transformations
  const getImageInfo = (): {
    containerOffset: Point;
    imageBounds: ImageBounds;
    transform: { zoomLevel: number; panOffset: Point; transformOrigin: Point };
  } | null => {
    if (!imgRef.current || !containerRef.current) return null;

    const containerRect = containerRef.current.getBoundingClientRect();
    const img = imgRef.current;

    const containerOffset: Point = {
      x: containerRect.left,
      y: containerRect.top,
    };

    const imageBounds = calculateImageBounds({
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      imageNaturalWidth: img.naturalWidth,
      imageNaturalHeight: img.naturalHeight,
    });

    const transform = {
      zoomLevel,
      panOffset,
      transformOrigin,
    };

    return { containerOffset, imageBounds, transform };
  };

  // Wrapper function to maintain compatibility with existing code
  const screenToImageCoords = (screenX: number, screenY: number) => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };

    return screenToImageCoordinates(
      { x: screenX, y: screenY },
      info.containerOffset,
      info.imageBounds,
      info.transform
    );
  };

  // Wrapper function for image to normalized coordinates
  const imageToNormalized = (imageX: number, imageY: number) => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };

    return imageToNormalizedCoordinates({ x: imageX, y: imageY }, info.imageBounds);
  };

  // Wrapper function for normalized to image coordinates
  const normalizedToImage = (normX: number, normY: number) => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };

    return normalizedToImageCoordinates({ x: normX, y: normY }, info.imageBounds);
  };

  // Hit testing function using pure utilities
  const getRectAtPoint = (x: number, y: number): DrawnRectangle | null => {
    const info = getImageInfo();
    if (!info) return null;

    return getRectangleAtPoint({ x, y }, drawnRectangles, info.imageBounds);
  };

  // Undo functionality
  const pushUndoState = () => {
    setUndoStack(prev => {
      const newStack = [...prev, [...drawnRectangles]]; // Deep copy current state
      // Limit stack size to 50 operations to prevent memory issues
      return newStack.length > 50 ? newStack.slice(1) : newStack;
    });
  };

  // Change smoke type of selected rectangle using pure utility
  const changeSelectedRectangleSmokeType = (newSmokeType: SmokeType) => {
    if (!selectedRectangleId) return;

    pushUndoState();
    setDrawnRectangles(prev => updateRectangleSmokeType(prev, selectedRectangleId, newSmokeType));
  };

  // Note: coordinatesMatch function replaced with direct call to areBoundingBoxesSimilar

  // Get count of new predictions using pure utility
  const getNewPredictionsCount = (): number => {
    if (!detection?.algo_predictions?.predictions) return 0;

    const newRectangles = importPredictionsAsRectangles(
      detection.algo_predictions.predictions,
      selectedSmokeType,
      drawnRectangles
    );

    return newRectangles.length;
  };

  // Import AI predictions using pure utility
  const importAIPredictions = () => {
    if (!detection?.algo_predictions?.predictions) return;

    const newRectangles = importPredictionsAsRectangles(
      detection.algo_predictions.predictions,
      selectedSmokeType,
      drawnRectangles
    );

    if (newRectangles.length === 0) {
      // Visual feedback: brief button animation to indicate no action taken
      const button = document.querySelector(
        'button[title*="All AI predictions already imported"]'
      ) as HTMLElement;
      if (button) {
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
          button.style.transform = '';
        }, 150);
      }
      return;
    }

    // Save current state to undo stack before importing
    pushUndoState();

    // Add imported rectangles to existing ones
    setDrawnRectangles(prev => [...prev, ...newRectangles]);

    // Show success feedback
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;

    // Cancel any active drawing first
    if (isActivelyDrawing) {
      setCurrentDrawing(null);
      setIsActivelyDrawing(false);
    }

    // Pop last state and restore
    const lastState = undoStack[undoStack.length - 1];
    setDrawnRectangles(lastState);
    setUndoStack(prev => prev.slice(0, -1));

    // Clear selection since rectangles changed
    setSelectedRectangleId(null);
  };

  // Mouse wheel zoom handler
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      if (!containerRef.current || !imgRef.current) return;

      const imgRect = imgRef.current.getBoundingClientRect();

      // Calculate mouse position relative to the image
      const mouseX = e.clientX - imgRect.left;
      const mouseY = e.clientY - imgRect.top;

      // Convert to percentage for transform-origin
      const originX = (mouseX / imgRect.width) * 100;
      const originY = (mouseY / imgRect.height) * 100;

      setTransformOrigin({ x: originX, y: originY });

      // Calculate new zoom level
      const zoomDelta = e.deltaY < 0 ? 0.2 : -0.2;
      const newZoomLevel = Math.max(1.0, Math.min(4.0, zoomLevel + zoomDelta));

      setZoomLevel(newZoomLevel);

      // Reset pan if zoomed back to 1x
      if (newZoomLevel === 1.0) {
        setPanOffset({ x: 0, y: 0 });
        setTransformOrigin({ x: 50, y: 50 });
      }
    },
    [zoomLevel]
  );

  // Pan boundary constraint helper
  const constrainPan = (offset: { x: number; y: number }) => {
    if (!imgRef.current || zoomLevel <= 1) return offset;

    const imgRect = imgRef.current.getBoundingClientRect();
    const scaledWidth = imgRect.width * zoomLevel;
    const scaledHeight = imgRect.height * zoomLevel;

    // Calculate max pan distance to keep image centered in viewport
    const maxPanX = (scaledWidth - imgRect.width) / 2;
    const maxPanY = (scaledHeight - imgRect.height) / 2;

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, offset.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, offset.y)),
    };
  };

  // Click-based drawing and panning handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isDrawMode && zoomLevel > 1.0) {
      // Start panning when not in draw mode
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
    // Drawing is handled by handleClick instead
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const coords = screenToImageCoords(e.clientX, e.clientY);

    // First, check if we clicked on an existing rectangle for selection
    // Selection works regardless of drawing mode - it takes priority
    const hitRectangle = getRectAtPoint(coords.x, coords.y);

    if (hitRectangle) {
      // Select the rectangle and cancel any active drawing
      setSelectedRectangleId(hitRectangle.id);
      setIsActivelyDrawing(false);
      setCurrentDrawing(null);
      return;
    }

    // No rectangle hit - deselect any current selection
    setSelectedRectangleId(null);

    // Only proceed with drawing if in drawing mode
    if (!isDrawMode) return;

    // Proceed with drawing logic
    if (!isActivelyDrawing) {
      // First click: Start drawing rectangle
      setCurrentDrawing({
        startX: coords.x,
        startY: coords.y,
        currentX: coords.x,
        currentY: coords.y,
      });
      setIsActivelyDrawing(true);
    } else {
      // Second click: Finalize rectangle
      if (currentDrawing) {
        const startNorm = imageToNormalized(currentDrawing.startX, currentDrawing.startY);
        const endNorm = imageToNormalized(coords.x, coords.y);

        // Ensure we have a minimum rectangle size
        const minX = Math.min(startNorm.x, endNorm.x);
        const maxX = Math.max(startNorm.x, endNorm.x);
        const minY = Math.min(startNorm.y, endNorm.y);
        const maxY = Math.max(startNorm.y, endNorm.y);

        // Only create rectangle if it has meaningful size (at least 10 pixels)
        const sizeThreshold = 10 / (imgRef.current?.getBoundingClientRect().width || 1000);
        if (maxX - minX > sizeThreshold && maxY - minY > sizeThreshold) {
          // Save current state to undo stack before adding rectangle
          pushUndoState();

          const newRect: DrawnRectangle = {
            id: Date.now().toString(),
            xyxyn: [minX, minY, maxX, maxY],
            smokeType: selectedSmokeType,
          };

          setDrawnRectangles(prev => [...prev, newRect]);
        }
      }

      // Reset drawing state
      setCurrentDrawing(null);
      setIsActivelyDrawing(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isActivelyDrawing && currentDrawing) {
      // Update live preview rectangle
      const coords = screenToImageCoords(e.clientX, e.clientY);
      setCurrentDrawing(prev =>
        prev
          ? {
              ...prev,
              currentX: coords.x,
              currentY: coords.y,
            }
          : null
      );
    } else if (isDragging && !isDrawMode && zoomLevel > 1.0) {
      // Handle panning
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      const constrainedOffset = constrainPan({ x: newX, y: newY });
      setPanOffset(constrainedOffset);
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
    }
    // Drawing finalization is handled by handleClick instead
  };

  // Reset zoom function
  const handleZoomReset = useCallback(() => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
    setTransformOrigin({ x: 50, y: 50 });
  }, []);

  // Keyboard shortcuts using reusable hook - no memoization, simple and direct
  useKeyboardShortcuts(
    {
      onToggleDrawMode: () => {
        // When toggling draw mode, cancel any active drawing
        if (isDrawMode && isActivelyDrawing) {
          setCurrentDrawing(null);
          setIsActivelyDrawing(false);
        }
        const newDrawMode = !isDrawMode;
        setIsDrawMode(newDrawMode);
        onDrawModeChange(newDrawMode);
      },
      onTogglePredictions: () => onTogglePredictions(!showPredictions),
      onDeleteRectangle: () => {
        // Save current state to undo stack before deleting
        pushUndoState();

        // Smart delete: selected rectangle or all rectangles using pure utilities
        if (selectedRectangleId) {
          // Delete only the selected rectangle
          setDrawnRectangles(prev => removeRectangle(prev, selectedRectangleId));
          setSelectedRectangleId(null);
        } else {
          // Delete all rectangles when none selected
          setDrawnRectangles([]);
        }
      },
      onUndo: handleUndo,
      onSubmit: () => onSubmit(detection, buildReviewItems(), isDrawMode),
      onImportPredictions: importAIPredictions,
      onShowHelp: () => setShowKeyboardShortcuts(!showKeyboardShortcuts),
      onSelectWildfire: () => {
        if (selectedRectangleId !== null) {
          changeSelectedRectangleSmokeType('wildfire');
        } else {
          onSmokeTypeChange('wildfire');
        }
      },
      onSelectIndustrial: () => {
        if (selectedRectangleId !== null) {
          changeSelectedRectangleSmokeType('industrial');
        } else {
          onSmokeTypeChange('industrial');
        }
      },
      onSelectOther: () => {
        if (selectedRectangleId !== null) {
          changeSelectedRectangleSmokeType('other');
        } else {
          onSmokeTypeChange('other');
        }
      },
      onResetZoom: handleZoomReset,
    },
    {
      isDrawMode,
      isActivelyDrawing,
      hasSelectedRectangle: selectedRectangleId !== null,
      hasRectangles: drawnRectangles.length > 0,
      canUndo: undoStack.length > 0,
      showPredictions,
      isSubmitting,
      showKeyboardShortcuts,
    }
  );

  // Additional keyboard handlers for drawing-specific logic (not covered by the generic hook)
  useEffect(() => {
    const handleDrawingKeys = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        // R key for zoom reset
        handleZoomReset();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        // If shortcuts modal is open, let the hook handle it
        if (showKeyboardShortcuts) {
          return;
        }
        // Cancel current drawing if in progress
        if (isActivelyDrawing) {
          setCurrentDrawing(null);
          setIsActivelyDrawing(false);
          e.preventDefault();
        } else if (selectedRectangleId) {
          // Deselect rectangle if one is selected and not actively drawing
          setSelectedRectangleId(null);
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleDrawingKeys);
    return () => window.removeEventListener('keydown', handleDrawingKeys);
  }, [showKeyboardShortcuts, isActivelyDrawing, selectedRectangleId, handleZoomReset]);

  // Add non-passive wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const wheelHandler = (e: WheelEvent) => {
      // Create React-compatible wheel event wrapper
      const wheelEvent = e as unknown as React.WheelEvent;
      handleWheel(wheelEvent);
    };

    // Add with passive: false to allow preventDefault
    container.addEventListener('wheel', wheelHandler, { passive: false });

    return () => {
      container.removeEventListener('wheel', wheelHandler);
    };
  }, [handleWheel]);

  // Cursor style based on state
  const getCursorStyle = () => {
    if (isDrawMode) {
      return isActivelyDrawing ? 'crosshair' : 'crosshair';
    }
    if (zoomLevel <= 1.0) return 'default';
    return isDragging ? 'grabbing' : 'grab';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="relative w-full h-full flex items-center justify-center p-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors"
        >
          <X className="w-6 h-6 text-white" />
        </button>

        {/* Navigation buttons */}
        <button
          onClick={() => onNavigate('prev')}
          disabled={!canNavigatePrev}
          className={`absolute left-4 p-3 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors ${
            !canNavigatePrev ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>

        <button
          onClick={() => onNavigate('next')}
          disabled={!canNavigateNext}
          className={`absolute right-16 p-3 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors ${
            !canNavigateNext ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          <ChevronRight className="w-6 h-6 text-white" />
        </button>

        {/* Keyboard Shortcuts Info Button */}
        <button
          onClick={() => setShowKeyboardShortcuts(!showKeyboardShortcuts)}
          className="absolute top-4 left-4 p-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors backdrop-blur-sm z-50"
          title="Show keyboard shortcuts (? or H)"
        >
          <Keyboard className="w-4 h-4 text-white" />
        </button>

        {/* Model reference layers: master toggle + per-layer (engine dotted /
            auto dashed) toggles. Line style = layer, color = active smoke_type. */}
        <div className="absolute top-4 right-20 flex flex-col items-end space-y-1 z-50">
          <label className="flex items-center space-x-2 px-3 py-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-md text-xs font-medium text-white cursor-pointer backdrop-blur-sm">
            <input
              type="checkbox"
              checked={showPredictions}
              onChange={e => onTogglePredictions(e.target.checked)}
              className="w-3 h-3 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <span>Show predictions</span>
          </label>
          {showPredictions && (
            <div className="flex items-center space-x-1">
              <button
                type="button"
                disabled={!hasEngine}
                onClick={() => setShowEngine(v => !v)}
                title={hasEngine ? 'Engine predictions (dotted)' : 'No engine predictions'}
                className={`px-2 py-1 rounded text-[11px] font-medium backdrop-blur-sm border-b-2 border-dotted ${
                  showEngine ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'
                } ${!hasEngine ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                engine
              </button>
              <button
                type="button"
                disabled={!hasAuto}
                onClick={() => setShowAuto(v => !v)}
                title={hasAuto ? 'Auto predictions (dashed)' : 'No auto predictions'}
                className={`px-2 py-1 rounded text-[11px] font-medium backdrop-blur-sm border-b-2 border-dashed ${
                  showAuto ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'
                } ${!hasAuto ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                auto
              </button>
            </div>
          )}
        </div>

        {/* Image container */}
        <div className="relative max-w-7xl flex flex-col items-center">
          <DetectionAnnotationCanvas
            detection={detection}
            drawnRectangles={drawnRectangles}
            selectedRectangleId={selectedRectangleId}
            showPredictions={showPredictions}
            showEngine={showEngine}
            showAuto={showAuto}
            selectedSmokeType={selectedSmokeType}
            winningLayer={winningLayer}
            isDrawMode={isDrawMode}
            rejectedBoxes={rejectedBoxes}
            selectedModelBox={selectedModelBox}
            onSelectModelBox={handleSelectModelBox}
            onRejectModelBox={handleRejectModelBox}
            onAdjustModelBox={handleAdjustModelBox}
            currentDrawing={currentDrawing}
            containerRef={containerRef}
            imgRef={imgRef}
            imageInfo={imageInfo}
            zoomLevel={zoomLevel}
            panOffset={panOffset}
            transformOrigin={transformOrigin}
            isDragging={isDragging}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={handleClick}
            getCursorStyle={getCursorStyle}
            handleImageLoad={handleImageLoad}
            normalizedToImage={normalizedToImage}
            overlaysVisible={overlaysVisible}
          />

          {/* Control buttons - Bottom right */}
          <AnnotationToolbar
            isDrawMode={isDrawMode}
            isActivelyDrawing={isActivelyDrawing}
            onDrawModeToggle={() => {
              // Cancel any active drawing when toggling draw mode
              if (isDrawMode && isActivelyDrawing) {
                setCurrentDrawing(null);
                setIsActivelyDrawing(false);
              }
              const newDrawMode = !isDrawMode;
              setIsDrawMode(newDrawMode);
              onDrawModeChange(newDrawMode);
            }}
            selectedSmokeType={selectedSmokeType}
            onSmokeTypeChange={onSmokeTypeChange}
            drawnRectangles={drawnRectangles}
            selectedRectangleId={selectedRectangleId}
            onDeleteRectangles={() => {
              // Save current state to undo stack before deleting
              pushUndoState();

              if (selectedRectangleId) {
                // Delete only the selected rectangle using pure utility
                setDrawnRectangles(prev => removeRectangle(prev, selectedRectangleId));
                setSelectedRectangleId(null);
              } else {
                // Delete all rectangles when none selected
                setDrawnRectangles([]);
              }
            }}
            onImportPredictions={importAIPredictions}
            onResetZoom={handleZoomReset}
            canImportPredictions={getNewPredictionsCount() > 0}
            newPredictionsCount={getNewPredictionsCount()}
            zoomLevel={zoomLevel}
            onSelectedRectangleSmokeTypeChange={changeSelectedRectangleSmokeType}
          />
          {/* Detection info and submission controls */}
          <div className="mt-4 bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 text-white">
            <div className="flex items-center justify-center space-x-4 mb-4">
              <span className="font-medium">
                Detection {currentIndex + 1} of {totalCount}
              </span>
              <span className="text-gray-300">•</span>
              <span className="text-gray-300">
                {new Date(detection.recorded_at).toLocaleString()}
              </span>
              {isAnnotated && (
                <>
                  <span className="text-gray-300">•</span>
                  <span className="text-green-300 text-sm">✓ Annotated</span>
                </>
              )}
            </div>
          </div>

          <SubmissionControls
            isSubmitting={isSubmitting}
            isAnnotated={isAnnotated}
            onSubmit={() => onSubmit(detection, buildReviewItems(), isDrawMode)}
          />
        </div>

        {/* Keyboard Shortcuts Info Overlay */}
        <KeyboardShortcutsModal
          isVisible={showKeyboardShortcuts}
          onClose={() => setShowKeyboardShortcuts(false)}
          isDrawMode={isDrawMode}
          hasRectangles={drawnRectangles.length > 0}
          hasUndoHistory={undoStack.length > 0}
          isAnnotated={isAnnotated}
        />
      </div>
    </div>
  );
}
