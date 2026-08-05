/**
 * Collocated localize screen: renders every workable object (lane) of one
 * alert as a status strip plus a frame grid, mirroring ClassifyAlertPage's
 * alert-level shape for the localize task. Mounted at
 * `/localize/:sequenceId` (queue provenance) and
 * `/localize/done/:sequenceId` (`mode="done"`, entered from
 * the Done list) — the same component either side, exactly as classify does
 * it. `mode` is pure provenance: the list to go back to, and the prefix this
 * page's own URLs are built from. It gates no behavior, because a "done"
 * alert isn't necessarily finished — the localize-done queue surfaces an
 * alert as soon as ONE lane is annotated and returns all its lanes, so the
 * mix of annotated and still-workable objects the rail already models turns
 * up on both routes.
 *
 * Done mode replaced `DetectionSequenceAnnotatePage`, which rendered only the
 * alert's FIRST lane (siblings invisible) and switched off crop mode, the
 * cropped-view flipbook and per-frame cell states via `isLocalize = mode !==
 * 'done'`. That page, its `DetectionGrid`/`DetectionHeader`, and the
 * `/localize/lane` route are gone.
 *
 * Task 3 built the data loading, status/frame model, strip, and grid. Task 4
 * wires per-frame editing: clicking a grid cell opens the shown object's
 * detection in `ImageModal` (URL-driven, so the back button closes the
 * editor), a per-object "Accept boxes" quick action on each workable strip
 * row, and the S/M/L card-size + crop-zoom view controls. Task 5 wires
 * submitting the whole alert atomically via the bulk `localize-submit`
 * endpoint.
 *
 * Post-Task-5 feedback round: a segment click gives its target cell a fading
 * ring highlight and encodes the shown detection in a `?frame=` query param
 * (independent of the editor's `:detectionId` path param — the two coexist),
 * so reloading or sharing the link reproduces the scroll+highlight without
 * opening the editor. Activating an object via the timeline (row or segment
 * click) also enters "object focus mode" — crop-on + small cards, a lens for
 * looking closely at just that object — stashing the prior crop/size so
 * clicking the selected row again restores them. An explicit S/M/L click
 * while focused clears the small-card override immediately (visible feedback
 * for what's otherwise a silent preference write); the timeline rows no
 * longer carry a hover preview popover (dropped — the selected rail row's
 * cropped loop replaces it).
 *
 * Task 9 retires the earlier ⚑ pseudo-object row (a carrier-lane box that
 * stood in for missed smoke) in favor of "+ Add object": a footer action
 * that spawns a brand-new sibling lane for a plume the AI missed entirely,
 * so it gets its own real object row like any other.
 *
 * Cockpit round: the page adopts ClassifyAlertPage's two-column shape —
 * a media column (the active object's frame grid) beside a sticky
 * `LocalizeRail` carrying the whole alert's
 * localization state. That collapses the three blocks the body used to
 * stack (workable timeline -> standalone "+ Add object" card -> a separate
 * dimmed "Already localized" timeline) into one rail: every object gets a
 * row in lane order, with already-localized lanes dimmed in place rather
 * than exiled to their own strip, and the timeline moves below the rail
 * into the slot classify gives `ObjectPresenceStrip`. Submit moves out of
 * the header into the rail footer and turns pine per DESIGN.md's
 * "primary is pine in Localize contexts"; the header keeps identity, the
 * view toolbar, and a progress badge that now reports how many objects are
 * fully localized rather than a bare object count.
 *
 * Fixed-pane round: from lg up the cockpit is a viewport-height shell and
 * the frame cells are the page's only scroller, so everything that acts on
 * them — the Frames panel and the cropped loop above, the Objects rail and
 * Timeline beside — never leaves the screen. The header compacted to a
 * single 48px row to pay for it. See
 * docs/specs/2026-08-04-localize-fixed-panes-scrolling-grid-design.md.
 *
 * The per-frame editor is URL-driven from a CHILD route under whichever
 * provenance prefix the page is mounted at —
 * `<basePath>/object/:laneId/:detectionId` — which names the object
 * (the lane's own sequence id) as well as the frame — so a shared or pasted
 * editor link is unambiguous, and a detection that belongs to some other lane
 * is refused rather than silently editing that lane. A child route rather
 * than a sibling because a sibling would remount this page on every open and
 * close, losing scroll, crop mode, focus mode and the active object; the page
 * reads the child's params with `useMatch`. See
 * docs/specs/2026-08-04-localize-object-editor-route-design.md.
 *
 * Submit is also gated now: it enables only once every workable object
 * already carries a committed box on every frame it appears on, accepted
 * per object from its own rail row. Submit therefore no longer accepts
 * anything itself, and the old per-frame "N frames with no box — submit
 * anyway?" two-step went with that: under the gate there is never a pending
 * no-box frame left at submit time. The missed-smoke soft-confirm is the
 * only gate left in front of it.
 *
 * The rail also owns the missed-smoke question, which guards "+ Add object":
 * it starts at No on every alert — deliberately NOT seeded from the lanes'
 * inherited `has_missed_smoke`, so arriving on an alert classify already
 * flagged never pre-authorizes adding — and answering writes the flag
 * through to the carrying lane.
 *
 * False-positive objects are hidden by default (the queue's own rule, via
 * `laneNeedsLocalization`) behind a rail toggle that surfaces them as a
 * separated, read-only group — enough to answer "is that plume already
 * accounted for?" before someone adds a duplicate object for it. Unsure
 * lanes stay excluded either way.
 *
 * Each smoke object's row also carries a "Reclassify" action — workable and
 * already-localized rows alike — routing to `/classify/done/<lane>` with a
 * `return` param back to this page. False-positive rows deliberately don't
 * get it (see issue #275).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, useMatch } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PlayCircle, Plus, Upload } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Detection, DetectionAnnotation, DetectionAnnotationBbox, SmokeType } from '@/types/api';
import {
  buildAlertFrameModel,
  findFrameByDetectionId,
  AlertObjectStatus,
} from '@/utils/annotation/alertLocalizeUtils';
import { laneNeedsLocalization } from '@/utils/annotation/localizeUtils';
import {
  buildQuickSubmitPlan,
  collectLaneBoxes,
  saveDetectionReview,
  sequenceSmokeType,
} from '@/utils/annotation';
import { ObjectStatusStrip } from '@/components/sequence-annotation';
import {
  LocalizeActionPanel,
  LocalizeMissedSmokeRow,
  LocalizeObjectActions,
  LocalizeObjectRow,
  LocalizeRail,
} from '@/components/localize';
import { AlertFrameGrid, ViewToolbar } from '@/components/detection-sequence';
import { LocalizeObjectEditor } from '@/components/localize/editor';
import type { CardSize } from '@/components/detection-sequence/ViewToolbar';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import { usePersistedTabState } from '@/hooks/usePersistedTabState';
import { useToastNotifications } from '@/utils/notification/toastUtils';
import { NotificationSystem } from '@/components/ui/NotificationSystem';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  ROUTES,
  classifyDetailWithReturn,
  localizeObject,
  localizeObjectRoute,
} from '@/utils/routes';
import { formatDateTime } from '@/utils/datetime';

const CARD_MIN_WIDTH: Record<CardSize, number> = { sm: 240, md: 340, lg: 500 };

interface LocalizeAlertPageProps {
  /**
   * 'done' when mounted under /localize/done/… — entered from the Done list.
   *
   * Provenance only: it picks the list to return to and the prefix this
   * page's own URLs are built from, nothing else. A "done" alert is not
   * necessarily finished — the localize-done queue surfaces an alert as soon
   * as ONE lane is annotated and returns all of its lanes, so the same mix of
   * annotated and still-workable objects the queue view already models can
   * (and does) show up here.
   */
  mode?: 'done';
}

