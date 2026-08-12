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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  isCleared,
  priorityPick,
  type BoxCandidate,
} from '@/utils/annotation/objectBoxCandidates';
import { buildFilmstripEntries, type FilmstripEntry } from '@/utils/annotation/objectFilmstrip';
import { computeCellCrop } from '@/utils/annotation/gridCropUtils';
import type { AlertFrame } from '@/utils/annotation/alertLocalizeUtils';
import { useBoxDrawingStage } from '@/hooks/annotation';
import {
  FADE_MS,
  prefersReducedMotion,
  zoomKeyframes,
  ZOOM_CLOSE_EASING,
  ZOOM_CLOSE_MS,
  ZOOM_OPEN_EASING,
  ZOOM_OPEN_MS,
  type RectLike,
} from '@/utils/annotation/zoomTransitionUtils';
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
   * un-materialize) — Delete, for a frame whose only reason to exist is a
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
  /**
   * Consume-once viewport rect of the grid cell the opening click came
   * from. Absent or null — deep link, back/forward — means the editor
   * appears without an entrance animation.
   */
  takeOpenOriginRect?: () => RectLike | null;
  /**
   * Viewport rect of the grid cell showing `recordedAt`, scrolled into
   * view by the caller first. Close shrinks the editor into it; null
   * falls back to a plain fade.
   */
  frameCellRect?: (recordedAt: string) => RectLike | null;
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
  takeOpenOriginRect,
  frameCellRect,
}: LocalizeObjectEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Grow out of the clicked grid cell — on mount only: stepping frames
  // re-renders this same instance and must not re-animate. No captured rect
  // (deep link, back/forward) or no WAAPI (jsdom) means no animation, and
  // reduced motion gets a plain fade. Layout effect: the first paint must
  // already be the shrunk pose, not a full-screen flash.
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const rect = takeOpenOriginRect?.() ?? null;
    if (!root || !rect || typeof root.animate !== 'function') return;
    if (prefersReducedMotion()) {
      root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' });
      return;
    }
    // Input is off for the grow: getImageInfo's containerOffset is the
    // visual rect, so pointer maths run mid-animation would mix transformed
    // and layout space. Restored on finish — unless a close already began,
    // whose own pointer-events lockout must not be undone.
    root.style.pointerEvents = 'none';
    root.style.transformOrigin = '0 0';
    // The root's own layout size, not window.innerWidth: a classic
    // scrollbar makes the viewport wider than the laid-out root.
    const { atCell, full } = zoomKeyframes(rect, {
      width: root.offsetWidth,
      height: root.offsetHeight,
    });
    const animation = root.animate([atCell, full], {
      duration: ZOOM_OPEN_MS,
      easing: ZOOM_OPEN_EASING,
    });
    const restore = () => {
      if (!isClosingRef.current) root.style.pointerEvents = '';
    };
    animation.addEventListener('finish', restore);
    animation.addEventListener('cancel', restore);
    // Mount-only by design; the origin rect is consumed exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The exit animation runs on the document timeline and survives this
  // component's removal — after a browser back during the shrink, its finish
  // listener would navigate AGAIN from the still-mounted page. The unmount
  // cleanup detaches that path (and cancelling also releases the forwards
  // fill). The flag is re-armed in the effect body so StrictMode's dev
  // mount-cleanup-remount cycle doesn't leave it stuck false.
  const mountedRef = useRef(true);
  const exitAnimationRef = useRef<Animation | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      exitAnimationRef.current?.cancel();
    };
  }, []);

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

  const { data: imageData } = useDetectionImage(detection.id);
  const queryClient = useQueryClient();

  // Read by the keyboard handler; kept in a ref so a save (which rebuilds
  // `clear`) doesn't re-bind the window listener.
  const clearRef = useRef<() => void>(() => undefined);

  // --- The object's box on this frame -------------------------------------

  const candidates = useMemo(
    () => boxCandidates(detection, existingAnnotation),
    [detection, existingAnnotation]
  );
  const committed = useMemo(() => committedBox(existingAnnotation), [existingAnnotation]);
  // The annotator's "not visible here" for this frame — a decision, not the
  // absence of one, and the difference the stage and the rail have to show.
  const cleared = isCleared(existingAnnotation);

  // Image geometry, zoom/pan and the modeless pointer handling, shared with
  // the add-object flow. `commitDrawn` is defined below and reaches the hook
  // through a ref — the same trick `clearRef` uses for the keyboard handler,
  // so nothing has to be reordered to satisfy the dependency.
  const commitDrawnRef = useRef<(xyxyn: [number, number, number, number]) => void>(() => undefined);
  const stage = useBoxDrawingStage({
    containerRef,
    imgRef,
    // The ORIGINAL box, not the live-dragged one: a drag can only start when
    // `boxEdit` is null, at which point the two are identical anyway.
    editableBox: committed?.xyxyn ?? null,
    boxSelected,
    onBoxSelectedChange: setBoxSelected,
    onDrawn: xyxyn => commitDrawnRef.current(xyxyn),
    imageKey: imageData?.url,
  });
  // Destructured because effects depend on them: these are useCallback-stable,
  // so a plain identifier keeps the dependency arrays honest where `stage.x`
  // would drag the whole (per-render) object in.
  const {
    boxEdit,
    currentDrawing,
    resetZoom: resetStageZoom,
    applyView: applyStageView,
    resetTransient: resetStageTransient,
  } = stage;

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
        : shownCommitted || cleared
          ? []
          : pick
            ? [pick]
            : [];

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

  commitDrawnRef.current = commitDrawn;

  const clear = useCallback(() => {
    setPreviewed(null);
    // Already settled empty. Nothing to write — and on an evidence-free
    // frame a second press must not remove a frame the annotator kept.
    if (cleared) return;
    // A frame with no model evidence exists only because a human boxed it;
    // clearing removes the frame itself (issue #287's un-materialize).
    if (hasModelEvidence(detection)) onCommit(detection, []);
    else onUnmaterialize(detection);
  }, [cleared, detection, onCommit, onUnmaterialize]);

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
    // A cleared frame is already settled, so Enter only moves on. Committing
    // the pick here would silently reinstate the box the annotator just
    // rejected — and Enter is the habitual advance key, so they would be on
    // the next frame before it happened.
    if (cleared) {
      step(1);
      return;
    }
    const pick = priorityPick(candidates);
    if (!pick) return;
    commitCandidate(pick);
    step(1);
  }, [editable, cleared, candidates, commitCandidate, step]);

  // --- Zoom ---------------------------------------------------------------

  // `Z`: frame the object rather than the landscape. `computeCellCrop` is the
  // cockpit's own crop-mode math, and its output maps straight onto the
  // canvas's existing zoom/transform-origin props — no second render path.
  useEffect(() => {
    if (!cropView) {
      resetStageZoom();
      return;
    }
    const boxes = committed ? [committed] : candidates;
    if (boxes.length === 0) return;
    applyStageView(computeCellCrop(boxes, OBJECT_FRAMING));
    // Re-frames on frame change too, since the object moves between frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropView, detection.id]);

  // Navigating to another frame resets the transient per-frame state.
  useEffect(() => {
    resetStageTransient();
    setBoxSelected(false);
    setBoxVisibility('pick');
    setPreviewed(null);
    // `imageInfo` deliberately survives the change. Every frame of an alert
    // comes from one camera at one size and lands in the same box, so the
    // previous geometry stays correct; clearing it unmounted every overlay
    // until the next image fired onLoad, which read as the boxes blinking out
    // on each arrow press. `handleImageLoad` refreshes it either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection.id]);

  // Clicks resolve on mouse-up, where the drag's size decides whether it was a
  // box or a deselect; this only keeps the press from escaping the editor.
  const handleClick = (e: React.MouseEvent) => e.stopPropagation();

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

  // Close = shrink back into the grid, then let onClose navigate (which
  // unmounts this component). The guard makes a second close attempt a
  // no-op and pointer-events blankets the editor against input during the
  // exit. Without WAAPI (jsdom, old browsers) this is exactly onClose.
  const isClosingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (isClosingRef.current) return;
    const root = rootRef.current;
    if (!root || typeof root.animate !== 'function') {
      onClose();
      return;
    }
    isClosingRef.current = true;
    root.style.pointerEvents = 'none';
    const shownRecordedAt = peeked?.recordedAt ?? detection.recorded_at;
    const target = prefersReducedMotion() ? null : (frameCellRect?.(shownRecordedAt) ?? null);
    let animation: Animation;
    if (target) {
      root.style.transformOrigin = '0 0';
      const { atCell, full } = zoomKeyframes(target, {
        width: root.offsetWidth,
        height: root.offsetHeight,
      });
      // fill: 'forwards' holds the end pose until React unmounts the node
      // on navigation — without it the editor would snap back full-screen
      // for a frame.
      animation = root.animate([full, atCell], {
        duration: ZOOM_CLOSE_MS,
        easing: ZOOM_CLOSE_EASING,
        fill: 'forwards',
      });
    } else {
      animation = root.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: FADE_MS,
        easing: 'linear',
        fill: 'forwards',
      });
    }
    exitAnimationRef.current = animation;
    // Guarded, not bare onClose: see the unmount cleanup above.
    const done = () => {
      if (mountedRef.current) onClose();
    };
    animation.addEventListener('finish', done);
    animation.addEventListener('cancel', done);
  }, [onClose, frameCellRect, peeked, detection]);

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
          // The accept dialog owns Enter while it is open — its button says
          // so — otherwise the frame-level accept would fire behind it. But
          // a button focused inside the dialog keeps its own Enter: Tab to
          // the close X must close, not accept out from under the focus.
          if (acceptOpen) {
            if (
              e.target instanceof HTMLElement &&
              e.target.closest('button') &&
              e.target.closest('[role="dialog"]')
            )
              return;
            if (!isAccepting) {
              onAcceptRemaining();
              setAcceptOpen(false);
            }
          } else {
            acceptAndNext();
          }
          break;
        case 'Delete':
        case 'Backspace':
          // "This object is not visible on this frame" — the one answer the
          // editor had no way to say. Works whether or not a box is
          // committed: on an undecided frame it rejects the model's
          // proposal, on a committed one it takes the box back. A no-op
          // outside the object's range, and on an already-cleared frame.
          //
          // Auto-repeat is dropped: the write is async, so a held key would
          // fire before `existingAnnotation` refetches. On a frame with no
          // annotation yet that means N creates against a detection_id
          // unique constraint — a burst of failure toasts on a save that
          // succeeded — and on an evidence-free frame, N deletes of a row
          // the first one already removed.
          if (!editable || e.repeat) return;
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
          resetStageZoom();
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
            requestClose();
          }
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    step,
    acceptAndNext,
    boxSelected,
    acceptOpen,
    shortcutsOpen,
    resetStageZoom,
    requestClose,
    editable,
    isAccepting,
    onAcceptRemaining,
  ]);

  // --- Render -------------------------------------------------------------

  // Frames of this object that a bulk accept would fill, and frames it
  // cannot — no source offers a box there, so they stay empty and keep the
  // alert off the submit gate. A cleared frame is neither: the annotator
  // already settled it, and re-filling it would undo their answer.
  const acceptRemainingCount = entries.filter(
    e => e.inObject && !e.cleared && !e.committedSource && e.availableSource
  ).length;
  const gapCount = entries.filter(
    e => e.inObject && !e.cleared && !e.committedSource && !e.availableSource
  ).length;

  // Exactly what the lane's track would be after accepting: committed boxes
  // where the annotator decided, winning boxes everywhere else. Only built
  // while the dialog is open — it walks every frame of the lane.
  const previewBoxes = acceptOpen
    ? collectLaneBoxes(laneDetections, new Map(laneAnnotations.map(a => [a.detection_id, a])), {
        // Cleared frames still play, marked — a hole in the loop made the
        // object's track jump. The editor only ever opens on a workable
        // lane, so an annotated-empty frame here is a clear, never an FP
        // lane's empty-by-construction annotation.
        markCleared: true,
      })
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
    <div ref={rootRef} className="fixed inset-0 z-50 flex flex-col bg-ash">
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
                  entries={entries}
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
          onClick={requestClose}
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
            onBoxPointerDown={stage.handleBoxPointerDown}
            onHandlePointerDown={stage.handleHandlePointerDown}
            currentDrawing={stage.currentDrawing}
            containerRef={containerRef}
            imgRef={imgRef}
            imageInfo={stage.imageInfo}
            zoomLevel={stage.zoomLevel}
            panOffset={stage.panOffset}
            transformOrigin={stage.transformOrigin}
            isDragging={stage.isDragging}
            onMouseDown={stage.handleMouseDown}
            onMouseMove={stage.handleMouseMove}
            onMouseUp={stage.handleMouseUp}
            onClick={handleClick}
            getCursorStyle={stage.getCursorStyle}
            handleImageLoad={stage.handleImageLoad}
            normalizedToImage={stage.normalizedToImage}
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

          {/* A cleared frame is the one state with nothing to draw, so the
              stage has to say so in words — otherwise it is indistinguishable
              from a frame nobody has looked at. Ash, not signal: this is a
              recorded answer, not a problem. */}
          {!peeked && cleared && (
            <div
              data-testid="cleared-frame-chip"
              className="absolute inset-x-0 bottom-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-line bg-ash px-4 py-2"
            >
              <span className="whitespace-nowrap font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                No box on this frame
              </span>
              {/* Stated impersonally: `isCleared` only sees "committed with
                  no box", which a boxless annotated frame reaches without
                  anyone deciding it (issue #346), and the editor opens on
                  already-annotated lanes. "You marked" would credit the
                  viewer with a decision they may never have made.

                  The undo depends on there being something to go back TO. A
                  cleared frame no model boxed has every rail row disabled
                  and Delete guarded, so pointing at the rail would be a lie
                  — drawing is the only way back. Reachable through the
                  un-materialize 409 fallback (LocalizeAlertPage). */}
              <span className="font-body text-detail text-haze">
                {objectLabel} is recorded as not visible on this frame.{' '}
                {candidates.length > 0
                  ? 'Pick a box on the right to change that.'
                  : 'Draw a box to change that.'}
              </span>
            </div>
          )}
        </div>

        <BoxSourceRail
          candidates={editable ? candidates : []}
          committed={editable ? committed : null}
          cleared={editable && cleared}
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
