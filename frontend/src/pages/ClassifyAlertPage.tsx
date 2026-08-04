/**
 * Collocated classify/done-review screen: renders every object (lane) of
 * one alert. Mounted at `/classify/:id` (queue mode) and
 * `/classify/done/:id` (`mode="done"`, entered from the Done list).
 *
 * Queue mode submits all editable lanes atomically via a single
 * `classifySubmit` call; done mode instead PATCHes only the lanes the
 * annotator actually changed via `updateSequenceAnnotation`, since lanes
 * there are independently re-editable regardless of stage rather than
 * moving through the pipeline together. `AnnotationInterface` no longer
 * has a route but stays in the tree (removal is a separate cleanup).
 *
 * Card identity is `${laneSequenceId}:${trackIndex}` (never a flat array
 * index) — all per-card state (classification, unsure, refs, active card)
 * keys on it. The index-based keyboard/navigation utilities shared with
 * AnnotationInterface are fed through a thin position <-> cardKey adapter
 * computed fresh each render from the (stably ordered) flattened card list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Keyboard, Upload, X } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import {
  AlertDetail,
  AlertLane,
  ClassifySubmitItem,
  ClassifySubmitResult,
  Detection,
  SequenceAnnotation,
  SequenceBbox,
} from '@/types/api';
import { useSequenceStore } from '@/store/useSequenceStore';
import { hasUserAnnotations, getInitialMissedSmokeReview } from '@/utils/annotation/sequenceUtils';
import { determineClassifySubmitStage } from '@/utils/annotation/localizeUtils';
import { createKeyboardHandler } from '@/utils/annotation/keyboardUtils';
import {
  createPreviousDetectionNavigator,
  createNextDetectionNavigator,
} from '@/utils/annotation/navigationUtils';
import { getObjectColor, ObjectOverlay } from '@/utils/annotation/objectColors';
import { getProcessingStageLabel } from '@/utils/processingStage';
import { CardClassification, ObjectPresenceStrip } from '@/components/sequence-annotation';
import { ClassifyMediaPanel, DecisionRail, ObjectRow } from '@/components/classify';
import { NotificationSystem } from '@/components/ui/NotificationSystem';
import { useToastNotifications } from '@/utils/notification/toastUtils';
import { ROUTES, classifyDetail, classifyGroup } from '@/utils/routes';

/**
 * Locked lanes render read-only and are excluded from the submit payload.
 *
 * Queue mode: a lane is locked once it has no annotation yet, or is already
 * past ready_to_annotate (seq_annotation_done / annotated) — those are only
 * editable from the done view.
 *
 * Done mode inverts the stage half of that rule: any lane WITH an
 * annotation is editable regardless of stage (it's genuinely labeled, so it
 * pre-fills as Reviewed and can be corrected here); only a lane with no
 * annotation at all (not yet imported) stays a locked placeholder.
 */
function isLaneLocked(lane: AlertLane, mode?: 'done'): boolean {
  if (mode === 'done') return !lane.annotation;
  return (
    !lane.annotation ||
    lane.annotation.processing_stage === 'seq_annotation_done' ||
    lane.annotation.processing_stage === 'annotated'
  );
}

