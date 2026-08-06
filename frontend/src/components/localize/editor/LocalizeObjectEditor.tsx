/**
 * The localize object editor: one object, one frame, one box.
 *
 * Replaces `ImageModal`. The screen answers a single question — "is this
 * object's box on this frame right, and if not, what should it be?" — so it
 * offers at most three candidates (manual, auto, engine), commits exactly
 * one, and autosaves every action. There is no submit button and no dirty
 * state: stepping frames never writes, and everything else writes at once.
 *
 * Alert submit stays on the cockpit's rail. Accepting the model on the rest of
 * THIS object is offered here too, routed to the same mutation the rail's own
 * per-object action uses, so a sweep can finish where it started.
 *
 * The canvas is modeless: a drag draws, space or a middle-drag pans, a click
 * selects or deselects.
 *
 * See docs/specs/2026-08-05-localize-object-editor-revamp-design.md — the
 * spec's design, plus the changes that came out of using it (listed in its
 * "Amendments from use" section).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Keyboard, Crop } from 'lucide-react';
import type {
  Detection,
  DetectionAnnotation,
  DetectionAnnotationBbox,
  SmokeType,
} from '@/types/api';
import {
  boxCandidates,
  candidateToBbox,
  committedBox,
  hasModelEvidence,
  priorityPick,
  type BoxCandidate,
} from '@/utils/annotation/objectBoxCandidates';
import { buildFilmstripEntries, type FilmstripEntry } from '@/utils/annotation/objectFilmstrip';
import { computeCellCrop } from '@/utils/annotation/gridCropUtils';
import type { AlertFrame } from '@/utils/annotation/alertLocalizeUtils';
import {
  calculateImageBounds,
  screenToImageCoordinates,
  imageToNormalizedCoordinates,
  normalizedToImageCoordinates,
  moveBox,
  resizeBox,
  type CurrentDrawing,
  type ImageBounds,
  type Point,
  type ResizeHandle,
} from '@/utils/annotation';
import type { ObjectOverlayItem } from '@/components/annotation/ImageOverlays';
import { DetectionAnnotationCanvas } from '@/components/detection-annotation';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { formatDateTime } from '@/utils/datetime';
import { collectLaneBoxes } from '@/utils/annotation/quickSubmitUtils';
import { AcceptRemainingPopover } from './AcceptRemainingPopover';
import { BoxSourceRail } from './BoxSourceRail';
import { EditorShortcutsModal } from './EditorShortcutsModal';
import { ObjectFilmstrip } from './ObjectFilmstrip';

/**
 * Framing for the stage's zoom-to-object view. Looser than the grid's own
 * defaults on both axes: the object should read clearly without the sky and
 * ridge around it disappearing, since "is this box on the right plume?" is
 * answered by the surroundings, not by the box.
 */
const OBJECT_FRAMING = { targetFill: 0.32, maxScale: 3 };

/** What the idle stage draws; `G` cycles it. A rail hover overrides it. */
type BoxVisibility = 'pick' | 'all' | 'none';

export interface LocalizeObjectEditorProps {
  /** The object being edited. */
  laneSequenceId: number;
  objectLabel: string;
  objectColor: string;
  smokeType: SmokeType;
  /** The frame currently open. Always one of this lane's detections. */
  detection: Detection;
  existingAnnotation: DetectionAnnotation | null;
  /** This lane's detections, chronological. */
  laneDetections: Detection[];
  /** This lane's committed annotations. */
  laneAnnotations: DetectionAnnotation[];
  /** Every frame of the alert, across all lanes — the filmstrip's range. */
  alertFrames: AlertFrame[];
  /** Other objects' boxes on this frame; rendered as identity overlays. */
  objectOverlays: ObjectOverlayItem[];
  isSaving: boolean;
  /** True while the bulk accept is in flight. */
  isAccepting: boolean;
  /** Commit one box, or none. Autosaves; success is silent. */
  onCommit: (detection: Detection, items: DetectionAnnotationBbox[]) => void;
  /** Navigate to another of THIS lane's detections; drives the URL. */
  onNavigateToDetection: (detectionId: number) => void;
  /**
   * Draw on a gap frame (issue #287): materialize a Detection in this lane at
   * recordedAt, then commit the drawn box to it. The page owns the two-call
   * flow and the navigation to the new detection.
   */
  onCommitGapFrame: (recordedAt: string, items: DetectionAnnotationBbox[]) => void;
  /**
   * Remove a model-evidence-free frame from the lane entirely (issue #287's
   * un-materialize) — Clear, for a frame whose only reason to exist is a
   * human's box.
   */
  onUnmaterialize: (detection: Detection) => void;
  /**
   * Commit the winning model box on every frame of this object that has
   * none. Never overwrites a frame the annotator already decided.
   */
  onAcceptRemaining: () => void;
  /** Hand this object's classification back to the classify cockpit. */
  onReclassify: () => void;
  onClose: () => void;
}

