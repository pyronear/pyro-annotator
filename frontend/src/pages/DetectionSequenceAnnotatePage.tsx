import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Keyboard, Upload } from 'lucide-react';
import { useSequenceDetections } from '@/hooks/useSequenceDetections';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import {
  analyzeSequenceAccuracy,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  getModelAccuracyBadgeClasses,
  parseFalsePositiveTypes
} from '@/utils/modelAccuracy';
import { Detection, DetectionAnnotation, SmokeType } from '@/types/api';
import { createDefaultFilterState } from '@/hooks/usePersistedFilters';

// New imports for refactored utilities
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
  calculateAnnotationCompleteness,
  importPredictionsAsRectangles,
  updateRectangleSmokeType,
  removeRectangle
} from '@/utils/annotation';
import { BoundingBoxOverlay, DrawingOverlay } from '@/components/annotation/ImageOverlays';
import { DetectionImageCard, KeyboardShortcutsModal, AnnotationToolbar } from '@/components/detection-annotation';
import { useKeyboardShortcuts } from '@/hooks/annotation';

interface ImageModalProps {
  detection: Detection;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onSubmit: (detection: Detection, drawnRectangles: DrawnRectangle[], currentDrawMode: boolean) => void;
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

function ImageModal({
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
  isAutoAdvance
}: ImageModalProps) {
  const { data: imageData } = useDetectionImage(detection.id);
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

      console.log('handleImageLoad called for detection:', detection.id, { width, height, offsetX, offsetY });
      setImageInfo({
        width: width,
        height: height,
        offsetX: offsetX,
        offsetY: offsetY
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
      console.log('Detection changed, starting transition:', detection.id);
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

            console.log('Fallback imageInfo calculation:', { width, height, offsetX, offsetY });
            setImageInfo({
              width: width,
              height: height,
              offsetX: offsetX,
              offsetY: offsetY
            });

            // Complete transition: fade overlays back in
            setTimeout(() => {
              setOverlaysVisible(true);
              setIsTransitioning(false);
            }, 50); // Small delay to ensure imageInfo is set
          } else {
            console.log('Fallback skipped - image not loaded yet:', { imgWidth: imgRect.width, imgHeight: imgRect.height });
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
      const existingRects: DrawnRectangle[] = existingAnnotation.annotation.annotation.map((item, index) => ({
        id: `existing-${index}`,
        xyxyn: item.xyxyn,
        smokeType: item.smoke_type
      }));
      setDrawnRectangles(existingRects);
    } else {
      setDrawnRectangles([]);
    }
  }, [detection.id, existingAnnotation, isAutoAdvance]);

  // Get current image and container information for coordinate transformations
  const getImageInfo = (): { containerOffset: Point; imageBounds: ImageBounds; transform: { zoomLevel: number; panOffset: Point; transformOrigin: Point } } | null => {
    if (!imgRef.current || !containerRef.current) return null;

    const containerRect = containerRef.current.getBoundingClientRect();
    const img = imgRef.current;

    const containerOffset: Point = {
      x: containerRect.left,
      y: containerRect.top
    };

    const imageBounds = calculateImageBounds({
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      imageNaturalWidth: img.naturalWidth,
      imageNaturalHeight: img.naturalHeight
    });

    const transform = {
      zoomLevel,
      panOffset,
      transformOrigin
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

    return imageToNormalizedCoordinates(
      { x: imageX, y: imageY },
      info.imageBounds
    );
  };

  // Wrapper function for normalized to image coordinates
  const normalizedToImage = (normX: number, normY: number) => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };

    return normalizedToImageCoordinates(
      { x: normX, y: normY },
      info.imageBounds
    );
  };

  // Hit testing function using pure utilities
  const getRectAtPoint = (x: number, y: number): DrawnRectangle | null => {
    const info = getImageInfo();
    if (!info) return null;

    return getRectangleAtPoint(
      { x, y },
      drawnRectangles,
      info.imageBounds
    );
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
      const button = document.querySelector('button[title*="All AI predictions already imported"]') as HTMLElement;
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
    console.log(`✅ Imported ${newRectangles.length} AI predictions as ${selectedSmokeType} smoke`);
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
  const handleWheel = (e: React.WheelEvent) => {
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
  };

  // Pan boundary constraint helper
  const constrainPan = (offset: { x: number, y: number }) => {
    if (!imgRef.current || zoomLevel <= 1) return offset;

    const imgRect = imgRef.current.getBoundingClientRect();
    const scaledWidth = imgRect.width * zoomLevel;
    const scaledHeight = imgRect.height * zoomLevel;

    // Calculate max pan distance to keep image centered in viewport
    const maxPanX = (scaledWidth - imgRect.width) / 2;
    const maxPanY = (scaledHeight - imgRect.height) / 2;

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, offset.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, offset.y))
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
        currentY: coords.y
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
        if ((maxX - minX) > sizeThreshold && (maxY - minY) > sizeThreshold) {
          // Save current state to undo stack before adding rectangle
          pushUndoState();

          const newRect: DrawnRectangle = {
            id: Date.now().toString(),
            xyxyn: [minX, minY, maxX, maxY],
            smokeType: selectedSmokeType
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
      setCurrentDrawing(prev => prev ? {
        ...prev,
        currentX: coords.x,
        currentY: coords.y
      } : null);
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
  const handleZoomReset = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
    setTransformOrigin({ x: 50, y: 50 });
  };

  // Keyboard shortcuts using reusable hook - no memoization, simple and direct
  useKeyboardShortcuts({
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
    onSubmit: () => onSubmit(detection, drawnRectangles, isDrawMode),
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
    onResetZoom: handleZoomReset
  }, {
    isDrawMode,
    isActivelyDrawing,
    hasSelectedRectangle: selectedRectangleId !== null,
    hasRectangles: drawnRectangles.length > 0,
    canUndo: undoStack.length > 0,
    showPredictions,
    isSubmitting,
    showKeyboardShortcuts
  });

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
      handleWheel(e as any); // Cast to React.WheelEvent for compatibility
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
          className={`absolute left-4 p-3 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors ${!canNavigatePrev ? 'opacity-40 cursor-not-allowed' : ''
            }`}
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>

        <button
          onClick={() => onNavigate('next')}
          disabled={!canNavigateNext}
          className={`absolute right-16 p-3 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors ${!canNavigateNext ? 'opacity-40 cursor-not-allowed' : ''
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

        {/* Predictions Toggle */}
        <label className="absolute top-4 right-20 flex items-center space-x-2 px-3 py-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-md text-xs font-medium text-white cursor-pointer backdrop-blur-sm">
          <input
            type="checkbox"
            checked={showPredictions}
            onChange={(e) => onTogglePredictions(e.target.checked)}
            className="w-3 h-3 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
          />
          <span>Show predictions</span>
        </label>

        {/* Image container */}
        <div className="relative max-w-7xl flex flex-col items-center">
          {imageData?.url ? (
            <div
              ref={containerRef}
              className="relative overflow-hidden"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onClick={handleClick}
              style={{ cursor: getCursorStyle() }}
            >
              <img
                ref={imgRef}
                src={imageData.url}
                alt={`Detection ${detection.id}`}
                className="max-w-full max-h-[95vh] object-contain block"
                style={{
                  transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
                  transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                }}
                onLoad={handleImageLoad}
              />

              {/* Bounding Boxes Overlay */}
              <div
                className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 ease-in-out"
                style={{
                  transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
                  transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out, opacity 0.3s ease-in-out',
                  opacity: showPredictions && imageInfo && overlaysVisible ? 1 : 0,
                  pointerEvents: showPredictions && imageInfo && overlaysVisible ? 'none' : 'none'
                }}
              >
                {showPredictions && imageInfo && (
                  <BoundingBoxOverlay detection={detection} imageInfo={imageInfo} />
                )}
              </div>

              {/* Drawing Overlay */}
              <div
                className="absolute inset-0 z-20 transition-opacity duration-300 ease-in-out"
                style={{
                  opacity: imageInfo && overlaysVisible ? 1 : 0
                }}
              >
                {imageInfo && (
                  <DrawingOverlay
                    drawnRectangles={drawnRectangles}
                    currentDrawing={currentDrawing}
                    selectedRectangleId={selectedRectangleId}
                    imageInfo={imageInfo}
                    zoomLevel={zoomLevel}
                    panOffset={panOffset}
                    transformOrigin={transformOrigin}
                    isDragging={isDragging || isActivelyDrawing}
                    normalizedToImage={normalizedToImage}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="w-96 h-96 bg-gray-800 flex items-center justify-center rounded-lg">
              <span className="text-gray-400">No image available</span>
            </div>
          )}

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

          {/* Detection info */}
          <div className="mt-4 bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 text-white">
            <div className="flex items-center justify-center space-x-4">
              <span className="font-medium">Detection {currentIndex + 1} of {totalCount}</span>
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

            {/* Submit Button - Centered below info */}
            <div className="flex justify-center mt-4">
              <button
                onClick={() => onSubmit(detection, drawnRectangles, isDrawMode)}
                disabled={isSubmitting}
                className="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    {isAnnotated ? 'Updating...' : 'Submitting...'}
                  </>
                ) : (
                  <>
                    {isAnnotated ? 'Update' : 'Submit'}
                    <span className="ml-2 text-xs text-primary-200">(Space)</span>
                  </>
                )}
              </button>
            </div>
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
    </div>
  );
}

// Helper function for context-aware annotation status
const getIsAnnotated = (annotation: DetectionAnnotation | undefined, fromContext: string | null): boolean => {
  if (fromContext === 'detections-review') {
    // Review context: optimistically assume completed unless explicitly not
    if (!annotation) return true; // Loading state: assume completed
    return annotation.processing_stage === 'annotated' || annotation.processing_stage === 'bbox_annotation';
  } else {
    // Annotate context: conservatively assume pending unless explicitly completed
    return annotation?.processing_stage === 'annotated';
  }
};

export default function DetectionSequenceAnnotatePage() {
  const { sequenceId, detectionId } = useParams<{ sequenceId: string; detectionId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sequenceIdNum = sequenceId ? parseInt(sequenceId, 10) : null;

  const [selectedDetectionIndex, setSelectedDetectionIndex] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [detectionAnnotations, setDetectionAnnotations] = useState<Map<number, DetectionAnnotation>>(new Map());
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showPredictions, setShowPredictions] = useState(false);

  // Persistent smoke type selection across detections
  const [persistentSmokeType, setPersistentSmokeType] = useState<SmokeType>('wildfire');

  // Track drawing mode state across auto-advance navigation
  const [persistentDrawMode, setPersistentDrawMode] = useState(false);
  const isAutoAdvanceRef = useRef(false);

  // Detect source page from URL search params
  const [searchParams] = useSearchParams();
  const fromParam = searchParams.get('from');

  // Determine source page and appropriate filter storage key
  const sourcePage = fromParam === 'detections-review' ? 'review' : 'annotate';
  const filterStorageKey = sourcePage === 'review' ? 'filters-detections-review' : 'filters-detections-annotate';

  // Load persisted filters from the appropriate source page
  const sourcePageFilters = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    let storedFilters = null;
    try {
      const stored = localStorage.getItem(filterStorageKey);
      if (stored) {
        storedFilters = JSON.parse(stored);
      }
    } catch (error) {
      console.warn(`[DetectionSequenceAnnotate] Failed to read filters from localStorage key "${filterStorageKey}":`, error);
    }

    // Always return something (either stored filters or defaults)
    const defaultState = {
      ...createDefaultFilterState('annotated'),
      filters: {
        ...createDefaultFilterState('annotated').filters,
        detection_annotation_completion: sourcePage === 'review' ? 'complete' as const : 'incomplete' as const,
        include_detection_stats: true,
        processing_stage: 'annotated' as const,
      },
    };

    return storedFilters || defaultState;
  }, [filterStorageKey, sourcePage]);

  const { data: detections, isLoading, error } = useSequenceDetections(sequenceIdNum);

  // Helper functions to map between detection ID and array index
  const getDetectionIndexById = (detectionId: number): number | null => {
    if (!detections) return null;
    const index = detections.findIndex(detection => detection.id === detectionId);
    return index >= 0 ? index : null;
  };

  const getDetectionIdByIndex = (index: number): number | null => {
    if (!detections || index < 0 || index >= detections.length) return null;
    return detections[index].id;
  };

  // Fetch sequence data for header info
  const { data: sequence } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(sequenceIdNum!),
    queryFn: () => apiClient.getSequence(sequenceIdNum!),
    enabled: !!sequenceIdNum,
  });

  // Fetch sequence annotation to check the sequence-level annotation status
  const { data: sequenceAnnotationResponse } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, 'by-sequence', sequenceIdNum],
    queryFn: async () => {
      const response = await apiClient.getSequenceAnnotations({ sequence_id: sequenceIdNum!, size: 1 });
      return response.items[0] || null;
    },
    enabled: !!sequenceIdNum,
  });

  const sequenceAnnotation = sequenceAnnotationResponse;

  // Fetch all sequences for navigation using filters from the source page
  const { data: rawSequences, isLoading: rawSequencesLoading, error: rawSequencesError } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'navigation-context', sourcePage, sourcePageFilters?.filters],
    queryFn: () => {
      // Always provide a fallback query - use stored filters if available, otherwise use basic filters
      const baseFilters = {
        detection_annotation_completion: sourcePage === 'review' ? 'complete' as const : 'incomplete' as const,
        include_detection_stats: true,
        processing_stage: 'annotated' as const,
        size: 100, // Backend maximum limit is 100 - may limit navigation with large datasets
      };

      if (sourcePageFilters?.filters) {
        // Use stored filters with size override (backend maximum is 100)
        return apiClient.getSequences({
          ...sourcePageFilters.filters,
          size: 100,
        });
      } else {
        // Fallback to basic filters
        return apiClient.getSequences(baseFilters);
      }
    },
    // Remove the restrictive enabled condition - always try to load navigation data
    retry: 3, // Add retry for robustness
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch sequence annotations for model accuracy filtering (if applicable)
  const { data: allSequenceAnnotations } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, 'navigation-context', rawSequences?.items?.map(s => s.id), sourcePageFilters?.selectedModelAccuracy],
    queryFn: async () => {
      if (!rawSequences?.items?.length) {
        return [];
      }

      // Only fetch annotations if model accuracy filtering is needed
      const modelAccuracy = sourcePageFilters?.selectedModelAccuracy;
      if (!modelAccuracy || modelAccuracy === 'all') {
        return [];
      }

      const annotationPromises = rawSequences.items.map(sequence =>
        apiClient.getSequenceAnnotations({ sequence_id: sequence.id, size: 1 })
          .then(response => ({ sequenceId: sequence.id, annotation: response.items[0] || null }))
          .catch(error => {
            console.warn(`Failed to fetch annotation for sequence ${sequence.id}:`, error);
            return { sequenceId: sequence.id, annotation: null };
          })
      );

      return Promise.all(annotationPromises);
    },
    enabled: !!rawSequences?.items?.length,
    retry: 2,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Apply client-side model accuracy filtering (similar to DetectionAnnotatePage and DetectionReviewPage)
  const allSequences = useMemo(() => {
    if (!rawSequences) {
      return null;
    }

    const modelAccuracy = sourcePageFilters?.selectedModelAccuracy;
    if (!modelAccuracy || modelAccuracy === 'all') {
      return rawSequences;
    }

    if (!allSequenceAnnotations) {
      return rawSequences; // Return unfiltered if annotations not loaded yet
    }

    const annotationMap = allSequenceAnnotations.reduce((acc, { sequenceId, annotation }) => {
      acc[sequenceId] = annotation;
      return acc;
    }, {} as Record<number, any>);

    const filtered = rawSequences.items.filter(sequence => {
      const annotation = annotationMap[sequence.id];
      if (!annotation) {
        return modelAccuracy === 'unknown';
      }

      const accuracy = analyzeSequenceAccuracy({
        ...sequence,
        annotation: annotation
      });

      return accuracy.type === modelAccuracy;
    });

    return {
      ...rawSequences,
      items: filtered,
      total: filtered.length,
      pages: Math.ceil(filtered.length / rawSequences.size)
    };
  }, [rawSequences, allSequenceAnnotations, sourcePageFilters?.selectedModelAccuracy]);

  // Fetch existing detection annotations for this sequence
  const { data: existingAnnotations } = useQuery({
    queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS, 'by-sequence', sequenceIdNum],
    queryFn: async () => {
      const response = await apiClient.getDetectionAnnotations({
        sequence_id: sequenceIdNum!,
        size: 100
      });
      return response.items;
    },
    enabled: !!sequenceIdNum,
  });

  // Initialize detection annotations map when data loads
  useEffect(() => {
    if (existingAnnotations) {
      const annotationsMap = new Map<number, DetectionAnnotation>();
      existingAnnotations.forEach(annotation => {
        annotationsMap.set(annotation.detection_id, annotation);
      });
      setDetectionAnnotations(annotationsMap);
    }
  }, [existingAnnotations]);

  // Save detection annotations mutation
  const saveAnnotations = useMutation({
    mutationFn: async () => {
      if (!detections) return;

      // Update annotations for all detections (should already exist from sequence annotation)
      const promises = detections.map(async (detection) => {
        const existingAnnotation = detectionAnnotations.get(detection.id);

        if (existingAnnotation) {
          // Update existing annotation to 'annotated' stage
          if (existingAnnotation.processing_stage !== 'annotated') {
            return apiClient.updateDetectionAnnotation(existingAnnotation.id, {
              processing_stage: 'annotated',
            });
          }
        } else {
          // No annotation exists - skip this detection with a warning
          console.warn(`No detection annotation found for detection ${detection.id}. Skipping.`);
          return null;
        }
      });

      const results = await Promise.all(promises);
      return results.filter(Boolean); // Remove null results
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS] });
      // Invalidate sequences queries for both annotate and review pages
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.SEQUENCES, 'detection-annotate'] });
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.SEQUENCES, 'detection-review'] });
      // Invalidate navigation context queries
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.SEQUENCES, 'navigation-context'] });
      // Invalidate annotation counts to update sidebar badges
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
      setToastMessage('Detection annotations saved successfully');
      setShowToast(true);

      // Auto-advance to next sequence or navigate back after a short delay
      setTimeout(() => {
        // Check if there's a next sequence to auto-advance to
        const currentIndex = getCurrentSequenceIndex();
        if (currentIndex >= 0 && allSequences?.items && currentIndex < allSequences.items.length - 1) {
          // Auto-advance to next filtered sequence
          const nextSequence = allSequences.items[currentIndex + 1];
          const sourceParam = fromParam ? `?from=${fromParam}` : '';
          navigate(`/detections/${nextSequence.id}/annotate${sourceParam}`);
        } else {
          // No next sequence, return to appropriate source page
          const backPath = sourcePage === 'review' ? '/detections/review' : '/detections/annotate';
          navigate(backPath);
        }
      }, 1500);
    },
    onError: () => {
      setToastMessage('Failed to save annotations');
      setShowToast(true);
    },
  });

  // Individual detection annotation mutation
  const annotateIndividualDetection = useMutation({
    mutationFn: async ({ detection, drawnRectangles }: { detection: Detection; drawnRectangles: DrawnRectangle[] }) => {
      const existingAnnotation = detectionAnnotations.get(detection.id);

      if (existingAnnotation) {
        // Convert drawn rectangles to annotation format
        const annotationItems = drawnRectangles.map(rect => ({
          xyxyn: rect.xyxyn,
          class_name: "smoke",
          smoke_type: rect.smokeType
        }));

        // Update existing annotation with proper annotation data and 'annotated' stage
        return apiClient.updateDetectionAnnotation(existingAnnotation.id, {
          annotation: {
            annotation: annotationItems
          },
          processing_stage: 'annotated',
        });
      } else {
        // No annotation exists - this shouldn't happen if sequence annotation was submitted first
        // But in case it does, throw an error to guide the user
        throw new Error(`No detection annotation found for detection ${detection.id}. Please ensure the sequence annotation has been submitted first to auto-create detection annotations.`);
      }
    },
    onSuccess: (result, { detection }) => {
      // Update local state
      setDetectionAnnotations(prev => new Map(prev).set(detection.id, result));

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS] });
      // Invalidate sequences queries for both annotate and review pages
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.SEQUENCES, 'detection-annotate'] });
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.SEQUENCES, 'detection-review'] });
      // Invalidate navigation context queries
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.SEQUENCES, 'navigation-context'] });
      // Invalidate annotation counts to update sidebar badges
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });

      setToastMessage(`Detection ${detection.id} annotated successfully`);
      setShowToast(true);

      // Auto-advance to next detection if available
      if (selectedDetectionIndex !== null && detections && selectedDetectionIndex < detections.length - 1) {
        // Mark as auto-advance (drawing mode already stored in onSubmit above)
        isAutoAdvanceRef.current = true;

        // Move to next detection
        const nextDetectionId = getDetectionIdByIndex(selectedDetectionIndex + 1);
        if (nextDetectionId && sequenceId) {
          navigate(`/detections/${sequenceId}/annotate/${nextDetectionId}`);
        }
      } else if (selectedDetectionIndex !== null && detections && selectedDetectionIndex === detections.length - 1) {
        // At last detection - close modal after a brief delay to show success message
        setTimeout(() => {
          if (sequenceId) {
            navigate(`/detections/${sequenceId}/annotate`);
          }
        }, 1000);
      }
    },
    onError: (_, { detection }) => {
      setToastMessage(`Failed to annotate detection ${detection.id}`);
      setShowToast(true);
    },
  });

  const handleBack = () => {
    const backPath = sourcePage === 'review' ? '/detections/review' : '/detections/annotate';
    navigate(backPath);
  };

  const handleSave = () => {
    saveAnnotations.mutate();
  };

  // Navigation logic
  const getCurrentSequenceIndex = () => {
    if (!allSequences?.items || !sequenceIdNum) return -1;
    return allSequences.items.findIndex(seq => seq.id === sequenceIdNum);
  };

  const canNavigatePrevious = () => {
    const currentIndex = getCurrentSequenceIndex();
    return currentIndex > 0;
  };

  const canNavigateNext = () => {
    const currentIndex = getCurrentSequenceIndex();
    return currentIndex >= 0 && allSequences?.items && currentIndex < allSequences.items.length - 1;
  };

  const handlePreviousSequence = () => {
    const currentIndex = getCurrentSequenceIndex();
    if (currentIndex > 0 && allSequences?.items) {
      const prevSequence = allSequences.items[currentIndex - 1];
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${prevSequence.id}/annotate${sourceParam}`);
    }
  };

  const handleNextSequence = () => {
    const currentIndex = getCurrentSequenceIndex();
    if (currentIndex >= 0 && allSequences?.items && currentIndex < allSequences.items.length - 1) {
      const nextSequence = allSequences.items[currentIndex + 1];
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${nextSequence.id}/annotate${sourceParam}`);
    }
  };

  const openModal = (index: number) => {
    const detectionId = getDetectionIdByIndex(index);
    if (detectionId && sequenceId) {
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${sequenceId}/annotate/${detectionId}${sourceParam}`);
    }
  };

  const closeModal = () => {
    if (sequenceId) {
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${sequenceId}/annotate${sourceParam}`);
    }
  };

  const navigateModal = (direction: 'prev' | 'next') => {
    if (!detections || selectedDetectionIndex === null || !sequenceId) return;

    const newIndex = direction === 'prev'
      ? Math.max(0, selectedDetectionIndex - 1)
      : Math.min(detections.length - 1, selectedDetectionIndex + 1);

    const newDetectionId = getDetectionIdByIndex(newIndex);
    if (newDetectionId) {
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${sequenceId}/annotate/${newDetectionId}${sourceParam}`);
    }
  };

  // State restoration based on URL parameters
  useEffect(() => {
    if (detectionId && detections) {
      const detectionIdNum = parseInt(detectionId, 10);
      const index = getDetectionIndexById(detectionIdNum);

      if (index !== null) {
        // Valid detection ID found - open modal to this detection
        setSelectedDetectionIndex(index);
        setShowModal(true);
      } else {
        // Invalid detection ID - redirect to base URL
        console.warn(`Invalid detection ID ${detectionId} for sequence ${sequenceId}`);
        if (sequenceId) {
          navigate(`/detections/${sequenceId}/annotate`, { replace: true });
        }
      }
    } else if (!detectionId) {
      // No detection ID in URL - ensure modal is closed
      setShowModal(false);
      setSelectedDetectionIndex(null);
    }
  }, [detectionId, detections, sequenceId, navigate, getDetectionIndexById]);

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Submit with Enter key
      if (e.key === 'Enter' && !showModal) {
        handleSave();
        e.preventDefault();
        return;
      }

      // Toggle predictions visibility with 'p' key (works globally, whether modal is open or not)
      if (e.key === 'p' || e.key === 'P') {
        setShowPredictions(!showPredictions);
        e.preventDefault();
        return;
      }

      // Modal navigation and submission
      if (showModal && selectedDetectionIndex !== null && detections) {
        if (e.key === 'Escape') {
          // Only close main modal if no child modals are handling the escape
          // The ImageModal will handle its own escape logic first
          closeModal();
          e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
          navigateModal('prev');
          e.preventDefault();
        } else if (e.key === 'ArrowRight') {
          navigateModal('next');
          e.preventDefault();
        } else if (e.key === ' ' && !annotateIndividualDetection.isPending) {
          // Space bar submission is handled by the ImageModal's own keyboard handler
          // which has access to the actual drawnRectangles state. This is just a fallback
          // that shouldn't normally execute since modal handles Space key first.
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, selectedDetectionIndex, detections, detectionAnnotations, annotateIndividualDetection, showPredictions]);

  // Reset auto-advance flag after navigation
  useEffect(() => {
    if (selectedDetectionIndex !== null && isAutoAdvanceRef.current) {
      // Reset the flag after the modal has had a chance to read it
      const timer = setTimeout(() => {
        isAutoAdvanceRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedDetectionIndex]);

  // Toast auto-dismiss
  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showToast]);

  // Helper function to check if all detection annotations are in visual_check stage
  const areAllInVisualCheckStage = () => {
    if (!detections || detections.length === 0) return false;

    const annotationValues = Array.from(detectionAnnotations.values());

    // All detections must have annotations and all must be in visual_check stage
    return detections.length === annotationValues.length &&
      annotationValues.every(annotation => annotation.processing_stage === 'visual_check');
  };

  // Calculate progress using pure utility function
  const progressStats = detections
    ? calculateAnnotationCompleteness(detections, detectionAnnotations)
    : { annotatedDetections: 0, totalDetections: 0, completionPercentage: 0, isComplete: false, hasAnnotations: false };

  const { annotatedDetections, totalDetections, completionPercentage } = progressStats;
  const annotatedCount = annotatedDetections;
  const totalCount = totalDetections;
  const allInVisualCheck = areAllInVisualCheckStage();

  // Helper to get annotation pills
  const getAnnotationPills = () => {
    if (!sequenceAnnotation) return null;

    const pills = [];

    if (sequenceAnnotation.has_smoke) {
      pills.push(
        <span key="smoke" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          Smoke
        </span>
      );
    }

    if (sequenceAnnotation.has_missed_smoke) {
      pills.push(
        <span key="missed" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
          Missed Smoke
        </span>
      );
    }

    if (sequenceAnnotation.has_false_positives) {
      // Add individual false positive type pills
      const falsePositiveTypes = parseFalsePositiveTypes(sequenceAnnotation.false_positive_types);

      falsePositiveTypes.forEach((type: string) => {
        pills.push(
          <span
            key={`fp-${type}`}
            className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
          >
            {getFalsePositiveEmoji(type)} {formatFalsePositiveType(type)}
          </span>
        );
      });
    }

    if (!sequenceAnnotation.has_smoke && !sequenceAnnotation.has_missed_smoke && !sequenceAnnotation.has_false_positives) {
      pills.push(
        <span key="no-smoke" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          No Smoke
        </span>
      );
    }

    return pills;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center space-x-4">
          <div className="w-8 h-8 bg-gray-200 animate-pulse rounded"></div>
          <div className="h-8 w-64 bg-gray-200 animate-pulse rounded"></div>
        </div>

        {/* Grid skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-video bg-gray-200 animate-pulse rounded-lg"></div>
              <div className="h-4 bg-gray-200 animate-pulse rounded"></div>
              <div className="h-3 w-24 bg-gray-200 animate-pulse rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load detections</p>
          <p className="text-gray-500 text-sm">{String(error)}</p>
          <button
            onClick={handleBack}
            className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!detections || detections.length === 0) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center space-x-4">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Detection Annotations</h1>
            <p className="text-gray-600">Sequence {sequenceId}</p>
          </div>
        </div>

        {/* Empty state */}
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            <div className="text-4xl mb-4">🔍</div>
            <p className="text-lg font-medium mb-2">No detections found</p>
            <p className="text-gray-500">This sequence doesn't have any detections to annotate.</p>
            <button
              onClick={handleBack}
              className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm transition-colors"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isAllAnnotated = annotatedCount === totalCount;

  return (
    <>
      {/* Fixed Header */}
      <div className={`fixed top-0 left-0 md:left-64 right-0 backdrop-blur-sm shadow-sm z-30 ${isAllAnnotated
        ? 'bg-green-50/90 border-b border-green-200 border-l-4 border-l-green-500'
        : 'bg-white/85 border-b border-gray-200'
        }`}>
        <div className="px-10 py-3">
          {/* Top Row: Context + Action Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={handleBack}
                className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75"
                title="Back to sequences"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-900">
                  {sequence?.organisation_name || 'Loading...'}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-sm text-gray-600">
                  {sequence?.camera_name || 'Loading...'}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-sm text-gray-600">
                  {sequence?.recorded_at ? new Date(sequence.recorded_at).toLocaleString() : 'Loading...'}
                </span>
                {sequence?.azimuth !== null && sequence?.azimuth !== undefined && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {sequence.azimuth}°
                    </span>
                  </>
                )}
                {sequence?.lat !== null && sequence?.lat !== undefined && sequence?.lon !== null && sequence?.lon !== undefined && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {sequence.lat.toFixed(3)}, {sequence.lon.toFixed(3)}
                    </span>
                  </>
                )}

                {/* Sequence context */}
                {rawSequencesLoading ? (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500 animate-pulse">
                      Loading sequences...
                    </span>
                  </>
                ) : rawSequencesError ? (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-red-500">
                      Error loading sequences
                    </span>
                  </>
                ) : allSequences && allSequences.total > 0 ? (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-blue-600 font-medium">
                      Sequence {getCurrentSequenceIndex() + 1} of {allSequences.total}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      No sequences found
                    </span>
                  </>
                )}

                {/* Completion Badge */}
                {isAllAnnotated && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="inline-flex items-center text-xs text-green-600 font-medium">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Completed
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Navigation Buttons */}
              {rawSequencesLoading ? (
                <>
                  <button
                    disabled
                    className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                    title="Loading sequences..."
                  >
                    <ChevronLeft className="w-4 h-4 animate-pulse" />
                  </button>
                  <button
                    disabled
                    className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                    title="Loading sequences..."
                  >
                    <ChevronRight className="w-4 h-4 animate-pulse" />
                  </button>
                </>
              ) : rawSequencesError ? (
                <>
                  <button
                    disabled
                    className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                    title="Error loading sequences"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    disabled
                    className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                    title="Error loading sequences"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handlePreviousSequence}
                    disabled={!canNavigatePrevious()}
                    className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={canNavigatePrevious() ? "Previous sequence" : "Already at first sequence"}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleNextSequence}
                    disabled={!canNavigateNext()}
                    className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={canNavigateNext() ? "Next sequence" : "Already at last sequence"}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}

              {/* Predictions Toggle */}
              <label className="flex items-center space-x-2 px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPredictions}
                  onChange={(e) => setShowPredictions(e.target.checked)}
                  className="w-3 h-3 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span>Show predictions</span>
              </label>

              {allInVisualCheck && (
                <button
                  onClick={handleSave}
                  disabled={saveAnnotations.isPending}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Submit all detection annotations (Enter) - All flagged as false positive sequences"
                >
                  {saveAnnotations.isPending ? (
                    <div className="w-3 h-3 mr-1 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Upload className="w-3 h-3 mr-1" />
                  )}
                  Submit All
                </button>
              )}
            </div>
          </div>

          {/* Bottom Row: Progress + Model Accuracy + Annotation Pills */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center space-x-4">
              <span className="text-xs font-medium text-gray-900">
                Review: {isAllAnnotated ? (
                  <span className="text-green-600">Done</span>
                ) : (
                  <span className="text-orange-600">Pending</span>
                )} • {annotatedCount} of {totalCount} detections • {completionPercentage}% complete
              </span>

              {/* Model Accuracy Context */}
              {sequence && sequenceAnnotation && (
                <div className="flex items-center space-x-2">
                  {(() => {
                    const accuracy = analyzeSequenceAccuracy({
                      ...sequence,
                      annotation: sequenceAnnotation
                    });
                    return (
                      <span className={getModelAccuracyBadgeClasses(accuracy, 'sm')}>
                        {accuracy.icon} {accuracy.label}
                      </span>
                    );
                  })()}
                </div>
              )}

              {/* Annotation pills */}
              <div className="flex items-center space-x-2">
                {getAnnotationPills()}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {isAllAnnotated ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-orange-500" />
              )}
              <div className="w-24 bg-gray-200 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${isAllAnnotated ? 'bg-green-600' : 'bg-primary-600'
                    }`}
                  style={{ width: `${completionPercentage}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content with top padding to account for fixed header */}
      <div className="space-y-6 pt-20">
        {/* Detection Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {detections.map((detection, index) => (
            <DetectionImageCard
              key={detection.id}
              detection={detection}
              onClick={() => openModal(index)}
              isAnnotated={getIsAnnotated(detectionAnnotations.get(detection.id), fromParam)}
              showPredictions={showPredictions}
              userAnnotation={detectionAnnotations.get(detection.id) || null}
            />
          ))}
        </div>
      </div>

      {/* Image Modal */}
      {showModal && selectedDetectionIndex !== null && detections[selectedDetectionIndex] && (
        <ImageModal
          detection={detections[selectedDetectionIndex]}
          onClose={closeModal}
          onNavigate={navigateModal}
          onSubmit={(detection, drawnRectangles, currentDrawMode) => {
            // Store current drawing mode state before auto-advancing
            setPersistentDrawMode(currentDrawMode);
            annotateIndividualDetection.mutate({ detection, drawnRectangles });
          }}
          onTogglePredictions={setShowPredictions}
          canNavigatePrev={selectedDetectionIndex > 0}
          canNavigateNext={selectedDetectionIndex < detections.length - 1}
          currentIndex={selectedDetectionIndex}
          totalCount={detections.length}
          showPredictions={showPredictions}
          isSubmitting={annotateIndividualDetection.isPending}
          isAnnotated={getIsAnnotated(detectionAnnotations.get(detections[selectedDetectionIndex].id), fromParam)}
          existingAnnotation={detectionAnnotations.get(detections[selectedDetectionIndex].id)}
          selectedSmokeType={persistentSmokeType}
          onSmokeTypeChange={setPersistentSmokeType}
          persistentDrawMode={persistentDrawMode}
          onDrawModeChange={setPersistentDrawMode}
          isAutoAdvance={isAutoAdvanceRef.current}
        />
      )}

      {/* Toast Notification */}
      {showToast && (
        <div className={`fixed top-24 right-4 z-50 transition-all duration-300 ease-in-out transform ${showToast ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
          }`}>
          <div className="px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 min-w-80 bg-green-50 border border-green-200">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">{toastMessage}</span>
          </div>
        </div>
      )}
    </>
  );
}