/** JSON-shape equality for two SequenceBbox arrays — enough to detect a real edit. */
function bboxesEqual(a: SequenceBbox[] | undefined, b: SequenceBbox[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** One card slot in the flattened, stably-ordered list driving keyboard nav. */
interface FlatCard {
  cardKey: string;
  laneSequenceId: number;
  trackIndex: number;
  isPrimary: boolean;
  locked: boolean;
}

/** One object's precomputed color identity + track boxes, keyed by frame `recorded_at`. */
interface CardOverlayData {
  cardKey: string;
  laneSequenceId: number;
  color: string;
  label: string;
  boxesByRecordedAt: Record<string, [number, number, number, number]>;
  /** `bbox.bboxes[i]`'s detection `recorded_at`, aligned by index to the card's own bboxes array. */
  frameRecordedAt: (string | undefined)[];
}

const EMPTY_BBOX: SequenceBbox = { is_smoke: false, false_positive_types: [], bboxes: [] };

/**
 * Best-effort server detail extraction for a submit failure toast. The
 * apiClient's own axios interceptor normally already reshapes errors to
 * `{ detail }` (see services/api.ts) before they reach a caller, but this
 * stays defensive against a raw axios error (`response.data.detail`)
 * reaching here too.
 */
function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const candidate = err as {
      detail?: unknown;
      response?: { data?: { detail?: unknown } };
      message?: string;
    };
    if (typeof candidate.detail === 'string') return candidate.detail;
    if (typeof candidate.response?.data?.detail === 'string') return candidate.response.data.detail;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'Please try again.';
}

interface ClassifyAlertPageProps {
  /**
   * 'done' when mounted under /classify/done/:id — entered from the Done
   * list. Lanes with an existing annotation become editable regardless of
   * their stage (instead of only ready_to_annotate lanes); submit PATCHes
   * only the lanes that actually changed via `updateSequenceAnnotation`
   * instead of the atomic `classifySubmit`.
   */
  mode?: 'done';
}

export default function ClassifyAlertPage({ mode }: ClassifyAlertPageProps = {}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Back navigation target follows the route provenance (queue vs done list).
  const backUrl = mode === 'done' ? ROUTES.CLASSIFY_DONE : ROUTES.CLASSIFY;
  const {
    getNextSequenceInWorkflow,
    clearAnnotationWorkflow,
    annotationWorkflow,
    navigateToPreviousInWorkflow,
    navigateToNextInWorkflow,
    canNavigatePrevious,
    canNavigateNext,
  } = useSequenceStore();

  const sequenceId = id ? parseInt(id) : null;

  const [laneBboxes, setLaneBboxes] = useState<Record<number, SequenceBbox[]>>({});
  const [primaryClassification, setPrimaryClassification] = useState<
    Record<string, CardClassification>
  >({});
  const [laneUnsure, setLaneUnsure] = useState<Record<number, boolean>>({});
  const [missedSmokeReview, setMissedSmokeReview] = useState<'yes' | 'no' | null>(null);
  const [hasMissedSmoke, setHasMissedSmoke] = useState<boolean>(false);

  const [activeCardKey, setActiveCardKey] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'detections' | 'sequence'>('detections');
  const [showKeyboardModal, setShowKeyboardModal] = useState(false);
  const [groupConflictWarnings, setGroupConflictWarnings] = useState<
    { message: string; groupId: number | null }[]
  >([]);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sequenceReviewerRef = useRef<HTMLDivElement | null>(null);
  const railSubmitRef = useRef<HTMLButtonElement | null>(null);

  // Done mode only: snapshot of the just-loaded (or just-reset) state, used
  // to diff against current state at submit time so only lanes the
  // annotator actually touched get PATCHed.
  const initialSnapshotRef = useRef<{
    laneBboxes: Record<number, SequenceBbox[]>;
    laneUnsure: Record<number, boolean>;
    hasMissedSmoke: boolean;
  } | null>(null);

  const { showToast, toastMessage, toastType, showToastNotification, dismissToast } =
    useToastNotifications();

  // Resolve the alert (source_api, platform_alert_id) from the entry sequence id.
  const {
    data: sequence,
    isLoading: sequenceLoading,
    error: sequenceError,
  } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(sequenceId!),
    queryFn: () => apiClient.getSequence(sequenceId!),
    enabled: !!sequenceId,
  });

  // Shared with the submit mutation so it can invalidate/refetch this exact
  // query after a submit (success-with-warning or error) so the page
  // redraws lanes with their true, post-submit server state.
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

  // Clear state immediately when the alert changes to prevent stale data.
  useEffect(() => {
    setLaneBboxes({});
    setPrimaryClassification({});
    setLaneUnsure({});
    setMissedSmokeReview(null);
    setHasMissedSmoke(false);
    setActiveCardKey(null);
    setGroupConflictWarnings([]);
  }, [sequenceId]);

  const initializeFromAlertDetail = (detail: AlertDetail) => {
    const newLaneBboxes: Record<number, SequenceBbox[]> = {};
    const newPrimaryClassification: Record<string, CardClassification> = {};
    const newLaneUnsure: Record<number, boolean> = {};
    let newMissedSmokeReview: 'yes' | 'no' | null = null;
    let newHasMissedSmoke = false;

    detail.lanes.forEach((lane, laneIdx) => {
      const isPrimary = laneIdx === 0;
      if (isPrimary && lane.annotation) {
        newHasMissedSmoke = lane.annotation.has_missed_smoke || false;
        newMissedSmokeReview = getInitialMissedSmokeReview(lane.annotation);
      }
      // Locked lanes are still seeded here (read-only display data) — only
      // a missing annotation (not yet imported) has nothing to seed. The
      // mutation handlers below independently guard `card.locked` so this
      // data is never written back to.
      if (!lane.annotation) return;

      // The alert-API import writes each object's single track as a
      // structural placeholder (`is_smoke: true, smoke_type: null`), not a
      // human decision. Normalize `null` to `undefined` so "has a real
      // smoke_type" checks below (and hasUserAnnotations, called on this
      // same seeded data for the status badge / submit enablement) treat it
      // as unset — mirrors sequenceUtils semantics. A genuinely pre-filled
      // track (e.g. group inheritance) always carries a real SmokeType and
      // is unaffected.
      const bboxes = lane.annotation.annotation.sequences_bbox.map(bbox => ({
        ...bbox,
        smoke_type: bbox.smoke_type ?? undefined,
      }));
      newLaneBboxes[lane.sequence.id] = bboxes;
      newLaneUnsure[lane.sequence.id] = lane.annotation.is_unsure || false;
      bboxes.forEach((bbox, trackIndex) => {
        const cardKey = `${lane.sequence.id}:${trackIndex}`;
        // A track only counts as classified when it has a real smoke_type or
        // at least one false-positive type (mirrors
        // sequenceUtils.hasUserAnnotations/getClassificationType). Bare
        // `is_smoke: true` with no type — the import placeholder — starts
        // unselected/Needs Review, not pre-filled as smoke.
        newPrimaryClassification[cardKey] =
          bbox.is_smoke && bbox.smoke_type !== undefined
            ? 'smoke'
            : bbox.false_positive_types.length > 0
              ? 'false_positive'
              : 'unselected';
      });
    });

    setLaneBboxes(newLaneBboxes);
    setPrimaryClassification(newPrimaryClassification);
    setLaneUnsure(newLaneUnsure);
    setMissedSmokeReview(newMissedSmokeReview);
    setHasMissedSmoke(newHasMissedSmoke);

    // Done mode's "only PATCH what changed" diff base. Re-set on every call
    // (including handleReset's) so reset also resets what counts as changed.
    initialSnapshotRef.current = {
      laneBboxes: newLaneBboxes,
      laneUnsure: newLaneUnsure,
      hasMissedSmoke: newHasMissedSmoke,
    };
  };

  // Initialize card state once the alert's lanes load.
  useEffect(() => {
    if (alertDetail) initializeFromAlertDetail(alertDetail);
  }, [alertDetail]);

  // One continuously-numbered, stably-ordered render list: one entry per
  // track of each lane (post-split, that's one per lane; legacy multi-track
  // lanes get one entry per track), or a single read-only placeholder entry
  // for a lane with no annotation at all (not yet imported).
  type RenderItem =
    | { kind: 'card'; laneSequenceId: number; card: FlatCard }
    | { kind: 'placeholder'; laneSequenceId: number };

  const renderItems: RenderItem[] = useMemo(() => {
    if (!alertDetail) return [];
    const result: RenderItem[] = [];
    alertDetail.lanes.forEach((lane, laneIdx) => {
      if (!lane.annotation) {
        result.push({ kind: 'placeholder', laneSequenceId: lane.sequence.id });
        return;
      }
      lane.annotation.annotation.sequences_bbox.forEach((_, trackIndex) => {
        result.push({
          kind: 'card',
          laneSequenceId: lane.sequence.id,
          card: {
            cardKey: `${lane.sequence.id}:${trackIndex}`,
            laneSequenceId: lane.sequence.id,
            trackIndex,
            isPrimary: laneIdx === 0,
            locked: isLaneLocked(lane, mode),
          },
        });
      });
    });
    return result;
  }, [alertDetail, mode]);

  // Keyboard/nav-facing flattened card list (placeholders excluded — they
  // have nothing to classify or navigate into).
  const cards: FlatCard[] = useMemo(
    () =>
      renderItems
        .filter((item): item is Extract<RenderItem, { kind: 'card' }> => item.kind === 'card')
        .map(item => item.card),
    [renderItems]
  );

  const editableCards = cards.filter(c => !c.locked);

  // Cockpit: the media column always shows the active thing, so an object
  // must be active from the start. Queue mode activates the first editable
  // card (first card as fallback for fully-locked deep links); done mode
  // keeps its own entry-sequence activation effect below.
  useEffect(() => {
    if (mode === 'done' || activeCardKey !== null || cards.length === 0) return;
    const first = cards.find(c => !c.locked) ?? cards[0];
    setActiveCardKey(first.cardKey);
    setActiveSection('detections');
    // Seed focus on the row so Tab / Shift+Tab cycle the rail immediately.
    // Synchronous (the row is already committed) — a deferred focus could
    // fire AFTER the user activates another row and steal activation back.
    cardRefs.current[first.cardKey]?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cards]);

  // Done mode only: the sequence the annotator clicked in the Done list is
  // its own card's lane — scroll-activate that card once the alert's cards
  // are on screen, so they land exactly where they came from.
  useEffect(() => {
    if (mode !== 'done' || !sequenceId) return;
    const cardKey = `${sequenceId}:0`;
    if (!cards.some(c => c.cardKey === cardKey)) return;
    setActiveCardKey(cardKey);
    setActiveSection('detections');
    // Focus synchronously (see the queue-mode effect above); only the
    // scroll is deferred a frame.
    cardRefs.current[cardKey]?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      cardRefs.current[cardKey]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sequenceId, alertDetail]);

  const getBbox = (card: FlatCard): SequenceBbox =>
    laneBboxes[card.laneSequenceId]?.[card.trackIndex] ?? EMPTY_BBOX;

  // --- Multi-object color-coded overlays: one color identity per object,
  // consistent across its own card's accent swatch, the shared player's
  // track overlay, and every other card's dimmed sibling overlay in its
  // full-frame view. Colors/labels follow the same "Object N" numbering as
  // the on-screen render loop below (computed from `renderItems`, not
  // `cards`, so placeholders still consume a number and nothing drifts).
  //
  // A lane's own track boxes (`bbox.bboxes`) reference *that lane's*
  // detection ids, which don't carry `recorded_at` themselves — so each
  // lane appearing on screen needs its own small detections fetch to build
  // the detection_id -> recorded_at join used to place its boxes on frames.
  // Cached by TanStack Query under the same key `useSequenceDetections`
  // uses, so this shares its cache with the primary lane's own fetch inside
  // the player.
  const laneSequenceIds = Array.from(new Set(cards.map(c => c.laneSequenceId)));

  const laneDetectionsQueries = useQueries({
    queries: laneSequenceIds.map(laneSequenceId => ({
      queryKey: QUERY_KEYS.SEQUENCE_DETECTIONS(laneSequenceId),
      queryFn: () => apiClient.getSequenceDetections(laneSequenceId),
      staleTime: 1000 * 60 * 5,
    })),
  });

  const detectionsByLaneId: Record<number, Detection[]> = {};
  laneSequenceIds.forEach((laneSequenceId, i) => {
    detectionsByLaneId[laneSequenceId] = laneDetectionsQueries[i]?.data ?? [];
  });

  const cardOverlayData: CardOverlayData[] = [];
  renderItems.forEach((item, i) => {
    if (item.kind !== 'card') return;
    const { card } = item;
    const bbox = getBbox(card);
    const idToRecordedAt = new Map(
      (detectionsByLaneId[card.laneSequenceId] ?? []).map(d => [d.id, d.recorded_at])
    );
    const boxesByRecordedAt: Record<string, [number, number, number, number]> = {};
    const frameRecordedAt: (string | undefined)[] = [];
    bbox.bboxes.forEach(b => {
      const recordedAt = idToRecordedAt.get(b.detection_id);
      frameRecordedAt.push(recordedAt);
      if (recordedAt) boxesByRecordedAt[recordedAt] = b.xyxyn;
    });
    cardOverlayData.push({
      cardKey: card.cardKey,
      laneSequenceId: card.laneSequenceId,
      color: getObjectColor(i),
      label: `Object ${i + 1}`,
      boxesByRecordedAt,
      frameRecordedAt,
    });
  });

  const playerObjectOverlays: ObjectOverlay[] = cardOverlayData.map(o => ({
    color: o.color,
    label: o.label,
    boxesByRecordedAt: o.boxesByRecordedAt,
    isActive: o.cardKey === activeCardKey,
  }));

  // The media panel always shows the active object's players (the panel
  // itself swaps to the whole-alert player when the missed-smoke section is
  // active). Null only when the alert has no cards at all.
  const activeCard = activeCardKey ? cards.find(c => c.cardKey === activeCardKey) : undefined;
  const activeOverlay = activeCard
    ? cardOverlayData.find(o => o.cardKey === activeCard.cardKey)
    : undefined;

  // Frame union across every lane, deduped by recorded_at (sibling lanes
  // materialize the same physical frame as their own detection). The active
  // object's full-frame player runs over this union so frames its own track
  // has no box on still play — just without the box — instead of being
  // skipped. Falls back to the track's own frames until detections resolve.
  const unionFrames: { detection_id: number; recorded_at: string }[] = [];
  {
    const seenFrames = new Set<string>();
    Object.values(detectionsByLaneId)
      .flat()
      .forEach(d => {
        if (seenFrames.has(d.recorded_at)) return;
        seenFrames.add(d.recorded_at);
        unionFrames.push({ detection_id: d.id, recorded_at: d.recorded_at });
      });
    unionFrames.sort(
      (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    );
  }

  const activeMediaObject = activeCard
    ? {
        label: activeOverlay?.label ?? 'Object',
        bboxes:
          unionFrames.length > 0
            ? unionFrames.map(f => ({
                detection_id: f.detection_id,
                xyxyn: activeOverlay?.boxesByRecordedAt[f.recorded_at] ?? null,
              }))
            : getBbox(activeCard).bboxes,
        croppedBboxes: getBbox(activeCard).bboxes,
        sequenceId: activeCard.laneSequenceId,
        color: activeOverlay?.color,
        siblingOverlays: cardOverlayData
          .filter(o => o.cardKey !== activeCard.cardKey)
          .map(o => ({ color: o.color, label: o.label, boxesByRecordedAt: o.boxesByRecordedAt })),
        frameRecordedAt:
          unionFrames.length > 0
            ? unionFrames.map(f => f.recorded_at)
            : (activeOverlay?.frameRecordedAt ?? []),
      }
    : null;

  // Presence strip: temporal context + color legend, keyed off the same
  // per-object color/label identity as the overlays above. Renders nothing
  // itself for < 2 objects. Timestamps come from the object's *lane's*
  // detections (every frame the lane was captured on), not from
  // `boxesByRecordedAt` — a lane can have a detection on a frame with no
  // track bbox there, and that frame should still show as "present", not a
  // false gap.
  const presenceStripObjects = cardOverlayData.map(o => ({
    label: o.label,
    color: o.color,
    timestamps: (detectionsByLaneId[o.laneSequenceId] ?? []).map(d => d.recorded_at),
  }));

  // Presence strip rows are clickable: jump to that object's card. The strip
  // only knows the clicked row's position in `presenceStripObjects`, which is
  // built 1:1 (same order, same length) from `cardOverlayData` — so that
  // index resolves straight back to the card's key. Scrolling waits a frame
  // so it targets the just-updated (possibly newly mounted) active card.
  const handlePresenceObjectClick = (objectIndex: number) => {
    const cardKey = cardOverlayData[objectIndex]?.cardKey;
    if (!cardKey) return;
    setActiveCardKey(cardKey);
    setActiveSection('detections');
    requestAnimationFrame(() => {
      cardRefs.current[cardKey]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const handleBboxChangeByCardKey = (cardKey: string, updatedBbox: SequenceBbox) => {
    const card = cards.find(c => c.cardKey === cardKey);
    if (!card || card.locked) return;
    setLaneBboxes(prev => {
      const arr = [...(prev[card.laneSequenceId] ?? [])];
      arr[card.trackIndex] = updatedBbox;
      return { ...prev, [card.laneSequenceId]: arr };
    });
  };

  const handleClassificationChangeByCardKey = (
    cardKey: string,
    classification: CardClassification
  ) => {
    const card = cards.find(c => c.cardKey === cardKey);
    if (!card || card.locked) return;
    setPrimaryClassification(prev => ({ ...prev, [cardKey]: classification }));
  };

  const handleUnsureChangeByCardKey = (cardKey: string, unsure: boolean) => {
    const card = cards.find(c => c.cardKey === cardKey);
    if (!card || card.locked) return;
    setLaneUnsure(prev => ({ ...prev, [card.laneSequenceId]: unsure }));
  };

  const handleMissedSmokeReviewChange = (review: 'yes' | 'no') => {
    setMissedSmokeReview(review);
    setHasMissedSmoke(review === 'yes');
  };

  const handleReset = () => {
    if (!alertDetail) return;
    initializeFromAlertDetail(alertDetail);
    showToastNotification('Reset to last saved state', 'success');
  };

  // --- Keyboard shortcut adapter: bridges the cardKey-keyed page state to
  // the index-based utilities shared with AnnotationInterface. Recomputed
  // fresh every render from `cards`, whose order is stable given alertDetail. ---
  const activeIndex = activeCardKey ? cards.findIndex(c => c.cardKey === activeCardKey) : null;
  const adapterBboxes = cards.map(getBbox);
  const adapterClassification: Record<number, CardClassification> = {};
  cards.forEach((c, i) => {
    adapterClassification[i] = primaryClassification[c.cardKey] ?? 'unselected';
  });
  const detectionRefsAdapter = { current: cards.map(c => cardRefs.current[c.cardKey] ?? null) };

  const navigateToPreviousDetection = createPreviousDetectionNavigator(
    { activeDetectionIndex: activeIndex, activeSection, bboxes: adapterBboxes, showKeyboardModal },
    {
      setActiveDetectionIndex: index =>
        setActiveCardKey(index === null ? null : (cards[index]?.cardKey ?? null)),
      setActiveSection,
    },
    { detectionRefs: detectionRefsAdapter, sequenceReviewerRef }
  );

  const navigateToNextDetection = createNextDetectionNavigator(
    { activeDetectionIndex: activeIndex, activeSection, bboxes: adapterBboxes, showKeyboardModal },
    {
      setActiveDetectionIndex: index =>
        setActiveCardKey(index === null ? null : (cards[index]?.cardKey ?? null)),
      setActiveSection,
    },
    { detectionRefs: detectionRefsAdapter, sequenceReviewerRef }
  );

  const handleBboxChangeAdapter = (index: number, updatedBbox: SequenceBbox) => {
    const card = cards[index];
    if (card) handleBboxChangeByCardKey(card.cardKey, updatedBbox);
  };

  const handlePrimaryClassificationChangeAdapter = (
    updates: Record<number, CardClassification>
  ) => {
    Object.entries(updates).forEach(([idxStr, value]) => {
      const card = cards[Number(idxStr)];
      if (card && value !== 'unselected') {
        handleClassificationChangeByCardKey(card.cardKey, value);
        // Classification and Unsure are mutually exclusive — the S/F
        // keyboard path must clear unsure exactly like the chips do.
        handleUnsureChangeByCardKey(card.cardKey, false);
      }
    });
  };

  const isComplete = editableCards.every(
    card => laneUnsure[card.laneSequenceId] || hasUserAnnotations(getBbox(card))
  );

  // Alert-level missed smoke is stored on one lane's payload — normally the
  // primary lane, but the primary can already be locked (exited the
  // pipeline, or not annotated at all) while a sibling is still open. Lanes
  // are ordered primary-first (alert-detail contract), so "the first lane
  // still open for edits" is the primary whenever the primary itself is
  // open, and falls back to the next open lane otherwise — never silently
  // dropping the flag. The MissedSmokePanel still displays the primary
  // lane's own frames regardless of which lane's payload carries the flag.
  const missedSmokeCarrierLaneId = alertDetail?.lanes.find(
    lane => !isLaneLocked(lane, mode) && !!lane.annotation
  )?.sequence.id;

  // Done mode only: which lanes actually changed since load (or since the
  // last reset), diffed against initialSnapshotRef. A missed-smoke-only
  // edit alone marks its carrier lane changed.
  const isLaneChanged = (laneSequenceId: number, carriesMissedSmoke: boolean): boolean => {
    const snapshot = initialSnapshotRef.current;
    if (!snapshot) return false;
    const bboxesChanged = !bboxesEqual(
      laneBboxes[laneSequenceId],
      snapshot.laneBboxes[laneSequenceId]
    );
    const unsureChanged =
      (laneUnsure[laneSequenceId] ?? false) !== (snapshot.laneUnsure[laneSequenceId] ?? false);
    const missedSmokeChanged = carriesMissedSmoke && hasMissedSmoke !== snapshot.hasMissedSmoke;
    return bboxesChanged || unsureChanged || missedSmokeChanged;
  };
  const changedLaneCount =
    mode === 'done' && alertDetail
      ? alertDetail.lanes.filter(
          lane =>
            !isLaneLocked(lane, mode) &&
            !!lane.annotation &&
            isLaneChanged(lane.sequence.id, lane.sequence.id === missedSmokeCarrierLaneId)
        ).length
      : 0;
  const anyLaneChanged = mode === 'done' && changedLaneCount > 0;

  // Deep-linking a fully-classified alert leaves zero editable cards —
  // `isComplete` is vacuously true over an empty list, so it alone can't
  // gate submit; there must be at least one editable card to submit.
  const canSubmit =
    editableCards.length > 0 &&
    (mode === 'done' ? isComplete && anyLaneChanged : isComplete && missedSmokeReview !== null);

  // Shared by the header submit and its rail-footer mirror.
  const submitLabel =
    mode === 'done'
      ? `Save changes (${changedLaneCount})`
      : `Submit alert (${editableCards.length} objects)`;
  const submitTitle = mode === 'done' ? 'Save changes (Enter)' : 'Submit alert (Enter)';

  const submitMutation = useMutation({
    mutationFn: async (): Promise<{ results: ClassifySubmitResult[] }> => {
      if (mode === 'done') {
        const changedLanes = alertDetail!.lanes.filter(lane => {
          if (isLaneLocked(lane, mode) || !lane.annotation) return false;
          return isLaneChanged(lane.sequence.id, lane.sequence.id === missedSmokeCarrierLaneId);
        });
        // Sequential, not Promise.all: each lane is its own PATCH/commit, so
        // a later lane's failure must not race ahead of an earlier one, and
        // must stop immediately rather than firing the remaining lanes —
        // the thrown rejection propagates to the mutation's onError, which
        // already toasts and refetches alert-detail so whatever DID land
        // redraws with server truth.
        const results: ClassifySubmitResult[] = [];
        for (const lane of changedLanes) {
          const isMissedSmokeCarrier = lane.sequence.id === missedSmokeCarrierLaneId;
          const bboxes = laneBboxes[lane.sequence.id] ?? [];
          const unsure = laneUnsure[lane.sequence.id] ?? false;
          const hasSmokeNow = unsure ? false : bboxes.some(b => b.is_smoke);
          const hasMissedSmokeForLane = isMissedSmokeCarrier && !unsure ? hasMissedSmoke : false;
          const updates: Partial<SequenceAnnotation> = {
            annotation: { sequences_bbox: bboxes },
            processing_stage: determineClassifySubmitStage({
              currentStage: lane.annotation!.processing_stage,
              isUnsure: unsure,
              hasSmoke: hasSmokeNow,
              hasMissedSmoke: hasMissedSmokeForLane,
            }),
            has_smoke: hasSmokeNow,
            has_false_positives: unsure
              ? false
              : bboxes.some(b => b.false_positive_types.length > 0),
            false_positive_types: unsure
              ? '[]'
              : JSON.stringify([...new Set(bboxes.flatMap(b => b.false_positive_types))]),
            has_missed_smoke: hasMissedSmokeForLane,
            is_unsure: unsure,
          };
          const saved = await apiClient.updateSequenceAnnotation(lane.annotation!.id, updates);
          results.push({
            annotation_id: lane.annotation!.id,
            sequence_id: lane.sequence.id,
            processing_stage: saved.processing_stage,
            group_propagation_warning: saved.group_propagation_warning ?? null,
          });
        }
        return { results };
      }

      const items: ClassifySubmitItem[] = [];
      alertDetail!.lanes.forEach(lane => {
        if (isLaneLocked(lane, mode) || !lane.annotation) return;
        const isMissedSmokeCarrier = lane.sequence.id === missedSmokeCarrierLaneId;
        const bboxes = laneBboxes[lane.sequence.id] ?? [];
        const unsure = laneUnsure[lane.sequence.id] ?? false;
        const hasSmoke = unsure ? false : bboxes.some(b => b.is_smoke);
        const hasMissedSmokeForLane = isMissedSmokeCarrier ? hasMissedSmoke : false;

        items.push({
          annotation_id: lane.annotation.id,
          annotation: { sequences_bbox: bboxes },
          has_missed_smoke: hasMissedSmokeForLane,
          is_unsure: unsure,
          processing_stage: determineClassifySubmitStage({
            currentStage: lane.annotation.processing_stage,
            isUnsure: unsure,
            hasSmoke,
            hasMissedSmoke: hasMissedSmokeForLane,
          }),
        });
      });
      return apiClient.classifySubmit({ items });
    },
    onSuccess: response => {
      queryClient.invalidateQueries({ queryKey: ['classify-queue'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });

      const warnings = response.results
        .filter(r => r.group_propagation_warning)
        .map(r => ({
          message: r.group_propagation_warning as string,
          groupId:
            alertDetail?.lanes.find(l => l.sequence.id === r.sequence_id)?.sequence
              .sequence_group_id ?? null,
        }));

      if (warnings.length > 0) {
        showToastNotification(
          'Alert submitted — group propagation skipped for some objects',
          'info'
        );
        setGroupConflictWarnings(warnings);
        // No auto-advance on this path, so the submitted lanes are still on
        // screen — refetch so they redraw locked/read-only instead of
        // staying editable with now-stale (already-submitted) state.
        queryClient.invalidateQueries({ queryKey: alertDetailQueryKey });
        return;
      }

      setGroupConflictWarnings([]);
      showToastNotification('Alert submitted successfully', 'success');

      setTimeout(() => {
        const nextAlert = getNextSequenceInWorkflow();
        if (nextAlert) {
          const currentIndex = annotationWorkflow?.currentIndex || 0;
          const totalAlerts = annotationWorkflow?.sequences?.length || 0;
          showToastNotification(`Moving to alert ${currentIndex + 2} of ${totalAlerts}`, 'info');
          navigate(classifyDetail(nextAlert.id, mode === 'done'));
        } else {
          const totalCompleted = annotationWorkflow?.sequences?.length || 1;
          clearAnnotationWorkflow();
          showToastNotification(
            `Workflow completed! Classified ${totalCompleted} alert${totalCompleted === 1 ? '' : 's'}.`,
            'success'
          );
          navigate(backUrl);
        }
      }, 1000);
    },
    onError: err => {
      showToastNotification(`Submit failed: ${extractErrorMessage(err)}`, 'error');
      // A rejected submit is often a race (a sibling's group fan-out locked
      // a lane between load and submit, 409) — refetch so the page reflects
      // the lanes' true current state rather than silently retrying with
      // stale data on the next attempt.
      queryClient.invalidateQueries({ queryKey: alertDetailQueryKey });
    },
  });

  const handleSubmit = () => {
    if (!canSubmit) {
      if (mode === 'done') {
        showToastNotification(
          isComplete
            ? 'Cannot submit: no changes to save'
            : 'Cannot submit: some objects still need classification',
          'error'
        );
      } else if (missedSmokeReview === null) {
        showToastNotification('Cannot submit: missed smoke review is required', 'error');
      } else {
        showToastNotification('Cannot submit: some objects still need classification', 'error');
      }
      return;
    }
    submitMutation.mutate();
  };

  // Keyboard shortcuts over the flattened card list.
  useEffect(() => {
    const handleKeyDown = createKeyboardHandler({
      // Classification shortcuts (S/F, types, Q) only apply while the
      // object section is active — a null index makes them inert when the
      // missed-smoke section is selected. The navigators keep their own
      // (ungated) state, so ArrowUp still leaves the sequence section.
      activeDetectionIndex: activeSection === 'detections' ? activeIndex : null,
      bboxes: adapterBboxes,
      showKeyboardModal,
      missedSmokeReview,
      primaryClassification: adapterClassification,
      setShowKeyboardModal,
      handleReset,
      handleSave: handleSubmit,
      navigateToPreviousDetection,
      navigateToNextDetection,
      handleMissedSmokeReviewChange,
      handleBboxChange: handleBboxChangeAdapter,
      onPrimaryClassificationChange: handlePrimaryClassificationChangeAdapter,
      // U: toggle the active object's Unsure — same mutual exclusivity as
      // the Unsure chip (turning it on clears the classification).
      onUnsureToggle: index => {
        const card = cards[index];
        if (!card || card.locked) return;
        const next = !(laneUnsure[card.laneSequenceId] ?? false);
        if (next) {
          handleClassificationChangeByCardKey(card.cardKey, 'unselected');
          handleBboxChangeByCardKey(card.cardKey, {
            ...getBbox(card),
            is_smoke: false,
            smoke_type: undefined,
            false_positive_types: [],
          });
        }
        handleUnsureChangeByCardKey(card.cardKey, next);
      },
    });

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeIndex,
    activeSection,
    cards,
    laneBboxes,
    laneUnsure,
    showKeyboardModal,
    missedSmokeReview,
    primaryClassification,
    canSubmit,
  ]);

  // Focus cycle: Tab / Shift+Tab move strictly between the rail's stops —
  // object rows, the missed-smoke row, the rail Submit — wrapping at the
  // ends and never escaping to the header/media chrome. Focus landing on a
  // row activates it (its own onFocus handler). Suspended while the
  // shortcuts modal is open so its close button stays reachable.
  useEffect(() => {
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || showKeyboardModal) return;
      const stops = (
        [
          ...cards.map(c => cardRefs.current[c.cardKey]),
          sequenceReviewerRef.current,
          railSubmitRef.current,
        ] as (HTMLElement | null)[]
      ).filter((el): el is HTMLElement => el !== null && !(el as HTMLButtonElement).disabled);
      if (stops.length === 0) return;
      e.preventDefault();
      const current = stops.indexOf(document.activeElement as HTMLElement);
      const delta = e.shiftKey ? -1 : 1;
      const next = current === -1 ? 0 : (current + delta + stops.length) % stops.length;
      stops[next].focus();
    };
    document.addEventListener('keydown', handleTab, true);
    return () => document.removeEventListener('keydown', handleTab, true);
  }, [cards, showKeyboardModal]);

  const handlePreviousAlert = () => {
    const prev = navigateToPreviousInWorkflow();
    if (prev) navigate(classifyDetail(prev.id, mode === 'done'));
  };

  const handleNextAlert = () => {
    const next = navigateToNextInWorkflow();
    if (next) navigate(classifyDetail(next.id, mode === 'done'));
  };

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
            onClick={() => navigate(backUrl)}
            className="mt-4 font-body text-detail text-haze hover:text-char"
          >
            Back to Alerts
          </button>
        </div>
      </div>
    );
  }

  const primaryLane = alertDetail.lanes[0];
  const classifiedCount = editableCards.filter(
    c => laneUnsure[c.laneSequenceId] || hasUserAnnotations(getBbox(c))
  ).length;

  return (
    <>
      {/* Pinned toolbar-scale header — same idiom as SequenceGroupAnnotatePage:
          fixed to the viewport past the sidebar so alert identity, progress,
          and Submit stay reachable while scrolling the object cards below.
          The root's pt-20 reserves its space. */}
      <div className="fixed top-0 left-0 md:left-64 right-0 z-30 px-6 pt-3 pb-2.5 bg-paper/85 border-b border-line backdrop-blur-sm">
        <button
          onClick={() => {
            clearAnnotationWorkflow();
            navigate(backUrl);
          }}
          className="font-body text-detail text-haze hover:text-char inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Alerts
        </button>

        <div className="mt-1 flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <h1 className="font-display text-heading font-semibold text-char truncate">
              {alertDetail.organisation_name} · {alertDetail.camera_name}
            </h1>
            <span className="font-data text-detail text-haze">
              {new Date(alertDetail.recorded_at).toLocaleString()}
            </span>
            <span
              className={`flex-none rounded-full px-2.5 py-0.5 font-data text-xs font-semibold ${
                editableCards.length > 0 && classifiedCount === editableCards.length
                  ? 'bg-pine-soft text-pine'
                  : 'bg-ember-soft text-ember'
              }`}
            >
              {classifiedCount} of {editableCards.length} objects classified
            </span>
          </div>

          <div className="flex flex-none items-center gap-2">
            {annotationWorkflow && annotationWorkflow.isActive && (
              <>
                <button
                  onClick={handlePreviousAlert}
                  disabled={!canNavigatePrevious()}
                  className="p-1.5 rounded-lg border border-line bg-paper text-haze hover:bg-ash disabled:opacity-40 disabled:cursor-not-allowed"
                  title={canNavigatePrevious() ? 'Previous alert' : 'Already at first alert'}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={handleNextAlert}
                  disabled={!canNavigateNext()}
                  className="p-1.5 rounded-lg border border-line bg-paper text-haze hover:bg-ash disabled:opacity-40 disabled:cursor-not-allowed"
                  title={canNavigateNext() ? 'Next alert' : 'Already at last alert'}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitMutation.isPending}
              className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title={submitTitle}
            >
              {submitMutation.isPending ? (
                <div className="w-3.5 h-3.5 mr-1.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Upload className="w-3.5 h-3.5 mr-1.5" />
              )}
              {submitLabel}
            </button>

            <button
              onClick={() => setShowKeyboardModal(true)}
              className="p-2 rounded-lg border border-line bg-paper text-haze hover:bg-ash"
              title="Show keyboard shortcuts (?)"
            >
              <Keyboard className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-20">
        {groupConflictWarnings.length > 0 && (
          <div className="sticky top-20 z-30 bg-signal-soft border-b-2 border-signal px-4 py-3">
            <div className="max-w-7xl mx-auto space-y-2">
              {groupConflictWarnings.map((warning, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex-1 font-body text-sm text-signal">
                    <div className="font-semibold">Group propagation skipped</div>
                    <div className="mt-0.5">{warning.message}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {warning.groupId != null && (
                      <Link
                        to={classifyGroup(warning.groupId)}
                        className="font-body text-sm font-medium text-signal underline hover:brightness-95"
                      >
                        Open group
                      </Link>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setGroupConflictWarnings([])}
                className="inline-flex items-center rounded-lg border border-signal bg-paper px-3 py-1.5 font-body text-sm font-medium text-signal hover:bg-signal-soft"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Cockpit: media column (the active thing) + decision rail (the
            whole alert's state). Desktop pins both columns to the viewport
            below the fixed header and scrolls each internally; below lg
            they stack in natural flow. */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:h-[calc(100vh-7rem)]">
          <div className="lg:flex-[1.5] lg:min-w-0 lg:overflow-y-auto lg:h-full">
            <ClassifyMediaPanel
              activeSection={activeSection}
              activeObject={activeMediaObject}
              primarySequenceId={primaryLane.sequence.id}
              missedSmokeReview={missedSmokeReview}
              onMissedSmokeReviewChange={handleMissedSmokeReviewChange}
              annotationLoading={isLoading}
              objectOverlays={playerObjectOverlays}
            />
          </div>
          <div className="lg:flex-1 lg:min-w-0 lg:overflow-y-auto lg:h-full">
            <DecisionRail
              missedSmokeReview={missedSmokeReview}
              onMissedSmokeReviewChange={handleMissedSmokeReviewChange}
              missedSmokeActive={activeSection === 'sequence'}
              onMissedSmokeActivate={() => setActiveSection('sequence')}
              missedSmokeDisabled={missedSmokeCarrierLaneId === undefined}
              missedSmokeRowRef={sequenceReviewerRef}
              footer={
                <button
                  ref={railSubmitRef}
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitMutation.isPending}
                  data-testid="rail-submit"
                  className="w-full inline-flex items-center justify-center rounded-lg bg-ember px-4 py-2.5 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={submitTitle}
                >
                  {submitMutation.isPending ? (
                    <div className="w-3.5 h-3.5 mr-1.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {submitLabel}
                  <kbd
                    aria-hidden="true"
                    className="ml-2 px-1 py-0.5 rounded bg-white/20 font-data text-[10px] font-medium text-white"
                  >
                    Enter
                  </kbd>
                </button>
              }
            >
              {renderItems.map((item, i) => {
                const objectNumber = i + 1;

                if (item.kind === 'placeholder') {
                  return (
                    <div
                      key={`placeholder-${item.laneSequenceId}`}
                      data-testid={`object-card-placeholder-${item.laneSequenceId}`}
                      className="rounded-lg border border-dashed border-line bg-ash px-3.5 py-2.5 flex items-center justify-between"
                    >
                      <span className="font-body text-sm font-semibold text-char">
                        Object {objectNumber}
                      </span>
                      <span className="font-body text-xs text-haze">Not imported yet</span>
                    </div>
                  );
                }

                const { card } = item;
                const lane = alertDetail.lanes.find(l => l.sequence.id === card.laneSequenceId)!;
                const stageBadge =
                  card.locked || mode === 'done'
                    ? getProcessingStageLabel(lane.annotation!.processing_stage)
                    : undefined;
                const overlay = cardOverlayData.find(o => o.cardKey === card.cardKey);

                return (
                  <ObjectRow
                    key={card.cardKey}
                    rowRef={el => (cardRefs.current[card.cardKey] = el)}
                    objectNumber={objectNumber}
                    cardKey={card.cardKey}
                    color={overlay?.color}
                    bbox={getBbox(card)}
                    classification={primaryClassification[card.cardKey] ?? 'unselected'}
                    unsure={laneUnsure[card.laneSequenceId] ?? false}
                    isActive={activeCardKey === card.cardKey && activeSection === 'detections'}
                    locked={card.locked}
                    stageBadge={stageBadge}
                    changed={
                      mode === 'done' &&
                      !card.locked &&
                      isLaneChanged(
                        card.laneSequenceId,
                        card.laneSequenceId === missedSmokeCarrierLaneId
                      )
                    }
                    onRowClick={key => {
                      setActiveCardKey(key);
                      setActiveSection('detections');
                    }}
                    onBboxChange={handleBboxChangeByCardKey}
                    onClassificationChange={handleClassificationChangeByCardKey}
                    onUnsureChange={card.locked ? undefined : handleUnsureChangeByCardKey}
                  />
                );
              })}
            </DecisionRail>

            {/* Temporal context + color legend for the rail's objects
                (self-hides under 2 objects). Highlights the active object's
                row in sync with the rail. */}
            <div className="mt-4">
              <ObjectPresenceStrip
                objects={presenceStripObjects}
                onObjectClick={handlePresenceObjectClick}
                activeIndex={
                  activeSection === 'detections' && activeCard
                    ? cardOverlayData.findIndex(o => o.cardKey === activeCard.cardKey)
                    : null
                }
              />
            </div>
          </div>
        </div>

        <NotificationSystem
          showToast={showToast}
          toastMessage={toastMessage}
          toastType={toastType}
          onDismiss={dismissToast}
          autoDismissMs={3500}
        />

        {showKeyboardModal && (
          <div className="fixed inset-0 bg-char/50 flex items-center justify-center z-50">
            <div className="bg-paper border border-line rounded-lg max-w-2xl max-h-[90vh] overflow-y-auto m-4">
              <div className="flex items-center justify-between p-6 border-b border-line">
                <h2 className="font-display text-heading font-semibold text-char">
                  Keyboard Shortcuts
                </h2>
                <button
                  onClick={() => setShowKeyboardModal(false)}
                  className="p-2 hover:bg-ash rounded-md"
                >
                  <X className="w-5 h-5 text-haze" />
                </button>
              </div>
              <div className="p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-body text-sm text-char">Previous / next object</span>
                  <span className="font-data text-detail text-haze">↑ / ↓</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body text-sm text-char">
                    Mark active object as smoke / false positive
                  </span>
                  <span className="font-data text-detail text-haze">S / F</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body text-sm text-char">
                    Smoke type (wildfire / industrial / other)
                  </span>
                  <span className="font-data text-detail text-haze">1 / 2 / 3</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body text-sm text-char">Mark active object as unsure</span>
                  <span className="font-data text-detail text-haze">U</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body text-sm text-char">Missed smoke yes / no</span>
                  <span className="font-data text-detail text-haze">Y / N</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body text-sm text-char">Submit alert</span>
                  <span className="font-data text-detail text-haze">Enter</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