export default function LocalizeAlertPage({ mode }: LocalizeAlertPageProps = {}) {
  const { sequenceId } = useParams<{ sequenceId: string }>();
  // The editor's object + frame live on a CHILD route of whichever provenance
  // prefix this page is mounted under (see App.tsx), and a parent's useParams
  // cannot see a child route's params — hence useMatch.
  const editorMatch = useMatch(localizeObjectRoute(mode === 'done'));
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const sequenceIdNum = sequenceId ? parseInt(sequenceId, 10) : null;
  const laneIdNum = editorMatch?.params.laneId ? parseInt(editorMatch.params.laneId, 10) : null;
  const detectionIdNum = editorMatch?.params.detectionId
    ? parseInt(editorMatch.params.detectionId, 10)
    : null;

  // Back target and the prefix every in-page URL is built from, both driven
  // by which list you came in through. `basePath` matters because opening,
  // stepping through and closing the frame editor all navigate — without it
  // the first cell click would silently move you onto the queue route.
  const listPath = mode === 'done' ? ROUTES.LOCALIZE_DONE : ROUTES.LOCALIZE;
  const basePath = `${listPath}/${sequenceIdNum}`;

  const [activeLaneId, setActiveLaneId] = useState<number | null>(null);
  const frameRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [cardSize, setCardSize] = usePersistedTabState<CardSize>('detectionAnnotateCardSize', 'md');
  const [cropMode, setCropMode] = useState(false);
  // Whether the active row's cropped loop is unfolded. Deliberately NOT
  // per-lane: an annotator either wants to watch the plume evolve or doesn't,
  // so the choice follows them from object to object instead of resetting on
  // every selection.
  const [cropExpanded, setCropExpanded] = useState(false);
  // Opt-in read-only context: objects classify settled as false positives.
  // Off by default so the default view matches the queue's own rule; on, it
  // answers "is that plume already accounted for?" before someone adds a
  // duplicate object for something already rejected.
  const [showFalsePositives, setShowFalsePositives] = useState(false);
  const [selectedSmokeType, setSelectedSmokeType] = useState<SmokeType>('wildfire');
  const smokeTypeInitFor = useRef<number | null>(null);

  // The three-way "you flagged missed smoke but added no object" dialog and
  // whether it's already been answered this submit round (so re-clicking
  // Submit after "Submit anyway" goes straight through instead of re-asking
  // the same question).
  const [missedSmokeConfirm, setMissedSmokeConfirm] = useState(false);
  const [softConfirmResolved, setSoftConfirmResolved] = useState(false);
  // "+ Add object": lane ids spawned via the picker this session (feeds the
  // soft-confirm gate below) and whether the picker is currently open.
  const [sessionAddedObjects, setSessionAddedObjects] = useState<number[]>([]);
  const [addObjectPickerOpen, setAddObjectPickerOpen] = useState(false);

  // The rail's missed-smoke answer, and the gate in front of "+ Add object".
  // Deliberately NOT seeded from the lanes' inherited `has_missed_smoke`:
  // adding an object has to be a decision made here, so arriving on an alert
  // classify already flagged must not pre-authorize it. Answering writes the
  // flag through to the carrier lane.
  const [missedSmoke, setMissedSmoke] = useState(false);

  // Object-focus mode: entering it (row/segment click activating an object)
  // stashes the pre-focus crop-mode so the selected row's second click can
  // restore it. Card size is handled differently (see `effectiveCardSize`
  // below) — its persisted value is never written to while focused (unless
  // explicitly overridden — see `sizeOverrideCleared`), so there's nothing
  // to stash for it.
  const [preFocusCropMode, setPreFocusCropMode] = useState<boolean | null>(null);
  const isFocused = preFocusCropMode !== null;
  // Card size while focused is a purely DERIVED override to 'sm' — the real
  // `usePersistedTabState` setter is never called with 'sm', so the
  // shared-with-the-legacy-page localStorage preference can never be
  // clobbered by entering/leaving focus mode (chosen over "call the real
  // setter but suspend its localStorage write", which would need reaching
  // into the hook's internals).
  //
  // Re-review fix: the S/M/L buttons stayed live but invisible while
  // focused — a click wrote the real preference (via `handleCardSizeChange`
  // below) while the grid's displayed size stayed pinned at the derived
  // 'sm'. `sizeOverrideCleared` lets an EXPLICIT size click cancel the
  // override for the rest of THIS focus session, so the click has visible
  // effect the moment it happens (the write was already intentional; now
  // the display honors it too). It resets to `false` on a fresh focus
  // entry, but — mirroring the crop-mode stash's "don't chain" rule — is
  // deliberately left alone when focus merely *switches* to another object,
  // so an explicit choice made earlier in the session keeps applying.
  const [sizeOverrideCleared, setSizeOverrideCleared] = useState(false);
  const effectiveCardSize: CardSize = isFocused && !sizeOverrideCleared ? 'sm' : cardSize;
  const cardMinWidth = CARD_MIN_WIDTH[effectiveCardSize] ?? CARD_MIN_WIDTH.md;

  // Arrival highlight for a segment click / `?frame=` deep link: a ~2s fade
  // (via the ring's own `transition-shadow` plus a timed clear) rather than
  // "persistent until next click" — simpler state (no need to track what
  // counts as "the next interaction that should clear it": another segment
  // click, a cell click opening the editor, deselecting focus mode, etc.)
  // and it reads clearly as "you arrived here" without lingering as a
  // permanent UI fixture.
  const [highlightedFrame, setHighlightedFrame] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightFrame = useCallback((recordedAt: string) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedFrame(recordedAt);
    highlightTimerRef.current = setTimeout(() => setHighlightedFrame(null), 2000);
  }, []);
  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    []
  );

  const { showToast, toastMessage, toastType, showToastNotification, dismissToast } =
    useToastNotifications();

  // Clear active-object and focus-mode state immediately when the alert
  // changes so a stale selection from a previous alert can't linger —
  // including a hard reset of crop-mode (not just the focus stash), so a
  // switch mid-focus can never leave the new alert stuck in crop mode.
  useEffect(() => {
    setActiveLaneId(null);
    setPreFocusCropMode(null);
    setCropMode(false);
    setSizeOverrideCleared(false);
    setHighlightedFrame(null);
    setMissedSmokeConfirm(false);
    setSoftConfirmResolved(false);
    setSessionAddedObjects([]);
    setAddObjectPickerOpen(false);
    setMissedSmoke(false);
    frameRefs.current = {};
  }, [sequenceIdNum]);

  // Resolve the alert (source_api, platform_alert_id) from the entry sequence id.
  const {
    data: sequence,
    isLoading: sequenceLoading,
    error: sequenceError,
  } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(sequenceIdNum!),
    queryFn: () => apiClient.getSequence(sequenceIdNum!),
    enabled: !!sequenceIdNum,
  });

  const alertDetailQueryKey = ['alert-detail', sequence?.source_api, sequence?.platform_alert_id];
  const {
    data: alertDetail,
    isLoading: alertLoading,
    error: alertError,
  } = useQuery({
    queryKey: alertDetailQueryKey,
    queryFn: () => apiClient.getAlertDetail(sequence!.source_api, sequence!.platform_alert_id),
    enabled: !!sequence,
  });

  const isLoading = sequenceLoading || (!!sequence && alertLoading);
  const error = sequenceError || alertError;

  const laneSequenceIds = useMemo(
    () => (alertDetail ? alertDetail.lanes.map(lane => lane.sequence.id) : []),
    [alertDetail]
  );

  // Each lane's detections (frame identity: recorded_at) and detection
  // annotations (committed boxes), fetched the same way ClassifyAlertPage
  // fetches per-lane detections — one query per lane, paginated for
  // annotations since a lane can have more than one page of frames.
  const laneDetectionsQueries = useQueries({
    queries: laneSequenceIds.map(laneSequenceId => ({
      queryKey: QUERY_KEYS.SEQUENCE_DETECTIONS(laneSequenceId),
      queryFn: () => apiClient.getSequenceDetections(laneSequenceId),
      staleTime: 1000 * 60 * 5,
    })),
  });

  const laneAnnotationsQueries = useQueries({
    queries: laneSequenceIds.map(laneSequenceId => ({
      queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS, 'by-sequence', laneSequenceId],
      queryFn: async () => {
        const all: DetectionAnnotation[] = [];
        let page = 1;
        let pages = 1;
        while (page <= pages) {
          const response = await apiClient.getDetectionAnnotations({
            sequence_id: laneSequenceId,
            size: 100,
            page,
          });
          all.push(...response.items);
          pages = response.pages || 1;
          page += 1;
        }
        return all;
      },
      staleTime: 30 * 1000,
    })),
  });

  // Memoized (not just plain locals) so the useMemo hooks below that key off
  // these maps (modalContext, laneDetectionsSorted, activeLaneBoxes) don't
  // recompute on every render regardless of whether the query data changed.
  const detectionsByLaneId: Record<number, Detection[]> = useMemo(() => {
    const map: Record<number, Detection[]> = {};
    laneSequenceIds.forEach((laneSequenceId, i) => {
      map[laneSequenceId] = laneDetectionsQueries[i]?.data ?? [];
    });
    return map;
  }, [laneSequenceIds, laneDetectionsQueries]);

  const annotationsByLaneId: Record<number, DetectionAnnotation[]> = useMemo(() => {
    const map: Record<number, DetectionAnnotation[]> = {};
    laneSequenceIds.forEach((laneSequenceId, i) => {
      map[laneSequenceId] = laneAnnotationsQueries[i]?.data ?? [];
    });
    return map;
  }, [laneSequenceIds, laneAnnotationsQueries]);

  const frameModel = alertDetail
    ? buildAlertFrameModel(alertDetail.lanes, detectionsByLaneId, annotationsByLaneId, {
        includeFalsePositives: showFalsePositives,
      })
    : { frames: [], objectStatus: [] };

  // Soft-confirm gate for submit: `has_missed_smoke` is set on some lane,
  // but no object was added this session to address it (`sessionAddedObjects`
  // — see the "+ Add object" mutation below), and the question hasn't
  // already been answered this submit round.
  const anyLaneFlagged = alertDetail?.lanes.some(l => l.annotation?.has_missed_smoke) ?? false;
  const softConfirmNeeded =
    anyLaneFlagged && sessionAddedObjects.length === 0 && !softConfirmResolved;

  // The alert-level missed-smoke flag lives on ONE lane's annotation.
  // Whichever lane
  // already carries it stays the carrier (so toggling edits that row rather
  // than stranding a stale flag on another lane); otherwise it goes on the
  // first lane that has an annotation at all. Undefined only when no lane is
  // annotated yet, which renders the row read-only.
  const missedSmokeAnnotationId = (
    alertDetail?.lanes.find(l => l.annotation?.has_missed_smoke) ??
    alertDetail?.lanes.find(l => !!l.annotation)
  )?.annotation?.id;

  // Reproduces a shared/reloaded `?frame=<detectionId>` link: resolves the
  // detection id against every lane's frames (independent of the editor's
  // `:detectionId` path param — this never opens the modal), then activates
  // + scrolls + highlights exactly like the segment click that produced the
  // link, MINUS entering focus mode (a fresh page load reproducing "where
  // you were looking" shouldn't also silently force crop-on + small cards).
  // `handledFrameParamRef` guards against reprocessing the same value once
  // handled (frameModel is rebuilt every render, so this effect re-runs
  // often as data loads — cheap to no-op once a value's been handled) and
  // is pre-set by `handleSegmentClick` since that path already does the
  // scroll+highlight itself.
  const frameParam = searchParams.get('frame');
  const frameParamNum = frameParam ? parseInt(frameParam, 10) : null;
  const handledFrameParamRef = useRef<number | null>(null);
  useEffect(() => {
    if (frameParamNum == null) {
      handledFrameParamRef.current = null;
      return;
    }
    if (handledFrameParamRef.current === frameParamNum) return;
    const target = findFrameByDetectionId(frameModel.frames, frameParamNum);
    if (!target) return; // frames not loaded yet (or an invalid id) — retries once data lands
    handledFrameParamRef.current = frameParamNum;
    setActiveLaneId(target.laneSequenceId);
    highlightFrame(target.recordedAt);
    requestAnimationFrame(() => {
      frameRefs.current[target.recordedAt]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [frameParamNum, frameModel.frames, highlightFrame]);

  // The URL names both the object (`:laneId` — the lane's own sequence id) and
  // the frame (`:detectionId`). Both have to agree for the editor to open: a
  // lane that isn't part of this alert, a lane that doesn't need localization
  // (false positive / unsure — the grid already refuses to open those, and
  // this closes the pasted/back-button route in as well), or a detection that
  // belongs to some OTHER lane all leave the editor closed and the cockpit
  // rendering normally. That last case was undetectable under the old
  // frame-only route, where any valid detection id resolved to whichever lane
  // happened to own it.
  const modalContext = useMemo(() => {
    if (laneIdNum == null || detectionIdNum == null || !alertDetail) return null;
    const lane = alertDetail.lanes.find(l => l.sequence.id === laneIdNum);
    if (!lane?.annotation || !laneNeedsLocalization(lane.annotation)) return null;
    const detection = (detectionsByLaneId[laneIdNum] ?? []).find(d => d.id === detectionIdNum);
    if (!detection) return null;
    const existingAnnotation =
      (annotationsByLaneId[laneIdNum] ?? []).find(a => a.detection_id === detectionIdNum) ?? null;
    return {
      laneId: laneIdNum,
      detection,
      existingAnnotation,
      smokeType: sequenceSmokeType(lane.annotation),
    };
  }, [laneIdNum, detectionIdNum, alertDetail, detectionsByLaneId, annotationsByLaneId]);

  // A directly-entered editor URL (paste, refresh, back button) names the
  // object, so the cockpit behind the editor should agree with it — otherwise
  // closing the editor drops you on an alert with nothing selected. Keyed on
  // the lane id rather than the whole `modalContext` object, which is rebuilt
  // on every refetch. The alert-change reset that clears `activeLaneId` runs
  // on `sequenceIdNum`; this re-derives from the URL afterwards.
  const modalLaneId = modalContext?.laneId ?? null;
  useEffect(() => {
    if (modalLaneId != null) setActiveLaneId(modalLaneId);
  }, [modalLaneId]);

  // Object-identity overlays for the open detection's OTHER contributing
  // lanes on this same frame (`recorded_at`) — passed to `ImageModal` so it
  // renders those boxes color-coded and labeled with their own object
  // identity ("Object N") instead of the generic, identity-less "sibling"
  // others_bboxes layer. Sourced from the frame model's own per-cell boxes
  // (committed for done cells, winning for auto cells — the same boxes
  // AlertFrameGrid's mini-boxes already render) and `objectStatus`'s
  // label/color, so it stays consistent with what's on screen elsewhere.
  // A plain derivation (not useMemo) — `frameModel` itself is recomputed
  // every render, same as the other values (objectStatusRows, etc.) derived
  // from it below.
  const modalFrame = modalContext
    ? frameModel.frames.find(f => f.recordedAt === modalContext.detection.recorded_at)
    : undefined;
  const objectOverlays = modalContext
    ? (modalFrame?.cells ?? [])
        .filter(cell => cell.laneSequenceId !== modalContext.laneId && cell.boxes.length > 0)
        .map(cell => {
          const object = frameModel.objectStatus.find(
            o => o.laneSequenceId === cell.laneSequenceId
          );
          return {
            color: object?.color ?? cell.boxes[0].color,
            label: object?.label ?? 'Object',
            boxes: cell.boxes.map(b => ({ xyxyn: b.xyxyn })),
          };
        })
    : [];

  // The open object's identity (label + color), as the rail and grid show it.
  const modalObject = modalContext
    ? frameModel.objectStatus.find(o => o.laneSequenceId === modalContext.laneId)
    : undefined;

  // Reset the modal's smoke-type default to the lane's classified type only
  // when the lane changes — not on every render/refetch, which would clobber
  // a manual in-modal change.
  useEffect(() => {
    if (!modalContext) return;
    if (smokeTypeInitFor.current === modalContext.laneId) return;
    smokeTypeInitFor.current = modalContext.laneId;
    setSelectedSmokeType(modalContext.smokeType);
  }, [modalContext]);

  // Modal prev/next navigates within the open detection's own lane,
  // chronologically — the same "step through this object's frames" model
  // the legacy per-lane page uses.
  const laneDetectionsSorted = useMemo(() => {
    if (!modalContext) return [];
    return [...(detectionsByLaneId[modalContext.laneId] ?? [])].sort(
      (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    );
  }, [modalContext, detectionsByLaneId]);

  // Path-only navigation within this page always appends the current query
  // string, so the `?frame=` deep-link param (owned by the highlight
  // feature, entirely separate from the editor's `:detectionId` path
  // param) survives opening/closing/stepping through the editor — the two
  // coexist rather than one clobbering the other.
  const closeModal = useCallback(() => {
    if (sequenceIdNum != null) navigate(`${basePath}${location.search}`);
  }, [sequenceIdNum, basePath, location.search, navigate]);

  // The editor asks for a frame by id; which frame is its own business (it
  // steps the alert's whole range, and holds out-of-range frames locally
  // rather than in the URL — see the spec). The page's job is only to keep
  // the URL naming whichever of THIS lane's detections is open.
  const navigateModalTo = useCallback(
    (detectionId: number) => {
      if (!modalContext || sequenceIdNum == null) return;
      navigate(
        `${localizeObject(sequenceIdNum, modalContext.laneId, detectionId, mode === 'done')}${location.search}`
      );
    },
    [modalContext, sequenceIdNum, mode, location.search, navigate]
  );

  // Per-frame save: create-or-update with FP preservation (shared util),
  // then invalidate only that lane's detection-annotations query so the
  // strip/grid statuses redraw.
  const saveDetection = useMutation({
    mutationFn: (params: {
      laneId: number;
      detectionId: number;
      existingAnnotation: DetectionAnnotation | null;
      items: DetectionAnnotationBbox[];
    }) =>
      saveDetectionReview({
        detectionId: params.detectionId,
        existingAnnotation: params.existingAnnotation,
        items: params.items,
      }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS, 'by-sequence', variables.laneId],
      });
    },
    onError: () => {
      showToastNotification('Failed to save frame — try again', 'error');
    },
  });

  // The alert-level missed-smoke flag. Written from two places: the rail's
  // own Yes/No row, and the soft-confirm's "Submit & clear flag" path.
  const setMissedSmokeFlag = useMutation({
    mutationFn: ({ annotationId, value }: { annotationId: number; value: boolean }) =>
      apiClient.updateSequenceAnnotation(annotationId, { has_missed_smoke: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertDetailQueryKey });
    },
    onError: () => {
      showToastNotification('Failed to update missed smoke — try again', 'error');
    },
  });

  const handleMissedSmokeChange = (value: boolean) => {
    setMissedSmoke(value);
    // Answering No also closes a picker opened under a previous Yes, so the
    // gate can't be walked around by leaving it open.
    if (!value) setAddObjectPickerOpen(false);
    if (missedSmokeAnnotationId == null) return;
    setMissedSmokeFlag.mutate({ annotationId: missedSmokeAnnotationId, value });
  };

  // Every editor action autosaves, so a save is silent and leaves the editor
  // open — there is no submit-and-close step left to toast about. Failure
  // still surfaces through `saveDetection`'s own onError.
  const handleEditorCommit = (detection: Detection, items: DetectionAnnotationBbox[]) => {
    if (!modalContext) return;
    saveDetection.mutate({
      laneId: modalContext.laneId,
      detectionId: detection.id,
      existingAnnotation: modalContext.existingAnnotation,
      items,
    });
  };

  // Shared step: accept the winning model boxes for every pending frame of
  // one lane (create-or-update, sequential — fail-fast on the first
  // rejection). Does not submit the lane. Used both by the per-object
  // quick-accept button and by "Accept all & submit alert", which runs this
  // for every workable lane before the atomic localize-submit call.
  const runLaneQuickAccept = useCallback(
    async (laneSequenceId: number) => {
      const lane = alertDetail?.lanes.find(l => l.sequence.id === laneSequenceId);
      if (!lane) throw new Error('Lane not found');
      const detections = detectionsByLaneId[laneSequenceId] ?? [];
      const annotations = new Map(
        (annotationsByLaneId[laneSequenceId] ?? []).map(a => [a.detection_id, a])
      );
      const plan = buildQuickSubmitPlan(
        detections,
        annotations,
        sequenceSmokeType(lane.annotation)
      );
      for (const payload of plan.payloads) {
        if (payload.existingAnnotationId !== null) {
          await apiClient.updateDetectionAnnotation(payload.existingAnnotationId, payload.body);
        } else {
          await apiClient.createDetectionAnnotation({
            detection_id: payload.detection.id,
            ...payload.body,
          });
        }
      }
    },
    [alertDetail, detectionsByLaneId, annotationsByLaneId]
  );

  // Per-object quick-accept: runs the lane's plan, then redraws just that
  // lane's strip/grid status.
  const quickAcceptLane = useMutation({
    mutationFn: async (laneSequenceId: number) => {
      await runLaneQuickAccept(laneSequenceId);
      return laneSequenceId;
    },
    onSuccess: laneSequenceId => {
      queryClient.invalidateQueries({
        queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS, 'by-sequence', laneSequenceId],
      });
      queryClient.invalidateQueries({ queryKey: alertDetailQueryKey });
      showToastNotification("Object's boxes accepted", 'success');
    },
    onError: () => {
      showToastNotification('Failed to accept boxes — try again', 'error');
    },
  });

  // The timeline's rows: identity + per-frame statuses + the "selected"
  // accent for whichever object is currently focused. The quick-accept
  // action no longer rides along here — it lives on the selected object's
  // rail row and above the media column, on the active object.
  const objectStatusRows: AlertObjectStatus[] = frameModel.objectStatus.map(object => ({
    ...object,
    selected: isFocused && activeLaneId === object.laneSequenceId,
  }));

  const workableObjects = objectStatusRows.filter(o => o.workable);

  // Per-object localization progress, derived from the same
  // `statusByTimestamp` the timeline segments render. Keyed by lane rather
  // than positional, so grouping the rail's rows (smoke first, false
  // positives last) can't desynchronize a row from its numbers.
  // 'absent' frames count toward neither total — an object isn't behind on a
  // frame it never appeared on.
  const objectProgress = new Map(
    objectStatusRows.map(object => {
      const present = Object.entries(object.statusByTimestamp).filter(
        ([, status]) => status !== 'absent'
      );
      // Anything not yet confirmed still needs handling — both a frame with
      // a model box waiting ('pending') and one with nothing on it at all
      // ('empty', e.g. every frame of a just-added object).
      const outstanding = present.filter(([, status]) => status !== 'confirmed');
      return [
        object.laneSequenceId,
        { presentCount: present.length, confirmedCount: present.length - outstanding.length },
      ] as const;
    })
  );

  // The rail (and the timeline below it) group false positives after the
  // real objects, so the read-only context can't be mistaken for work.
  // Both consume this same order, keeping their row indices aligned.
  const smokeObjectRows = objectStatusRows.filter(o => !o.isFalsePositive);
  const falsePositiveRows = objectStatusRows.filter(o => o.isFalsePositive);
  const orderedObjectRows = [...smokeObjectRows, ...falsePositiveRows];

  const isObjectLocalized = (object: AlertObjectStatus): boolean => {
    const progress = objectProgress.get(object.laneSequenceId);
    return !!progress && progress.confirmedCount === progress.presentCount;
  };

  // Header progress badge, counted over EVERY object that needs localizing —
  // not just the workable ones. Counting workable-only made a fully localized
  // alert read "0 of 0 objects localized", since a finished lane leaves the
  // workable set entirely; an already-annotated lane is localized, so it
  // belongs in both halves of the fraction.
  const localizedObjectCount = smokeObjectRows.filter(isObjectLocalized).length;

  // Counted straight off the lanes, not off `frameModel` — the model only
  // materializes false-positive lanes while the toggle is ON, so the toggle
  // needs its own source to know whether it has anything to reveal.
  const falsePositiveLaneCount =
    alertDetail?.lanes.filter(
      lane =>
        !!lane.annotation && !laneNeedsLocalization(lane.annotation) && !lane.annotation.is_unsure
    ).length ?? 0;

  // Which actions an object gets, and what they do — shared by the rail row
  // and the media column's CTA bar so the two can't disagree about whether an
  // object is acceptable or correctable.
  const objectActionProps = (object: AlertObjectStatus) => ({
    // Withheld once the lane has nothing pending: re-accepting would fire a
    // mutation with an empty payload and toast success for a no-op. It is
    // also the only way the selected row/bar can show that the accept landed.
    onAcceptBoxes:
      object.workable && !isObjectLocalized(object)
        ? () => quickAcceptLane.mutate(object.laneSequenceId)
        : undefined,
    isAccepting: quickAcceptLane.isPending && quickAcceptLane.variables === object.laneSequenceId,
    // Withheld on false-positive rows: promoting one back to smoke needs an
    // auto-review pass first (issue #275), so offering the action would ship
    // a path that silently does nothing for localize.
    onReclassify: object.isFalsePositive
      ? undefined
      : () => handleReclassify(object.laneSequenceId),
  });

  const renderObjectRow = (object: AlertObjectStatus) => {
    const progress = objectProgress.get(object.laneSequenceId) ?? {
      presentCount: 0,
      confirmedCount: 0,
    };
    const isActive = isFocused && activeLaneId === object.laneSequenceId;
    return (
      <LocalizeObjectRow
        key={object.laneSequenceId}
        label={object.label}
        color={object.color}
        confirmedCount={progress.confirmedCount}
        presentCount={progress.presentCount}
        workable={object.workable}
        smokeType={object.smokeType}
        isFalsePositive={object.isFalsePositive}
        falsePositiveTypes={object.falsePositiveTypes}
        // False positives are always context. An already-localized object is
        // only context when there's still live work beside it — on a fully
        // localized alert those rows are the page's subject.
        dimmed={object.isFalsePositive || (!object.workable && workableObjects.length > 0)}
        isActive={isActive}
        onActivate={() => handleObjectClick(object.laneSequenceId)}
        {...objectActionProps(object)}
      />
    );
  };

  // Names the media column: with an object active the grid shows that
  // object's detections, so the column header should say whose they are.
  // The color also outlines the frames it actually appears on.
  const activeObject = objectStatusRows.find(o => o.laneSequenceId === activeLaneId);
  const activeObjectLabel = activeObject?.label ?? null;

  // Submit gate: every workable object must already have a committed box on
  // every frame it appears on. An object is "accepted" either via its row's
  // Accept-boxes action or by drawing its frames in the editor — submitting
  // is the last step, not a shortcut past the per-object review.
  // Deliberately NOT the badge's count: submit only ships workable lanes, so
  // already-annotated objects must not satisfy (or block) the gate.
  const allObjectsAccepted = workableObjects.length > 0 && workableObjects.every(isObjectLocalized);

  // What the submit button's tooltip says. The blocked case counts the
  // objects rather than restating the rule: "2 objects still have frames
  // without a box" tells you how much is left, where "accept every object's
  // boxes" only tells you what you already tried to do.
  const objectsAwaitingBoxes = workableObjects.filter(o => !isObjectLocalized(o)).length;
  const submitTooltip = allObjectsAccepted
    ? 'Submits every object still awaiting localization, then returns you to the list.'
    : `${objectsAwaitingBoxes} object${objectsAwaitingBoxes === 1 ? '' : 's'} still ${
        objectsAwaitingBoxes === 1 ? 'has' : 'have'
      } frames without a box. Accept or draw them to enable submit.`;

  // Every workable lane's sequence-annotation id — the payload
  // `localizeSubmit` takes, and the set both bulk actions iterate.
  const workableLanes: { laneSequenceId: number; annotationId: number }[] = useMemo(
    () =>
      workableObjects.flatMap(object => {
        const lane = alertDetail?.lanes.find(l => l.sequence.id === object.laneSequenceId);
        if (!lane?.annotation) return [];
        return [{ laneSequenceId: object.laneSequenceId, annotationId: lane.annotation.id }];
      }),
    [workableObjects, alertDetail]
  );

  // Submit: atomically ships the whole alert. No accept step of its own —
  // `allObjectsAccepted` gates the button, so every frame already carries a
  // committed box by the time this can fire.
  const submitAlert = useMutation({
    mutationFn: async () => apiClient.localizeSubmit(workableLanes.map(l => l.annotationId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localization-queue'] });
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
      showToastNotification('Objects submitted', 'success');
      setTimeout(() => navigate(listPath), 1000);
    },
    onError: err => {
      const detail = (err as { detail?: string })?.detail || (err as Error)?.message || '';
      // A rejected submit means the page's view of "everything is accepted"
      // disagreed with the server — refetch each lane so the rows redraw
      // with their true pending counts rather than staying falsely complete.
      workableLanes.forEach(({ laneSequenceId }) => {
        queryClient.invalidateQueries({
          queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS, 'by-sequence', laneSequenceId],
        });
      });
      if (detail.includes('localization incomplete')) {
        showToastNotification('Submit rejected — some frames are not yet annotated', 'error');
        return;
      }
      showToastNotification(`Submit failed: ${detail || 'unknown error'}`, 'error');
    },
  });

  // The missed-smoke soft-confirm ("you flagged missed smoke but added no
  // object") is the only gate left in front of submit — the old two-step
  // no-box warning went away with the bulk-accept-on-submit it guarded:
  // submit now requires every frame to already carry a committed box, so
  // there is never a pending no-box frame left to warn about.
  const handleSubmitClick = () => {
    if (!allObjectsAccepted || submitAlert.isPending) return;
    if (softConfirmNeeded) {
      setMissedSmokeConfirm(true);
      return;
    }
    submitAlert.mutate();
  };

  // Continues past the soft-confirm dialog into the submit — shared by both
  // of its "proceed" options ("Submit anyway" and "Submit & clear flag").
  const proceedPastSoftConfirm = () => {
    setMissedSmokeConfirm(false);
    setSoftConfirmResolved(true);
    submitAlert.mutate();
  };

  const handleSubmitAnyway = () => proceedPastSoftConfirm();

  const handleSubmitAndClearFlag = async () => {
    const flaggedLane = alertDetail?.lanes.find(l => l.annotation?.has_missed_smoke);
    if (flaggedLane?.annotation) {
      await setMissedSmokeFlag.mutateAsync({
        annotationId: flaggedLane.annotation.id,
        value: false,
      });
    }
    proceedPastSoftConfirm();
  };

  // Cropped flipbook: the active object's boxes across all its frames, fed to
  // the loop the selected rail row discloses. It used to hide behind a `Film`
  // toggle in the frame grid's toolbar — a control in one column for
  // something that appeared in another, which is why nobody found it. It now
  // hangs off the row whose object it shows. Selecting nothing shows nothing:
  // there is no "the object" to crop around.
  // A false-positive lane's committed annotation is empty by construction,
  // so the flipbook has to read its engine track instead — otherwise
  // activating an FP object shows no strip at all, and looking closely at
  // the rejected plume is the whole reason the row is on screen.
  const activeLaneIsFalsePositive = activeObject?.isFalsePositive === true;
  const activeLaneBoxes = useMemo(() => {
    if (activeLaneId == null) return [];
    return collectLaneBoxes(
      detectionsByLaneId[activeLaneId] ?? [],
      new Map((annotationsByLaneId[activeLaneId] ?? []).map(a => [a.detection_id, a])),
      { falsePositive: activeLaneIsFalsePositive }
    );
  }, [activeLaneId, detectionsByLaneId, annotationsByLaneId, activeLaneIsFalsePositive]);

  // Keyed on `activeLaneId` alone rather than on focus mode, matching the
  // panel's actions beside it: closing the frame editor leaves an object
  // active without re-entering focus, and that is exactly when someone is
  // most obviously working one object.
  const canShowCrop = activeLaneId != null && activeLaneBoxes.length > 0;

  // Enters (or switches) object-focus mode: crop-on + small cards, a lens
  // for looking closely at just this object, and the selection its rail row
  // needs before it will offer the cropped loop. The pre-focus crop-mode is
  // stashed only the FIRST time focus is entered (`prev => prev ?? cropMode`
  // — a functional update so it reads `cropMode` as of THIS click, before
  // this same call's `setCropMode(true)` below applies) — switching to a
  // different object while already focused (another row, or a segment of a
  // different object) reuses that same stash rather than overwriting it
  // with the just-focused object's now-true crop-mode, so deselecting
  // always restores the settings from *before the first selection*, not
  // from whichever object was focused most recently. `sizeOverrideCleared`
  // only resets on a genuinely fresh entry (see its declaration).
  const activateFocus = (laneSequenceId: number) => {
    setActiveLaneId(laneSequenceId);
    setPreFocusCropMode(prev => prev ?? cropMode);
    setCropMode(true);
    if (!isFocused) setSizeOverrideCleared(false);
  };

  // Deselects: restores the stashed pre-focus crop-mode (and, since
  // `effectiveCardSize` is a derived override, the card size falls back to
  // the untouched persisted preference automatically). The cropped loop goes
  // with the selection, since no row is selected any more. A no-op when not
  // focused.
  const exitFocus = () => {
    if (!isFocused) return;
    setCropMode(preFocusCropMode as boolean);
    setPreFocusCropMode(null);
    setSizeOverrideCleared(false);
    setActiveLaneId(null);
  };

  // Row click: activates (or switches focus to) the clicked object, UNLESS
  // it's already the focused one — a second click on the selected row
  // deselects.
  const handleObjectClick = (laneSequenceId: number) => {
    if (isFocused && activeLaneId === laneSequenceId) {
      exitFocus();
      return;
    }
    activateFocus(laneSequenceId);
  };

  // Reclassify: hands this object's classification to the classify cockpit's
  // done mode, which makes an annotated lane editable at any stage and
  // auto-activates the lane named in the URL — so the annotator lands on the
  // object they clicked. The `return` param brings both classify's back
  // button and its post-save navigation back to this page (with `?frame=`
  // intact, so a deep-linked moment survives the round trip). Built from
  // `listPath`, not a hardcoded queue prefix, so a reclassify started from
  // done mode returns to `/localize/done/:id` rather than dumping the
  // annotator on the queue-mode page for the same alert.
  const handleReclassify = (laneSequenceId: number) => {
    if (sequenceIdNum == null) return;
    navigate(
      classifyDetailWithReturn(laneSequenceId, `${listPath}/${sequenceIdNum}${location.search}`)
    );
  };

  // Re-review fix: an explicit S/M/L click always writes the real
  // preference (unchanged); while focused, it ALSO cancels the 'sm'
  // override for the rest of this session so the click has immediate
  // visible effect instead of silently writing a preference the grid
  // doesn't yet honor. Focus (crop-mode, active lane, the cropped strip)
  // continues unaffected.
  const handleCardSizeChange = (size: CardSize) => {
    setCardSize(size);
    if (isFocused) setSizeOverrideCleared(true);
  };

  // Hiding false positives again while one is the ACTIVE object would strand
  // `activeLaneId` on a lane the frame model no longer contains: every
  // remaining cell then reads as "not this object's frame", dimming the whole
  // grid and making it unclickable with no way back except clicking a row.
  // Deselect first. `exitFocus` is a no-op when not focused, so the explicit
  // `setActiveLaneId(null)` covers that path too.
  const handleToggleFalsePositives = () => {
    if (showFalsePositives && activeLaneIsFalsePositive) {
      exitFocus();
      setActiveLaneId(null);
    }
    setShowFalsePositives(prev => !prev);
  };

  // Segment click: activates/switches focus (same re-stash semantics as
  // `activateFocus`), scrolls to the frame, gives it a fading arrival
  // highlight, and encodes the shown detection in `?frame=` so the moment
  // is shareable/reloadable (read back by the deep-link effect below).
  const handleSegmentClick = (laneSequenceId: number, timestamp: string) => {
    activateFocus(laneSequenceId);
    highlightFrame(timestamp);

    const cellDetectionId = frameModel.frames
      .find(f => f.recordedAt === timestamp)
      ?.cells.find(c => c.laneSequenceId === laneSequenceId)?.detectionId;
    if (cellDetectionId != null) {
      handledFrameParamRef.current = cellDetectionId;
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set('frame', String(cellDetectionId));
          return next;
        },
        { replace: true }
      );
    }

    requestAnimationFrame(() => {
      frameRefs.current[timestamp]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  // "+ Add object": the ⚑ row's replacement for missed smoke — spawns a
  // brand-new sibling lane server-side (empty algo_predictions, one-track
  // smoke annotation born at seq_annotation_done; see the backend's
  // `/alert/add-object`) rather than drawing an anonymous box on an
  // existing lane. On success: invalidate alert-detail so the new Object
  // N+1 row appears (its index/color fall out of its position in
  // `alertDetail.lanes`, same as any other lane), record its lane id in
  // `sessionAddedObjects` (feeds the soft-confirm gate above), close the
  // picker, and auto-enter focus mode on it — a lens for immediately
  // drawing its boxes. Repeatable: each success re-closes the picker so a
  // further click reopens it for another add.
  const addObject = useMutation({
    mutationFn: (smokeType: SmokeType) => {
      if (!sequence) throw new Error('Alert not loaded');
      return apiClient.addObject(sequence.source_api, sequence.platform_alert_id, smokeType);
    },
    onSuccess: newLane => {
      queryClient.invalidateQueries({ queryKey: alertDetailQueryKey });
      setSessionAddedObjects(prev => [...prev, newLane.sequence.id]);
      setAddObjectPickerOpen(false);
      activateFocus(newLane.sequence.id);
      showToastNotification('Object added', 'success');
    },
    onError: () => {
      showToastNotification('Failed to add object — try again', 'error');
    },
  });

  const handleCellRef = (recordedAt: string, el: HTMLDivElement | null) => {
    frameRefs.current[recordedAt] = el;
  };

  // Opens the shown (active, or first-present-fallback) object's detection
  // in the editor and makes that lane active, per Task 4. Deliberately
  // plain `setActiveLaneId` (not `activateFocus`) — opening the editor
  // shouldn't also silently flip the background grid into focus mode.
  const handleCellClick = (_recordedAt: string, laneSequenceId: number, detId: number) => {
    setActiveLaneId(laneSequenceId);
    if (sequenceIdNum != null)
      navigate(
        `${localizeObject(sequenceIdNum, laneSequenceId, detId, mode === 'done')}${location.search}`
      );
  };

  // 'c' toggles crop mode, matching the legacy grid — inert while the modal
  // is open (mirrors the legacy page's showModal guard).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'c' || e.key === 'C') && detectionIdNum == null) {
        setCropMode(prev => !prev);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detectionIdNum]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ember"></div>
      </div>
    );
  }

  if (error || !alertDetail) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="font-body text-sm text-signal mb-2">Failed to load alert</p>
          <p className="font-body text-detail text-haze">{String(error)}</p>
          <button
            onClick={() => navigate(listPath)}
            className="mt-4 font-body text-detail text-haze hover:text-char"
          >
            Back to Alerts
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Pinned header, one row deep: the back link used to sit on a line of
          its own above the identity row, and that second line was 32px of
          the viewport the frame grid below now keeps. `h-12` is a fixed
          height rather than one derived from padding, because the root's
          reserve below has to be an exact number, not a guess. */}
      <div className="fixed top-0 left-0 md:left-64 right-0 z-30 flex h-12 items-center gap-3 px-6 bg-paper/85 border-b border-line backdrop-blur-sm">
        <button
          onClick={() => navigate(listPath)}
          className="font-body text-detail text-haze hover:text-char inline-flex shrink-0 items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Alerts
        </button>
        <span className="h-4 w-px shrink-0 bg-line" />
        <h1 className="font-display text-heading font-semibold text-char truncate">
          {alertDetail.organisation_name} · {alertDetail.camera_name}
        </h1>
        {/* One row means nothing wraps, so the narrowest viewports have to
            shed something rather than squeeze the title to nothing and push
            the badge off a bar that cannot scroll. The timestamp goes first:
            every frame cell below carries its own. */}
        <span className="hidden sm:inline font-data text-detail text-haze shrink-0">
          {formatDateTime(alertDetail.recorded_at)}
        </span>
        <span
          className={`flex-none rounded-full px-2.5 py-0.5 font-data text-xs font-semibold ${
            smokeObjectRows.length > 0 && localizedObjectCount === smokeObjectRows.length
              ? 'bg-pine-soft text-pine'
              : 'bg-ember-soft text-ember'
          }`}
        >
          {localizedObjectCount} of {smokeObjectRows.length} object
          {smokeObjectRows.length === 1 ? '' : 's'} localized
        </span>
      </div>

      {/* Cockpit: media column (the active object's frames) + the rail (the
          whole alert's localization state), mirroring ClassifyAlertPage.
          From lg up the whole thing is a viewport-height shell that never
          scrolls: the frame cells are the only scroller on the page, so the
          controls that act on them — the Frames panel and the cropped loop
          above, the Objects rail and Timeline beside — stay on screen no
          matter how deep into the grid you are. `calc(100vh-3rem)` is the
          viewport less AppLayout's `p-6` top and bottom; `pt-8` clears the
          48px header, 24px of which the same padding already covers. Below
          lg the columns stack and the page scrolls normally, which is the
          only thing that works on a narrow viewport. */}
      <div className="flex flex-col gap-4 pt-8 lg:h-[calc(100vh-3rem)] lg:flex-row lg:overflow-hidden">
        {/* min-h-0 on every flex-column ancestor of a scroller: the default
            `min-height: auto` would let the cells push the column past the
            viewport, and the page would scroll instead of the grid. */}
        <div className="lg:flex lg:min-h-0 lg:flex-[1.5] lg:min-w-0 lg:flex-col">
          {/* Everything that acts on the frames, in one bar above the card
              that holds them: which object they belong to, what to do about
              it, and how to render them. The actions are driven by
              `activeLaneId` alone, not by focus mode — closing the frame
              editor leaves an object active without re-entering focus, and
              that is exactly when the annotator is most obviously working one
              object. */}
          <LocalizeActionPanel
            // Which object's images the cells are showing — invisible before
            // the cockpit split, and the grid's cells only make sense once
            // you know whose frames they are.
            title={`Frames${activeObjectLabel ? ` — ${activeObjectLabel}` : ''}`}
            color={activeObject?.color}
            actions={
              activeObject && (
                <LocalizeObjectActions
                  label={activeObject.label}
                  size="prominent"
                  {...objectActionProps(activeObject)}
                />
              )
            }
            controls={
              <>
                <span className="font-data text-detail text-haze">
                  {frameModel.frames.length} frame{frameModel.frames.length === 1 ? '' : 's'}
                </span>
                {/* Sits with the panel's other view controls because that is
                    where its effect lands — the loop opens directly below,
                    above the frames it is cropped from. Withheld until a lane
                    with boxes is active, so it never opens onto an empty
                    square. Its own pill rather than a slot inside ViewToolbar:
                    that toolbar is about how the CELLS render, and this opens
                    a different view entirely — but it borrows the toolbar's
                    pressed language so the two read as peers.
                    The name stays put and `aria-expanded` carries the state;
                    a name that also flipped Show/Hide would announce the state
                    twice, in two directions. */}
                {canShowCrop && (
                  <div className="inline-flex items-center rounded-lg bg-ash p-0.5">
                    <button
                      type="button"
                      title="Cropped view — loop this object's crops across its frames"
                      aria-label="Cropped view"
                      aria-expanded={cropExpanded}
                      onClick={() => setCropExpanded(prev => !prev)}
                      className={`rounded p-1.5 transition-colors ${
                        cropExpanded ? 'bg-pine-soft text-pine' : 'text-haze hover:text-char'
                      }`}
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <ViewToolbar
                  cardSize={effectiveCardSize}
                  onCardSizeChange={handleCardSizeChange}
                  cropMode={cropMode}
                  onToggleCropMode={setCropMode}
                />
              </>
            }
          />

          {/* Between the panel and the frames: the loop is what the frames
              look like close up, so it reads as a lead-in to the grid rather
              than as a separate widget. Capped by viewport height so a tall
              loop can't push every frame below the fold. */}
          {/* A block wrapper, NOT `flex justify-center`: the loop's own root
              is `w-full max-w-…` and centres itself with `mx-auto`. Make that
              root a flex item and it gets shrink-to-fit width, whose only
              content is an absolutely-positioned canvas — so `w-full`
              resolves against ~zero and the square collapses to a few pixels.
              Centring is the component's job; the wrapper just gives it a
              width to fill. */}
          {/* `shrink-0`, because it is pinned above the scroller: the loop
              keeps its full height and the grid takes what is left, rather
              than the loop squashing as the cells grow. */}
          {canShowCrop && cropExpanded && activeLaneId != null && (
            <div className="mb-4 shrink-0">
              <CroppedImageSequence
                bboxes={activeLaneBoxes}
                sequenceId={activeLaneId}
                accentColor={activeObject?.color}
                maxSize="min(420px, 40vh)"
              />
            </div>
          )}

          {/* The cells sit straight on the page, with no card of their own:
              everything that frames them — the object, the actions, the view
              controls — moved up into the panel above, so a second border
              around the images was drawing a box around a box. The images
              carry their own edges.

              This wrapper is the page's only scroller. `scrollIntoView` on
              the cell refs (the `?frame=` deep link, timeline segment
              clicks) resolves against the nearest scrollable ancestor, so it
              now scrolls this container rather than the window — same
              behavior, smaller box. */}
          <div
            data-testid="frame-grid-scroller"
            className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
          >
            <AlertFrameGrid
              frames={frameModel.frames}
              activeLaneId={activeLaneId}
              onCellClick={handleCellClick}
              cellRef={handleCellRef}
              cardMinWidth={cardMinWidth}
              cropMode={cropMode}
              highlightedFrame={highlightedFrame}
            />
          </div>
        </div>

        {/* The rail no longer sticks: it is a full-height column of the
            shell, so its ceiling is structural rather than a max-height
            guess. Objects and Timeline scroll together inside it when the
            alert has more objects than fit. */}
        <div className="lg:flex lg:min-h-0 lg:flex-1 lg:min-w-0 lg:flex-col lg:overflow-y-auto">
          <LocalizeRail
            // The toggle governs which object ROWS exist, so it belongs with
            // Objects rather than with the frame grid's view controls.
            headerAction={
              <button
                type="button"
                aria-pressed={showFalsePositives}
                disabled={falsePositiveLaneCount === 0}
                onClick={handleToggleFalsePositives}
                title={
                  falsePositiveLaneCount === 0
                    ? 'This alert has no false-positive objects'
                    : 'Show objects classify settled as false positives, as read-only context'
                }
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-body text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  showFalsePositives
                    ? 'border-char bg-ash text-char'
                    : 'border-line bg-paper text-haze hover:text-char'
                }`}
              >
                False positives
                {falsePositiveLaneCount > 0 && (
                  <span className="font-data text-[10px] font-semibold">
                    {falsePositiveLaneCount}
                  </span>
                )}
              </button>
            }
            missedSmoke={
              <LocalizeMissedSmokeRow
                hasMissedSmoke={missedSmoke}
                onChange={handleMissedSmokeChange}
                isSaving={setMissedSmokeFlag.isPending}
                disabled={missedSmokeAnnotationId == null}
                addObject={
                  /* "+ Add object" lives inside the question it answers, and
                     only exists once that answer is Yes — a control that
                     appears with the reason for it, rather than a dead button
                     waiting on something above it. */
                  addObjectPickerOpen ? (
                    <>
                      <span className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                        Smoke type
                      </span>
                      {(['wildfire', 'industrial', 'other'] as SmokeType[]).map(type => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => addObject.mutate(type)}
                          disabled={addObject.isPending}
                          className="inline-flex items-center rounded-full bg-ash px-3 py-1 font-body text-xs font-medium capitalize text-haze transition-colors hover:bg-pine-soft hover:text-pine disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {type}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setAddObjectPickerOpen(false)}
                        className="font-body text-detail text-haze hover:text-char"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddObjectPickerOpen(true)}
                      title="Add an object the AI missed entirely"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-2 font-body text-sm font-medium text-char hover:bg-ash"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add object
                    </button>
                  )
                }
              />
            }
            footer={
              workableObjects.length === 0 ? (
                <p
                  data-testid="all-objects-localized"
                  className="text-center font-body text-detail text-haze"
                >
                  All objects localized
                </p>
              ) : (
                <div className="flex justify-center">
                  {/* The tooltip carries the gate's explanation, which used to
                      be a line of copy under the button. Hovering the thing
                      you can't click is where the question gets asked, and it
                      names HOW MANY objects are holding submit back rather
                      than restating the rule — otherwise the gate reads as a
                      bug once every row looks handled but one still has a
                      pending frame. Above, because the footer is the last
                      thing in a rail that scrolls. */}
                  <Tooltip placement="above" tip={submitTooltip}>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        handleSubmitClick();
                      }}
                      disabled={!allObjectsAccepted || submitAlert.isPending}
                      className="flex items-center justify-center rounded-lg bg-pine px-5 py-2.5 text-center font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submitAlert.isPending ? (
                        <div className="w-3.5 h-3.5 mr-1.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                      )}
                      Submit
                    </button>
                  </Tooltip>
                </div>
              )
            }
          >
            {smokeObjectRows.map(renderObjectRow)}

            {/* False positives are read-only context, not work — a labeled
                break keeps them from reading as more objects to localize. */}
            {falsePositiveRows.length > 0 && (
              <div data-testid="false-positive-divider" className="flex items-center gap-2 pt-2.5">
                <span className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  False positives
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            {falsePositiveRows.map(renderObjectRow)}
          </LocalizeRail>

          {/* Per-frame temporal context + color legend for the rail's
              objects, in the same slot classify gives ObjectPresenceStrip.
              Context (already-localized) objects render here too, so the
              row indices line up 1:1 with the rail above. */}
          <div className="mt-4">
            <ObjectStatusStrip
              objects={orderedObjectRows}
              onObjectClick={i => handleObjectClick(orderedObjectRows[i].laneSequenceId)}
              onSegmentClick={(i, ts) =>
                handleSegmentClick(orderedObjectRows[i].laneSequenceId, ts)
              }
              title="Timeline"
            />
          </div>
        </div>
      </div>

      {modalContext && (
        <LocalizeObjectEditor
          laneSequenceId={modalContext.laneId}
          objectLabel={modalObject?.label ?? 'Object'}
          objectColor={modalObject?.color ?? '#2a78d6'}
          smokeType={selectedSmokeType}
          detection={modalContext.detection}
          existingAnnotation={modalContext.existingAnnotation}
          laneDetections={laneDetectionsSorted}
          laneAnnotations={annotationsByLaneId[modalContext.laneId] ?? []}
          alertFrames={frameModel.frames}
          objectOverlays={objectOverlays}
          isSaving={saveDetection.isPending}
          isAccepting={quickAcceptLane.isPending}
          onCommit={handleEditorCommit}
          onAcceptRemaining={() => quickAcceptLane.mutate(modalContext.laneId)}
          onReclassify={() => handleReclassify(modalContext.laneId)}
          onNavigateToDetection={navigateModalTo}
          onClose={closeModal}
        />
      )}

      {missedSmokeConfirm && (
        <div
          data-testid="missed-smoke-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-char/40 px-4"
        >
          <div className="w-full max-w-sm rounded-lg border border-line bg-paper p-5">
            <p className="font-body text-sm text-char mb-4">
              You flagged missed smoke but added no object — submit anyway?
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSubmitAndClearFlag}
                className="inline-flex items-center justify-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
              >
                Submit & clear flag
              </button>
              <button
                type="button"
                onClick={handleSubmitAnyway}
                className="inline-flex items-center justify-center rounded-lg border border-line bg-paper px-4 py-2 font-body text-sm font-medium text-char hover:bg-ash"
              >
                Submit anyway
              </button>
              <button
                type="button"
                onClick={() => setMissedSmokeConfirm(false)}
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 font-body text-sm font-medium text-haze hover:text-char"
              >
                Go back
              </button>
            </div>
          </div>
        </div>
      )}

      <NotificationSystem
        showToast={showToast}
        toastMessage={toastMessage}
        toastType={toastType}
        onDismiss={dismissToast}
      />
    </>
  );
}
