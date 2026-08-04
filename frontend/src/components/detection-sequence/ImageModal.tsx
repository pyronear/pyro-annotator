import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Keyboard } from 'lucide-react';
import { Detection, DetectionAnnotation, DetectionAnnotationBbox, SmokeType } from '@/types/api';
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
  updateRectangleSmokeType,
  removeRectangle,
  getWinningModelLayer,
  ModelLayer,
  materializeReviewAnnotation,
  moveBox,
  resizeBox,
  ResizeHandle,
} from '@/utils/annotation';
import {
  KeyboardShortcutsModal,
  AnnotationToolbar,
  SubmissionControls,
  DetectionAnnotationCanvas,
} from '@/components/detection-annotation';
import type { ObjectOverlayItem } from '@/components/annotation/ImageOverlays';
import { useKeyboardShortcuts } from '@/hooks/annotation';
import { formatDateTime } from '@/utils/datetime';

interface ImageModalProps {
  detection: Detection;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onSubmit: (
    detection: Detection,
    items: DetectionAnnotationBbox[],
    currentDrawMode: boolean,
    options?: { autoSave?: boolean }
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
  // Collocated localize context: the OTHER contributing objects' boxes on
  // this same frame (color + label). Additive and optional — when omitted
  // (legacy per-lane page), behavior is byte-unchanged (the generic
  // "sibling" others_bboxes layer still renders). See DetectionAnnotationCanvas.
  objectOverlays?: ObjectOverlayItem[];
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
  objectOverlays,
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
  // Exactly one model layer is shown at a time (default: the winning layer);
  // toggling to the other is for investigation.
  const [activeLayer, setActiveLayer] = useState<ModelLayer>(winningLayer);
  // Seed-at-submit review: per-box status on the winning layer. Indices refer
  // to the winning layer's prediction list.
  // rejected (✗): excluded from submit, shown dimmed. adjusted (✎): excluded
  // from submit AND hidden, because an editable human copy replaces it in place.
  const [rejectedBoxes, setRejectedBoxes] = useState<Set<number>>(new Set());
  const [adjustedBoxes, setAdjustedBoxes] = useState<Set<number>>(new Set());
  const [selectedModelBox, setSelectedModelBox] = useState<number | null>(null);
  // Drag-to-move / drag-to-resize of the selected drawn box.
  const [boxEdit, setBoxEdit] = useState<{
    id: string;
    mode: 'move' | 'resize';
    handle?: ResizeHandle;
    startClient: { x: number; y: number };
    orig: [number, number, number, number];
  } | null>(null);
  const didDragBoxRef = useRef(false);
  // Which detection's committed annotation has been loaded into drawnRectangles,
  // so a background refetch of the same detection doesn't clobber in-progress edits.
  const rectsLoadedFor = useRef<number | null>(null);
  // Reset to the winning layer only when the *detection* changes (navigation),
  // not when a background refetch repopulates the same detection's
  // auto_predictions — which would otherwise clobber a manual toggle mid-review.
  const layerInitFor = useRef<number | null>(null);
  useEffect(() => {
    if (layerInitFor.current === detection.id) return;
    layerInitFor.current = detection.id;
    const winning = getWinningModelLayer(detection);
    setActiveLayer(winning);
    setRejectedBoxes(new Set());
    setAdjustedBoxes(new Set());
    setSelectedModelBox(null);
  }, [detection]);

  // Winning model layer being reviewed (auto if present, else engine).
  const winningPredictions =
    winningLayer === 'auto'
      ? detection.auto_predictions?.predictions
      : detection.algo_predictions?.predictions;

  // A detection with a committed smoke annotation is being RE-opened: edit that
  // annotation directly (preserving each box's origin) instead of re-running
  // the accept-all-model-boxes seed, which would duplicate boxes on resubmit.
  const alreadyReviewed = (existingAnnotation?.annotation?.annotation ?? []).some(
    item => item.smoke_type != null
  );

  const handleSelectModelBox = (index: number) =>
    setSelectedModelBox(prev => (prev === index ? null : index));

  const handleRejectModelBox = (index: number) => {
    setRejectedBoxes(prev => new Set(prev).add(index));
    setSelectedModelBox(null);
  };

  const handleAdjustModelBox = (index: number) => {
    const box = winningPredictions?.[index];
    if (!box) return;
    pushUndoState();
    // Hide the original in place and seed an editable human copy at the same
    // spot (solid, selected, with resize handles) — the box "becomes editable".
    setAdjustedBoxes(prev => new Set(prev).add(index));
    const seeded: DrawnRectangle = {
      id: `adjust-${detection.id}-${index}`,
      xyxyn: box.xyxyn,
      smokeType: selectedSmokeType,
      origin: 'human',
    };
    setDrawnRectangles(prev => [...prev, seeded]);
    setSelectedRectangleId(seeded.id);
    setSelectedModelBox(null);
  };

  // Committed annotation for submit. First review: accepted winning boxes
  // (origin auto/engine) + human boxes − rejected/adjusted. Re-open: the drawn
  // boxes ARE the ground truth, each keeping its origin (edits mark it human);
  // model boxes are NOT re-accepted (they are already in the committed set).
  const buildReviewItems = (): DetectionAnnotationBbox[] => {
    if (alreadyReviewed) {
      return drawnRectangles.map(r => ({
        xyxyn: r.xyxyn,
        class_name: 'smoke',
        smoke_type: r.smokeType,
        origin: r.origin ?? 'human',
      }));
    }
    return materializeReviewAnnotation({
      winningBoxes: winningPredictions ?? [],
      winningLayer,
      rejected: new Set([...rejectedBoxes, ...adjustedBoxes]),
      humanRects: drawnRectangles,
      smokeType: selectedSmokeType,
    });
  };

  // Auto-save after a draw or box edit: the drawn boxes replace the model
  // layer (first review rejects every winning box; a re-opened committed
  // annotation already treats the drawn boxes as ground truth). The save
  // stays on the frame — no auto-advance.
  const autoSaveRects = (rects: DrawnRectangle[]) => {
    const items: DetectionAnnotationBbox[] = alreadyReviewed
      ? rects.map(r => ({
          xyxyn: r.xyxyn,
          class_name: 'smoke',
          smoke_type: r.smokeType,
          origin: r.origin ?? 'human',
        }))
      : materializeReviewAnnotation({
          winningBoxes: winningPredictions ?? [],
          winningLayer,
          rejected: new Set((winningPredictions ?? []).map((_, i) => i)),
          humanRects: rects,
          smokeType: selectedSmokeType,
        });
    if (!alreadyReviewed) {
      // Mirror the saved state in the review UI: model boxes are now rejected.
      setRejectedBoxes(new Set((winningPredictions ?? []).map((_, i) => i)));
    }
    onSubmit(detection, items, isDrawMode, { autoSave: true });
  };

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

    // Load the committed annotation into editable rectangles ONCE per detection
    // (the annotation may arrive async). A later identity change of
    // existingAnnotation (e.g. a background refetch) must NOT re-run this and
    // clobber in-progress edits — hence the rectsLoadedFor guard.
    if (rectsLoadedFor.current !== detection.id) {
      const items = existingAnnotation?.annotation?.annotation;
      const smokeItems = (items ?? []).filter(item => item.smoke_type != null);
      if (smokeItems.length > 0) {
        // false-positive items (no smoke_type) are not editable smoke rectangles.
        // Preserve each box's origin so re-submitting doesn't flip auto/engine -> human.
        setDrawnRectangles(
          smokeItems.map((item, index) => ({
            id: `existing-${index}`,
            xyxyn: item.xyxyn,
            smokeType: item.smoke_type as SmokeType,
            origin: item.origin ?? 'human',
          }))
        );
        rectsLoadedFor.current = detection.id;
      } else {
        setDrawnRectangles([]);
      }
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

  // --- Drag-to-move / drag-to-resize of the selected drawn box ---
  // Deltas are computed directly as (client px) / (image on-screen size), which
  // is pan- and origin-invariant and matches the rendered image at any zoom.
  const handleBoxPointerDown = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = drawnRectangles.find(r => r.id === id);
    if (!rect) return;
    setSelectedRectangleId(id);
    didDragBoxRef.current = false;
    setBoxEdit({
      id,
      mode: 'move',
      startClient: { x: e.clientX, y: e.clientY },
      orig: rect.xyxyn,
    });
  };

  const handleHandlePointerDown = (id: string, handle: ResizeHandle, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = drawnRectangles.find(r => r.id === id);
    if (!rect) return;
    setSelectedRectangleId(id);
    didDragBoxRef.current = false;
    setBoxEdit({
      id,
      mode: 'resize',
      handle,
      startClient: { x: e.clientX, y: e.clientY },
      orig: rect.xyxyn,
    });
  };

  // Change smoke type of selected rectangle using pure utility
  const changeSelectedRectangleSmokeType = (newSmokeType: SmokeType) => {
    if (!selectedRectangleId) return;

    pushUndoState();
    setDrawnRectangles(prev =>
      updateRectangleSmokeType(prev, selectedRectangleId, newSmokeType).map(r =>
        // re-typing a box is a human classification decision
        r.id === selectedRectangleId ? { ...r, origin: 'human' } : r
      )
    );
  };

  // Note: coordinatesMatch function replaced with direct call to areBoundingBoxesSimilar

  // Get count of new predictions using pure utility
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

      if (!imgRef.current) return;

      // Zoom around the image centre so the pan bounds stay symmetric.
      // (Cursor-anchored zoom made the constraint asymmetric and let the image
      // slide out of view.)
      setTransformOrigin({ x: 50, y: 50 });

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

    // Use the LAYOUT size (offsetWidth), not getBoundingClientRect() which is
    // already scaled by the transform. The pan is applied INSIDE the scale
    // (`scale(z) translate(t)` -> screen shift = z*t), so the max pan offset
    // that keeps the image covering its box is baseSize*(z-1)/(2*z).
    const baseW = imgRef.current.offsetWidth;
    const baseH = imgRef.current.offsetHeight;
    const maxPanX = (baseW * (zoomLevel - 1)) / (2 * zoomLevel);
    const maxPanY = (baseH * (zoomLevel - 1)) / (2 * zoomLevel);

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, offset.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, offset.y)),
    };
  };

  // Re-clamp the pan whenever zoom changes so zooming out never leaves the
  // image partly out of view.
  useEffect(() => {
    setPanOffset(prev => constrainPan(prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel]);

  // Click-based drawing and panning handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Clear a stale drag flag left over from a drag that ended off-canvas
    // (onMouseLeave -> mouseUp fires with no trailing click), so this fresh
    // interaction's click isn't swallowed.
    didDragBoxRef.current = false;
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

    // A move/resize drag just finished — don't treat the trailing click as a
    // select/draw/deselect.
    if (didDragBoxRef.current) {
      didDragBoxRef.current = false;
      return;
    }

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

          const nextRects = [...drawnRectangles, newRect];
          setDrawnRectangles(nextRects);
          // Drawing commits immediately: the drawn boxes are the kept ones.
          autoSaveRects(nextRects);
        }
      }

      // Reset drawing state
      setCurrentDrawing(null);
      setIsActivelyDrawing(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (boxEdit && imgRef.current) {
      // Screen-px delta / image on-screen size (offset size * zoom) -> normalized
      // delta. Independent of pan and transform-origin, so it tracks the cursor
      // 1:1 at any zoom/pan.
      const displayW = imgRef.current.offsetWidth * zoomLevel;
      const displayH = imgRef.current.offsetHeight * zoomLevel;
      const dx = (e.clientX - boxEdit.startClient.x) / displayW;
      const dy = (e.clientY - boxEdit.startClient.y) / displayH;
      const next =
        boxEdit.mode === 'move'
          ? moveBox(boxEdit.orig, dx, dy)
          : resizeBox(boxEdit.orig, boxEdit.handle as ResizeHandle, dx, dy);
      if (!didDragBoxRef.current) {
        pushUndoState();
        didDragBoxRef.current = true;
      }
      setDrawnRectangles(prev =>
        // A moved/resized box is now human-owned (matters when editing a
        // re-opened committed annotation; a no-op for fresh first-review boxes).
        prev.map(r => (r.id === boxEdit.id ? { ...r, xyxyn: next, origin: 'human' } : r))
      );
      return;
    }
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
    if (boxEdit) {
      setBoxEdit(null);
      // A finished move/resize re-saves so the committed boxes track the edit.
      if (didDragBoxRef.current) {
        autoSaveRects(drawnRectangles);
      }
    }
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

  // Keyboard zoom (+/-), same 0.2 step / 1x-4x clamp as the wheel handler.
  const handleZoomIn = useCallback(() => {
    setZoomLevel(z => Math.min(4.0, Math.round((z + 0.2) * 10) / 10));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel(z => {
      const next = Math.max(1.0, Math.round((z - 0.2) * 10) / 10);
      if (next === 1.0) {
        setPanOffset({ x: 0, y: 0 });
        setTransformOrigin({ x: 50, y: 50 });
      }
      return next;
    });
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
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
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
            <div className="flex items-center rounded overflow-hidden text-[11px] font-medium backdrop-blur-sm">
              <button
                type="button"
                disabled={!hasEngine}
                onClick={() => setActiveLayer('engine')}
                title={hasEngine ? 'Show engine predictions (dotted)' : 'No engine predictions'}
                className={`px-2 py-1 border-b-2 border-dotted ${
                  activeLayer === 'engine' ? 'bg-white/25 text-white' : 'bg-white/5 text-gray-400'
                } ${!hasEngine ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                engine
              </button>
              <button
                type="button"
                disabled={!hasAuto}
                onClick={() => setActiveLayer('auto')}
                title={hasAuto ? 'Show auto predictions (dashed)' : 'No auto predictions'}
                className={`px-2 py-1 border-b-2 border-dashed ${
                  activeLayer === 'auto' ? 'bg-white/25 text-white' : 'bg-white/5 text-gray-400'
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
            activeLayer={activeLayer}
            selectedSmokeType={selectedSmokeType}
            objectOverlays={objectOverlays}
            winningLayer={winningLayer}
            isDrawMode={isDrawMode}
            reviewInteractive={!alreadyReviewed}
            rejectedBoxes={rejectedBoxes}
            hiddenBoxes={adjustedBoxes}
            selectedModelBox={selectedModelBox}
            onSelectModelBox={handleSelectModelBox}
            onRejectModelBox={handleRejectModelBox}
            onAdjustModelBox={handleAdjustModelBox}
            onBoxPointerDown={handleBoxPointerDown}
            onHandlePointerDown={handleHandlePointerDown}
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
            onResetZoom={handleZoomReset}
            zoomLevel={zoomLevel}
            onSelectedRectangleSmokeTypeChange={changeSelectedRectangleSmokeType}
          />
          {/* Detection info and submission controls */}
          <div className="mt-4 bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 text-white">
            <div className="flex items-center justify-center space-x-4 mb-4">
              <span className="font-medium">
                Frame {currentIndex + 1} of {totalCount}
              </span>
              <span className="text-gray-300">•</span>
              <span className="text-gray-300">{formatDateTime(detection.recorded_at)}</span>
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
