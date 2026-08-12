/**
 * "One box on one frame": the drawing stage shared by `LocalizeObjectEditor`
 * and the add-object flow.
 *
 * Owns the plumbing that turns an <img> plus a container into a surface you
 * can draw a normalized box on — image geometry, zoom/pan, and the modeless
 * pointer handling — and nothing about what the box MEANS. Sources,
 * candidates, commits, filmstrips and gap frames all stay with the caller;
 * this hook only reports "the human put a box here".
 *
 * Extracted from `LocalizeObjectEditor`, verbatim, when the add-object flow
 * needed the same surface. Not `useDrawingCanvas`, which models many
 * rectangles with undo history and has never had a consumer.
 *
 * The canvas is modeless: a drag draws, space or a middle-drag pans, a click
 * selects or deselects. Nothing to arm, nothing to leave armed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  calculateImageBounds,
  screenToImageCoordinates,
  imageToNormalizedCoordinates,
  normalizedToImageCoordinates,
  moveBox,
  resizeBox,
  clampPan,
  cropToPan,
  type CurrentDrawing,
  type ImageBounds,
  type Point,
  type ResizeHandle,
  type StageView,
} from '@/utils/annotation';

export type Xyxyn = [number, number, number, number];

export interface ImageGeometry {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface BoxEditState {
  startClient: { x: number; y: number };
  orig: Xyxyn;
  mode: 'move' | 'resize';
  handle?: ResizeHandle;
  next: Xyxyn;
}

export interface UseBoxDrawingStageParams {
  containerRef: React.RefObject<HTMLDivElement>;
  imgRef: React.RefObject<HTMLImageElement>;
  /**
   * The box on the stage that may be moved or resized, or null when there is
   * none. Only this box responds to the box/handle pointer handlers.
   */
  editableBox: Xyxyn | null;
  /** Whether `editableBox` is selected — only a selected box can be dragged. */
  boxSelected: boolean;
  onBoxSelectedChange: (selected: boolean) => void;
  /** A finished drag, move or resize: the human's box, normalized. */
  onDrawn: (xyxyn: Xyxyn) => void;
  /**
   * Whether this frame accepts a new box. Default true — the editor always
   * does, including on a peeked gap frame, where drawing is what materializes
   * it.
   *
   * When false the surface is read-only: a press starts no rubber band and the
   * cursor stops offering one. Refusing only at mouse-up would let the drag
   * play out in full and then silently discard it, which reads as the drawing
   * being broken rather than unavailable.
   *
   * Panning is unaffected — moving the view is not editing.
   */
  canDraw?: boolean;
  /**
   * Changes whenever the <img> element may have appeared or been replaced —
   * the image URL, or the id of the frame on show. The canvas renders the
   * <img> only once its URL resolves, so on a cold open `imgRef` is still null
   * when the resize observer first tries to attach; this is what brings the
   * effect back to attach it.
   */
  imageKey?: string | number | null;
}

export interface BoxDrawingStage {
  imageInfo: ImageGeometry | null;
  handleImageLoad: () => void;
  zoomLevel: number;
  /** Pan, as a fraction of the image's rendered size. */
  panOffset: Point;
  isDragging: boolean;
  spaceHeld: boolean;
  currentDrawing: CurrentDrawing | null;
  boxEdit: BoxEditState | null;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
  handleBoxPointerDown: (e: React.MouseEvent) => void;
  handleHandlePointerDown: (handle: ResizeHandle, e: React.MouseEvent) => void;
  getCursorStyle: () => string;
  screenToImageCoords: (screenX: number, screenY: number) => Point;
  imageToNormalized: (imageX: number, imageY: number) => Point;
  normalizedToImage: (normX: number, normY: number) => Point;
  /** Back to the whole landscape, unzoomed and unpanned. */
  resetZoom: () => void;
  /** Frame the stage on a region — the cockpit's crop-mode math, applied. */
  applyView: (view: { scale: number; originX: number; originY: number }) => void;
  /** Drop the transient per-frame state when the stage changes frame. */
  resetTransient: () => void;
}