export function LocalizeObjectEditor({
  laneSequenceId,
  objectLabel,
  objectColor,
  smokeType,
  detection,
  existingAnnotation,
  laneDetections,
  laneAnnotations,
  alertFrames,
  objectOverlays,
  isSaving,
  isAccepting,
  onCommit,
  onCommitGapFrame,
  onUnmaterialize,
  onNavigateToDetection,
  onAcceptRemaining,
  onReclassify,
  onClose,
}: LocalizeObjectEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [imageInfo, setImageInfo] = useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Zoom / pan — lifted from ImageModal unchanged; that plumbing is sound.
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 });
  const [transformOrigin, setTransformOrigin] = useState<Point>({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const [currentDrawing, setCurrentDrawing] = useState<CurrentDrawing | null>(null);
  // Space swaps the drag from drawing to panning, as it does in every other
  // image tool. Mirrored into a ref because mousedown reads it in the same
  // tick the keydown may have set it.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);

  // `G` cycles what the idle stage draws: the default pick, every candidate
  // at once, or nothing at all — the bare plume.
  const [boxVisibility, setBoxVisibility] = useState<BoxVisibility>('pick');
  // A rail row being hovered or focused: the stage shows only that candidate.
  const [previewed, setPreviewed] = useState<BoxCandidate | null>(null);
  // The OTHER objects' boxes on this frame, off by default. On this screen
  // color means *source* (manual/auto/engine), and the object-identity
  // palette overlaps it closely enough that a blue dashed box would be
  // ambiguous between "the engine's proposal for your object" and "Object
  // 1's committed box". The question they answer — is that plume already
  // someone else's? — is better served by the cockpit grid behind, and
  // becomes primary only when ADDING an object (issue #287's sibling work).
  const [showOtherObjects, setShowOtherObjects] = useState(false);
  // Opens framed on the object rather than on the whole landscape: the frame
  // is 16:9 of mostly sky and ridge, and judging a box means seeing the plume.
  // Generously though — see OBJECT_FRAMING — because the context around it is
  // what tells you the box is on the RIGHT plume. R drops back to full frame.
  const [cropView, setCropView] = useState(true);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const acceptAnchorRef = useRef<HTMLDivElement>(null);

  // The committed box is unselected on arrival: it renders in its own
  // smoke-type color and shows no handles until you click it. Selection is
  // what reveals the move/resize affordances.
  const [boxSelected, setBoxSelected] = useState(false);

  const [boxEdit, setBoxEdit] = useState<{
    startClient: { x: number; y: number };
    orig: [number, number, number, number];
    mode: 'move' | 'resize';
    handle?: ResizeHandle;
    next: [number, number, number, number];
  } | null>(null);
  const didDragBoxRef = useRef(false);

  const { data: imageData } = useDetectionImage(detection.id);
  const queryClient = useQueryClient();

  // Read by the keyboard handler; kept in refs so a save (which changes the
  // committed box) doesn't re-bind the window listener.
  const clearRef = useRef<() => void>(() => undefined);
  const committedRef = useRef<BoxCandidate | null>(null);

  // --- The object's box on this frame -------------------------------------

  const candidates = useMemo(
    () => boxCandidates(detection, existingAnnotation),
    [detection, existingAnnotation]
  );
  const committed = useMemo(() => committedBox(existingAnnotation), [existingAnnotation]);
  // A live drag renders from `boxEdit.next` so the box tracks the cursor
  // before the save round-trips.
  const shownCommitted: BoxCandidate | null = boxEdit
    ? { source: 'manual', index: 0, xyxyn: boxEdit.next }
    : committed;
  const losers = candidates.filter(
    c => !(shownCommitted && c.source === shownCommitted.source && c.index === shownCommitted.index)
  );

  /**
   * The stage draws one box, well. With a box committed, that box alone
   * speaks for the object; with nothing committed the priority pick ghosts
   * in — the box Enter would commit — and the rail's crops carry the
   * comparison with the rest. `G` cycles to "all" (every candidate stacked,
   * on demand) and "none" (the bare plume).
   */
  // A preview never interrupts an interaction already underway on the canvas.
  const activePreview = boxEdit || currentDrawing ? null : previewed;
  const pick = priorityPick(candidates);
  const stageCommitted = activePreview || boxVisibility === 'none' ? null : shownCommitted;
  const ghosts = activePreview
    ? [activePreview]
    : boxVisibility === 'none'
      ? []
      : boxVisibility === 'all'
        ? losers
        : shownCommitted
          ? []
          : pick
            ? [pick]
            : [];
  committedRef.current = committed;

  const entries = useMemo(
    () => buildFilmstripEntries(alertFrames, laneSequenceId, laneDetections, laneAnnotations),
    [alertFrames, laneSequenceId, laneDetections, laneAnnotations]
  );

  /**
   * A frame outside this object's range, held locally. The route requires
   * `:detectionId` to belong to `:laneId`, and a gap frame has no detection
   * in this lane, so the URL cannot name it without weakening the guard that
   * makes an inconsistent editor link detectable at all. Peeking is therefore
   * component state; the URL keeps naming the last in-object frame. Drawing
   * on one routes through `onCommitGapFrame`, which materializes the frame
   * (issue #287).
   */
  const [peeked, setPeeked] = useState<FilmstripEntry | null>(null);

  // The URL owns in-range frames, so a change to it means the user navigated
  // for real and any peek is stale.
  useEffect(() => setPeeked(null), [detection.id]);

  const editable = peeked === null;

  // --- Commit -------------------------------------------------------------

  // Every write also drops any live preview. A commit can disable the very
  // row being hovered (Enter with one candidate), and a disabled button never
  // fires mouseleave — without this the stage would keep a dashed read-only
  // ghost where the freshly committed box should be.
  const commitCandidate = useCallback(
    (candidate: BoxCandidate) => {
      setPreviewed(null);
      onCommit(detection, [candidateToBbox(candidate, smokeType)]);
    },
    [detection, smokeType, onCommit]
  );

  const commitDrawn = useCallback(
    (xyxyn: [number, number, number, number]) => {
      setPreviewed(null);
      const items = [candidateToBbox({ source: 'manual', index: 0, xyxyn }, smokeType)];
      if (peeked) onCommitGapFrame(peeked.recordedAt, items);
      else onCommit(detection, items);
    },
    [peeked, detection, smokeType, onCommit, onCommitGapFrame]
  );

  const clear = useCallback(() => {
    setPreviewed(null);
    // A frame with no model evidence exists only because a human boxed it;
    // clearing removes the frame itself (issue #287's un-materialize).
    if (hasModelEvidence(detection)) onCommit(detection, []);
    else onUnmaterialize(detection);
  }, [detection, onCommit, onUnmaterialize]);

  clearRef.current = clear;

  // --- Navigation ---------------------------------------------------------

  const currentEntryIndex = peeked
    ? entries.findIndex(en => en.recordedAt === peeked.recordedAt)
    : entries.findIndex(en => en.detectionId === detection.id);

  const goToEntry = useCallback(
    (entry: FilmstripEntry) => {
      if (entry.inObject) {
        setPeeked(null);
        onNavigateToDetection(entry.detectionId);
      } else {
        // Peeking disables the rail in place, so no mouseleave will ever
        // release a preview — and detection.id doesn't change, so the
        // frame-change reset won't either. Drop it here or it comes back
        // stale on return.
        setPreviewed(null);
        setPeeked(entry);
      }
    },
    [onNavigateToDetection]
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      const next = entries[currentEntryIndex + direction];
      if (next) goToEntry(next);
    },
    [entries, currentEntryIndex, goToEntry]
  );

  const acceptAndNext = useCallback(() => {
    if (!editable) return;
    const pick = priorityPick(candidates);
    if (!pick) return;
    commitCandidate(pick);
    step(1);
  }, [editable, candidates, commitCandidate, step]);

  // --- Zoom ---------------------------------------------------------------

  const resetZoom = useCallback(() => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setTransformOrigin({ x: 50, y: 50 });
  }, []);

  const constrainPan = useCallback(
    (offset: Point): Point => {
      if (!imgRef.current || zoomLevel <= 1) return offset;
      // Layout size, not the transformed rect: the pan applies INSIDE the
      // scale, so the max offset keeping the image covering its box is
      // baseSize*(z-1)/(2z).
      const maxPanX = (imgRef.current.offsetWidth * (zoomLevel - 1)) / (2 * zoomLevel);
      const maxPanY = (imgRef.current.offsetHeight * (zoomLevel - 1)) / (2 * zoomLevel);
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, offset.x)),
        y: Math.max(-maxPanY, Math.min(maxPanY, offset.y)),
      };
    },
    [zoomLevel]
  );

  useEffect(() => {
    setPanOffset(prev => constrainPan(prev));
  }, [constrainPan]);

  // `Z`: frame the object rather than the landscape. `computeCellCrop` is the
  // cockpit's own crop-mode math, and its output maps straight onto the
  // canvas's existing zoom/transform-origin props — no second render path.
  useEffect(() => {
    if (!cropView) {
      resetZoom();
      return;
    }
    const boxes = committed ? [committed] : candidates;
    if (boxes.length === 0) return;
    const crop = computeCellCrop(boxes, OBJECT_FRAMING);
    setZoomLevel(crop.scale);
    setPanOffset({ x: 0, y: 0 });
    setTransformOrigin({ x: crop.originX, y: crop.originY });
    // Re-frames on frame change too, since the object moves between frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropView, detection.id]);

  // Navigating to another frame resets the transient per-frame state.
  useEffect(() => {
    setCurrentDrawing(null);
    setBoxEdit(null);
    setBoxSelected(false);
    setBoxVisibility('pick');
    setPreviewed(null);
    // `imageInfo` deliberately survives the change. Every frame of an alert
    // comes from one camera at one size and lands in the same box, so the
    // previous geometry stays correct; clearing it unmounted every overlay
    // until the next image fired onLoad, which read as the boxes blinking out
    // on each arrow press. `handleImageLoad` refreshes it either way.
  }, [detection.id]);

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

  // --- Coordinates --------------------------------------------------------

  const handleImageLoad = () => {
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
  };

  const getImageInfo = (): {
    containerOffset: Point;
    imageBounds: ImageBounds;
    transform: { zoomLevel: number; panOffset: Point; transformOrigin: Point };
  } | null => {
    if (!imgRef.current || !containerRef.current) return null;
    const containerRect = containerRef.current.getBoundingClientRect();
    return {
      containerOffset: { x: containerRect.left, y: containerRect.top },
      imageBounds: calculateImageBounds({
        containerWidth: containerRect.width,
        containerHeight: containerRect.height,
        imageNaturalWidth: imgRef.current.naturalWidth,
        imageNaturalHeight: imgRef.current.naturalHeight,
      }),
      transform: { zoomLevel, panOffset, transformOrigin },
    };
  };

  const screenToImageCoords = (screenX: number, screenY: number): Point => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };
    return screenToImageCoordinates(
      { x: screenX, y: screenY },
      info.containerOffset,
      info.imageBounds,
      info.transform
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
    if (!shownCommitted) return;
    e.stopPropagation();
    // First click selects; only a selected box can be dragged, so a stray
    // click on it never nudges the annotation.
    if (!boxSelected) {
      setBoxSelected(true);
      return;
    }
    didDragBoxRef.current = false;
    setBoxEdit({
      mode: 'move',
      startClient: { x: e.clientX, y: e.clientY },
      orig: shownCommitted.xyxyn,
      next: shownCommitted.xyxyn,
    });
  };

  const handleHandlePointerDown = (handle: ResizeHandle, e: React.MouseEvent) => {
    if (!shownCommitted) return;
    e.stopPropagation();
    didDragBoxRef.current = false;
    setBoxEdit({
      mode: 'resize',
      handle,
      startClient: { x: e.clientX, y: e.clientY },
      orig: shownCommitted.xyxyn,
      next: shownCommitted.xyxyn,
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
      if (zoomLevel > 1) {
        setIsDragging(true);
        setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      }
      return;
    }

    if (e.button !== 0) return;
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
      const displayW = imgRef.current.offsetWidth * zoomLevel;
      const displayH = imgRef.current.offsetHeight * zoomLevel;
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
    } else if (isDragging && zoomLevel > 1) {
      setPanOffset(constrainPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }));
    }
  };

  const handleMouseUp = () => {
    if (boxEdit) {
      // A finished move/resize is a human decision about where the box goes,
      // so it commits as a manual box.
      if (didDragBoxRef.current) commitDrawn(boxEdit.next);
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
        commitDrawn([minX, minY, maxX, maxY]);
      } else {
        // Too small to be a box, so it was a click: drop the selection, which
        // is what a press on the image away from the box means.
        setBoxSelected(false);
      }
      setCurrentDrawing(null);
    }

    if (isDragging) setIsDragging(false);
  };

  // Clicks resolve on mouse-up, where the drag's size decides whether it was a
  // box or a deselect; this only keeps the press from escaping the editor.
  const handleClick = (e: React.MouseEvent) => e.stopPropagation();

  const getCursorStyle = () => {
    if (spaceHeld) return isDragging ? 'grabbing' : 'grab';
    return 'crosshair';
  };

  // Warm the frames either side, so an arrow press swaps to a bitmap the
  // browser has already decoded rather than to an empty <img>. Prefetching
  // through the query client rather than `useImagePreloader` on purpose: that
  // hook holds its cache in state and re-renders this component on every
  // image it resolves, which is the opposite of what a flicker fix wants.
  useEffect(() => {
    const neighbours = [entries[currentEntryIndex - 1], entries[currentEntryIndex + 1]]
      .filter(Boolean)
      .map(entry => entry.detectionId)
      .filter(id => id > 0);

    for (const id of neighbours) {
      queryClient
        .fetchQuery({
          queryKey: [...QUERY_KEYS.DETECTION_IMAGE, id],
          queryFn: () => apiClient.getDetectionImageUrl(id),
          staleTime: 5 * 60 * 1000,
        })
        .then(data => {
          if (data?.url) new Image().src = data.url;
        })
        .catch(() => undefined);
    }
  }, [entries, currentEntryIndex, queryClient]);

  useEffect(() => {
    if (!acceptOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!acceptAnchorRef.current?.contains(event.target as Node)) setAcceptOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [acceptOpen]);

  // Non-passive so preventDefault works — the page behind must not scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTransformOrigin({ x: 50, y: 50 });
      setZoomLevel(z => {
        const next = Math.max(1, Math.min(4, z + (e.deltaY < 0 ? 0.2 : -0.2)));
        if (next === 1) setPanOffset({ x: 0, y: 0 });
        return next;
      });
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // --- Keyboard -----------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.contentEditable === 'true')
      )
        return;

      switch (e.key) {
        case 'ArrowLeft':
          step(-1);
          break;
        case 'ArrowRight':
          step(1);
          break;
        case 'Enter':
          acceptAndNext();
          break;
        case 'Delete':
        case 'Backspace':
          // Removes whatever is committed, not only a hand-drawn box — the
          // same action the Clear button performs, which for a model box is
          // the review's "reject". A no-op on a frame with nothing committed
          // or one outside the object's range.
          if (!editable || !committedRef.current) return;
          clearRef.current();
          break;
        case 'g':
        case 'G':
          setBoxVisibility(v => (v === 'pick' ? 'all' : v === 'all' ? 'none' : 'pick'));
          break;
        case 'o':
        case 'O':
          setShowOtherObjects(v => !v);
          break;
        case 'z':
        case 'Z':
          setCropView(v => !v);
          break;
        case 'r':
        case 'R':
          setCropView(false);
          resetZoom();
          break;
        case '?':
          setShortcutsOpen(open => !open);
          break;
        case 'Escape':
          // Unwind one layer at a time: close what is open, then cancel a
          // drawing, then drop the selection, and only then leave.
          if (shortcutsOpen) {
            setShortcutsOpen(false);
          } else if (acceptOpen) {
            setAcceptOpen(false);
          } else if (boxSelected) {
            setBoxSelected(false);
          } else {
            onClose();
          }
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, acceptAndNext, boxSelected, acceptOpen, shortcutsOpen, resetZoom, onClose, editable]);

  // --- Render -------------------------------------------------------------

  // Frames of this object that a bulk accept would fill, and frames it
  // cannot — no source offers a box there, so they stay empty and keep the
  // alert off the submit gate.
  const acceptRemainingCount = entries.filter(
    e => e.inObject && !e.committedSource && e.availableSource
  ).length;
  const gapCount = entries.filter(
    e => e.inObject && !e.committedSource && !e.availableSource
  ).length;

  // Exactly what the lane's track would be after accepting: committed boxes
  // where the annotator decided, winning boxes everywhere else. Only built
  // while the dialog is open — it walks every frame of the lane.
  const previewBoxes = acceptOpen
    ? collectLaneBoxes(laneDetections, new Map(laneAnnotations.map(a => [a.detection_id, a])))
    : [];

  /**
   * While peeking, the canvas shows a sibling lane's detection — the same
   * photograph at the same instant. It is a stand-in for the image only: no
   * predictions, no boxes, nothing committable. The real `detection` prop is
   * untouched, so leaving the peek restores the object's own frame.
   */
  const shownDetection: Detection = peeked
    ? ({
        ...detection,
        id: peeked.detectionId,
        recorded_at: peeked.recordedAt,
        algo_predictions: { predictions: [] },
        auto_predictions: { predictions: [] },
        others_bboxes: null,
      } as unknown as Detection)
    : detection;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ash">
      {/* z-40 gives the bar its own stacking context above the media row, so
          the accept popover hanging out of it is not painted behind the
          canvas — whose own box layer sits at z-30 in the same context
          otherwise. */}
      <div className="relative z-40 flex h-12 flex-none items-center gap-3 border-b border-line bg-paper px-4">
        <span
          data-testid="editor-object-identity"
          className="inline-flex items-center gap-2 border-l-2 pl-2.5 font-body text-sm font-medium text-char"
          style={{ borderColor: objectColor }}
        >
          {objectLabel}
          <span className="font-data text-detail text-haze">{smokeType}</span>
        </span>

        {peeked && (
          <span className="inline-flex rounded-full bg-signal-soft px-2 py-1 font-body text-xs font-semibold text-signal">
            not part of this object
          </span>
        )}

        {/* Centred on the bar rather than tucked in the rail: it acts on the
            whole object, not on the frame the rail is about, and it is the
            one control here that moves the work forward. Pine and this exact
            treatment are what the cockpit's own Accept wears — the two are
            the same motion from two places. */}
        {/* What acts on the OBJECT rather than on the frame in front of you:
            take the model's word for the rest of it, or decide it was
            classified wrong. Accept leads — it is the one that moves the work
            on, and it carries the fill to match. Centred together, away from
            the frame-level controls in the rail. */}
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
          {acceptRemainingCount > 0 && editable && (
            <div ref={acceptAnchorRef} className="relative">
              <button
                type="button"
                data-testid="editor-accept-remaining"
                aria-haspopup="dialog"
                aria-expanded={acceptOpen}
                onClick={() => setAcceptOpen(open => !open)}
                className="inline-flex items-center whitespace-nowrap rounded-lg bg-pine px-3 py-1 font-body text-xs font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Accept boxes
              </button>

              {acceptOpen && (
                <AcceptRemainingPopover
                  objectLabel={objectLabel}
                  objectColor={objectColor}
                  sequenceId={laneSequenceId}
                  previewBoxes={previewBoxes}
                  acceptCount={acceptRemainingCount}
                  gapCount={gapCount}
                  isAccepting={isAccepting}
                  onConfirm={() => {
                    onAcceptRemaining();
                    setAcceptOpen(false);
                  }}
                  onCancel={() => setAcceptOpen(false)}
                />
              )}
            </div>
          )}

          {editable && (
            <button
              type="button"
              data-testid="editor-reclassify"
              onClick={onReclassify}
              title="Change what this object was classified as"
              className="inline-flex items-center whitespace-nowrap rounded-lg border border-line bg-paper px-3 py-1 font-body text-xs font-medium text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
            >
              Reclassify
            </button>
          )}

          {/* A rule, not a gap: what precedes it acts on the OBJECT and what
              follows acts on the VIEW, and that is a real boundary rather than
              spacing. Only drawn when something precedes it — on an
              out-of-range frame the object actions are gone and the toggle
              stands alone. */}
          {editable && <span aria-hidden className="mx-0.5 h-5 w-px self-center bg-line" />}

          {/* The cockpit's own crop control, same icon and same pressed
              language, because it is the same idea: frame the object instead of
              the landscape. Its name stays put and aria-pressed carries the
              state, as ViewToolbar does — a name that also flipped would
              announce the state twice. */}
          <div className="inline-flex items-center rounded-lg bg-ash p-0.5">
            <button
              type="button"
              data-testid="editor-zoom-toggle"
              title="Zoom to the object (Z)"
              aria-label="Zoom to the object"
              aria-pressed={cropView}
              onClick={() => setCropView(pressed => !pressed)}
              className={`rounded p-1.5 transition-colors ${
                cropView ? 'bg-pine-soft text-pine' : 'text-haze hover:text-char'
              }`}
            >
              <Crop className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <span className="ml-auto font-data text-detail text-haze">
          {formatDateTime(shownDetection.recorded_at)}
        </span>
        {isSaving && <span className="font-data text-detail text-haze">Saving…</span>}
        <button
          type="button"
          data-testid="editor-shortcuts"
          onClick={() => setShortcutsOpen(true)}
          title="Show keyboard shortcuts (?)"
          aria-label="Show keyboard shortcuts"
          className="rounded-lg border border-line bg-paper p-1.5 text-haze hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char"
        >
          <Keyboard className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="editor-close"
          onClick={onClose}
          className="rounded-lg border border-line bg-paper p-1.5 text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char"
          aria-label="Close editor"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-ash p-3">
          <DetectionAnnotationCanvas
            detection={shownDetection}
            committed={editable ? stageCommitted : null}
            ghosts={editable ? ghosts : []}
            showGhosts={editable && ghosts.length > 0}
            selected={editable && boxSelected}
            selectedSmokeType={smokeType}
            objectOverlays={showOtherObjects ? objectOverlays : []}
            isDrawMode={currentDrawing !== null}
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
            overlaysVisible
          />

          {/* Floated over the stage rather than stacked into the column, so
              stepping between in-object and gap frames never resizes the
              photo or shifts the filmstrip. Pine, not signal: this is the
              Localize lane's own invitation to act, not an error. */}
          {peeked && (
            <div
              data-testid="out-of-range-banner"
              className="absolute inset-x-0 bottom-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-line bg-pine-soft px-4 py-2"
            >
              <span className="whitespace-nowrap font-data text-eyebrow font-medium uppercase tracking-eyebrow text-pine">
                Outside object range
              </span>
              <span className="font-body text-detail text-pine">
                {objectLabel} was never detected on this frame. If you can see its smoke, draw a box
                to add this frame to {objectLabel}.
              </span>
            </div>
          )}
        </div>

        <BoxSourceRail
          candidates={editable ? candidates : []}
          committed={editable ? committed : null}
          imageUrl={editable ? (imageData?.url ?? null) : null}
          disabled={!editable}
          onCommit={commitCandidate}
          onClear={clear}
          onPreview={setPreviewed}
        />
      </div>

      <ObjectFilmstrip
        entries={entries}
        currentDetectionId={shownDetection.id}
        onSelect={goToEntry}
      />

      {shortcutsOpen && <EditorShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