export function useBoxDrawingStage({
  containerRef,
  imgRef,
  editableBox,
  boxSelected,
  onBoxSelectedChange,
  onDrawn,
  canDraw = true,
  imageKey,
}: UseBoxDrawingStageParams): BoxDrawingStage {
  const [imageInfo, setImageInfo] = useState<ImageGeometry | null>(null);

  // One positional knob: the transform origin is the image's centre and all
  // framing lives in the pan, as a fraction of the image's rendered size.
  // Anchoring a zoom on the pointer is a solve for that one number; with an
  // origin as well it was two coupled unknowns, and the wheel resolved them
  // by throwing the framing away.
  const [view, setView] = useState<StageView>({ scale: 1, pan: { x: 0, y: 0 } });
  const [isDragging, setIsDragging] = useState(false);
  const [panStart, setPanStart] = useState<{ clientX: number; clientY: number; pan: Point } | null>(
    null
  );

  // The coordinate converters are plain functions and the wheel listener is
  // attached once; both read the view through here, so neither can be left
  // holding the one it was created with.
  const viewRef = useRef(view);
  viewRef.current = view;

  const [currentDrawing, setCurrentDrawing] = useState<CurrentDrawing | null>(null);
  // Space swaps the drag from drawing to panning, as it does in every other
  // image tool. Mirrored into a ref because mousedown reads it in the same
  // tick the keydown may have set it.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);

  const [boxEdit, setBoxEdit] = useState<BoxEditState | null>(null);
  const didDragBoxRef = useRef(false);

  // --- Zoom ---------------------------------------------------------------

  const resetZoom = useCallback(() => {
    setView({ scale: 1, pan: { x: 0, y: 0 } });
  }, []);

  const applyView = useCallback((crop: { scale: number; originX: number; originY: number }) => {
    setView(cropToPan(crop));
  }, []);

  const resetTransient = useCallback(() => {
    setCurrentDrawing(null);
    setBoxEdit(null);
  }, []);

  useEffect(() => {
    const setHeld = (held: boolean) => {
      spaceHeldRef.current = held;
      setSpaceHeld(held);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      // Space activates a focused button; only claim it elsewhere. The target
      // is only an Element when something is focused — a keydown dispatched at
      // the window itself has no `closest`.
      const target = e.target;
      if (target instanceof Element && target.closest('button, input, textarea')) return;
      e.preventDefault();
      setHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setHeld(false);
    };
    // A window that loses focus mid-hold never sees the keyup.
    const onBlur = () => setHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Non-passive so preventDefault works — the page behind must not scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView(v => ({
        scale: Math.max(1, Math.min(4, v.scale + (e.deltaY < 0 ? 0.2 : -0.2))),
        pan: { x: 0, y: 0 },
      }));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [containerRef]);

  // --- Coordinates --------------------------------------------------------

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img || !containerRef.current) return;
    // LAYOUT metrics, not getBoundingClientRect(): the rect is already scaled
    // by the zoom transform, and the overlays position themselves from these
    // numbers and then get the same transform applied on top. Measuring the
    // transformed rect while opening zoomed recorded a box three times too
    // large and pushed every overlay off the image. `constrainPan` avoids the
    // same trap for the same reason.
    setImageInfo({
      width: img.offsetWidth,
      height: img.offsetHeight,
      offsetX: img.offsetLeft,
      offsetY: img.offsetTop,
    });
  }, [imgRef, containerRef]);

  // Re-measure when the image's rendered size changes without a reload —
  // browser zoom (ctrl +/-) and window resizes both do that, and `load` does
  // not fire again. Every overlay is positioned from `imageInfo`, so a stale
  // measurement leaves the boxes drawn away from the smoke they mark. Same
  // reasoning, same pattern as `DetectionImageCard`.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (imgRef.current?.complete) handleImageLoad();
    });
    observer.observe(img);
    return () => observer.disconnect();
    // The canvas renders the <img> only once the URL resolves, so on a cold
    // open the ref is still null on the first pass — `imageKey` changing is
    // what brings us back to attach it then.
  }, [handleImageLoad, imgRef, imageKey]);

  const getImageInfo = (): {
    containerOffset: Point;
    imageBounds: ImageBounds;
    view: StageView;
  } | null => {
    if (!imgRef.current || !containerRef.current) return null;
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    return {
      containerOffset: { x: containerRect.left, y: containerRect.top },
      // LAYOUT metrics for the bounds — same trap as handleImageLoad: while
      // the open/close animation scales the editor root, the rect is the
      // transformed visual size, and overlays computed from it during that
      // window keep the garbage geometry after the animation ends.
      imageBounds: calculateImageBounds({
        containerWidth: container.offsetWidth,
        containerHeight: container.offsetHeight,
        imageNaturalWidth: imgRef.current.naturalWidth,
        imageNaturalHeight: imgRef.current.naturalHeight,
      }),
      // Through the ref, so a converter created on an earlier render still
      // reports where the cursor is in the view showing NOW.
      view: viewRef.current,
    };
  };

  const screenToImageCoords = (screenX: number, screenY: number): Point => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };
    return screenToImageCoordinates(
      { x: screenX, y: screenY },
      info.containerOffset,
      info.imageBounds,
      info.view
    );
  };

  const imageToNormalized = (imageX: number, imageY: number): Point => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };
    return imageToNormalizedCoordinates({ x: imageX, y: imageY }, info.imageBounds);
  };

  const normalizedToImage = (normX: number, normY: number): Point => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };
    return normalizedToImageCoordinates({ x: normX, y: normY }, info.imageBounds);
  };

  // --- Pointer ------------------------------------------------------------

  const handleBoxPointerDown = (e: React.MouseEvent) => {
    if (!editableBox) return;
    e.stopPropagation();
    // First click selects; only a selected box can be dragged, so a stray
    // click on it never nudges the annotation.
    if (!boxSelected) {
      onBoxSelectedChange(true);
      return;
    }
    didDragBoxRef.current = false;
    setBoxEdit({
      mode: 'move',
      startClient: { x: e.clientX, y: e.clientY },
      orig: editableBox,
      next: editableBox,
    });
  };

  const handleHandlePointerDown = (handle: ResizeHandle, e: React.MouseEvent) => {
    if (!editableBox) return;
    e.stopPropagation();
    didDragBoxRef.current = false;
    setBoxEdit({
      mode: 'resize',
      handle,
      startClient: { x: e.clientX, y: e.clientY },
      orig: editableBox,
      next: editableBox,
    });
  };

  /**
   * The canvas has no modes. A press that misses the box starts drawing one;
   * hold space or press the middle button to pan instead. Nothing to arm,
   * nothing to leave armed, and no state to misread — which is what made a
   * two-click draw dangerous once it was always available.
   */
  const handleMouseDown = (e: React.MouseEvent) => {
    didDragBoxRef.current = false;

    const wantsPan = spaceHeldRef.current || e.button === 1;
    if (wantsPan) {
      // Middle-press otherwise starts the browser's autoscroll.
      if (e.button === 1) e.preventDefault();
      if (view.scale > 1) {
        setIsDragging(true);
        setPanStart({ clientX: e.clientX, clientY: e.clientY, pan: view.pan });
      }
      return;
    }

    // No rubber band on a frame that cannot take a box: the drag must not
    // start at all, rather than start and be discarded on release.
    if (e.button !== 0 || !canDraw) return;
    const coords = screenToImageCoords(e.clientX, e.clientY);
    setCurrentDrawing({
      startX: coords.x,
      startY: coords.y,
      currentX: coords.x,
      currentY: coords.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (boxEdit && imgRef.current) {
      // Screen-px delta over the image's on-screen size: pan- and
      // origin-invariant, so the box tracks the cursor 1:1 at any zoom.
      const displayW = imgRef.current.offsetWidth * view.scale;
      const displayH = imgRef.current.offsetHeight * view.scale;
      const dx = (e.clientX - boxEdit.startClient.x) / displayW;
      const dy = (e.clientY - boxEdit.startClient.y) / displayH;
      const next =
        boxEdit.mode === 'move'
          ? moveBox(boxEdit.orig, dx, dy)
          : resizeBox(boxEdit.orig, boxEdit.handle as ResizeHandle, dx, dy);
      didDragBoxRef.current = true;
      setBoxEdit(prev => (prev ? { ...prev, next } : prev));
      return;
    }
    if (currentDrawing) {
      const coords = screenToImageCoords(e.clientX, e.clientY);
      setCurrentDrawing(prev =>
        prev ? { ...prev, currentX: coords.x, currentY: coords.y } : null
      );
    } else if (isDragging && panStart && imgRef.current) {
      // Screen px over the image's ON-SCREEN size. The pan lives inside the
      // scale, so dividing by width * scale is what makes the image track the
      // cursor 1:1; dividing by width alone would move it `scale` times
      // faster than the hand.
      const { offsetWidth, offsetHeight } = imgRef.current;
      setView(v => ({
        ...v,
        pan: clampPan(
          {
            x: panStart.pan.x + (e.clientX - panStart.clientX) / (offsetWidth * v.scale || 1),
            y: panStart.pan.y + (e.clientY - panStart.clientY) / (offsetHeight * v.scale || 1),
          },
          v.scale
        ),
      }));
    }
  };

  const handleMouseUp = () => {
    if (boxEdit) {
      // A finished move/resize is a human decision about where the box goes,
      // so it commits as a manual box.
      if (didDragBoxRef.current) onDrawn(boxEdit.next);
      setBoxEdit(null);
    }

    if (currentDrawing) {
      const start = imageToNormalized(currentDrawing.startX, currentDrawing.startY);
      const end = imageToNormalized(currentDrawing.currentX, currentDrawing.currentY);
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);
      const threshold = 10 / (imgRef.current?.offsetWidth || 1000);
      if (maxX - minX > threshold && maxY - minY > threshold) {
        onDrawn([minX, minY, maxX, maxY]);
      } else {
        // Too small to be a box, so it was a click: drop the selection, which
        // is what a press on the image away from the box means.
        onBoxSelectedChange(false);
      }
      setCurrentDrawing(null);
    }

    if (isDragging) {
      setIsDragging(false);
      setPanStart(null);
    }
  };

  const getCursorStyle = () => {
    if (spaceHeld) return isDragging ? 'grabbing' : 'grab';
    // A crosshair on a frame that cannot take a box promises a drawing
    // gesture that will not happen.
    return canDraw ? 'crosshair' : 'default';
  };

  return {
    imageInfo,
    handleImageLoad,
    zoomLevel: view.scale,
    panOffset: view.pan,
    isDragging,
    spaceHeld,
    currentDrawing,
    boxEdit,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleBoxPointerDown,
    handleHandlePointerDown,
    getCursorStyle,
    screenToImageCoords,
    imageToNormalized,
    normalizedToImage,
    resetZoom,
    applyView,
    resetTransient,
  };
}
