/**
 * Collocated classify screen: renders every object (lane) of one alert and
 * submits them all with a single classifySubmit call. Sibling of
 * AnnotationInterface (which stays as the single-sequence `/classify/done/:id`
 * page) — steals its structure (header, toasts, shortcut modal, workflow nav,
 * keyboard shortcuts) but is a separate component because the data shape is
 * fundamentally multi-lane.
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
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Upload,
  X,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { AlertDetail, AlertLane, ClassifySubmitItem, Detection, SequenceBbox } from '@/types/api';
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
import {
  MissedSmokePanel,
  ObjectCard,
  CardClassification,
  ObjectPresenceStrip,
} from '@/components/sequence-annotation';
import { NotificationSystem } from '@/components/ui/NotificationSystem';
import { useToastNotifications } from '@/utils/notification/toastUtils';
import { ROUTES, classifyDetail, classifyGroup } from '@/utils/routes';

/** Locked lanes render read-only and are excluded from the submit payload. */
function isLaneLocked(lane: AlertLane): boolean {
  return (
    !lane.annotation ||
    lane.annotation.processing_stage === 'seq_annotation_done' ||
    lane.annotation.processing_stage === 'annotated'
  );
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

export default function ClassifyAlertPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

      const bboxes = [...lane.annotation.annotation.sequences_bbox];
      newLaneBboxes[lane.sequence.id] = bboxes;
      newLaneUnsure[lane.sequence.id] = lane.annotation.is_unsure || false;
      bboxes.forEach((bbox, trackIndex) => {
        const cardKey = `${lane.sequence.id}:${trackIndex}`;
        newPrimaryClassification[cardKey] = bbox.is_smoke
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
            locked: isLaneLocked(lane),
          },
        });
      });
    });
    return result;
  }, [alertDetail]);

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

  // Presence strip: temporal context + color legend, keyed off the same
  // per-object color/label identity as the overlays above. Renders nothing
  // itself for < 2 objects.
  const presenceStripObjects = cardOverlayData.map(o => ({
    label: o.label,
    color: o.color,
    timestamps: Object.keys(o.boxesByRecordedAt),
  }));

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
    classification: 'smoke' | 'false_positive'
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
      }
    });
  };

  const isComplete = editableCards.every(
    card => laneUnsure[card.laneSequenceId] || hasUserAnnotations(getBbox(card))
  );
  const canSubmit = isComplete && missedSmokeReview !== null;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const items: ClassifySubmitItem[] = [];
      alertDetail!.lanes.forEach((lane, laneIdx) => {
        if (isLaneLocked(lane) || !lane.annotation) return;
        const isPrimary = laneIdx === 0;
        const bboxes = laneBboxes[lane.sequence.id] ?? [];
        const unsure = laneUnsure[lane.sequence.id] ?? false;
        const hasSmoke = unsure ? false : bboxes.some(b => b.is_smoke);
        const hasMissedSmokeForLane = isPrimary ? hasMissedSmoke : false;

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
          navigate(classifyDetail(nextAlert.id));
        } else {
          const totalCompleted = annotationWorkflow?.sequences?.length || 1;
          clearAnnotationWorkflow();
          showToastNotification(
            `Workflow completed! Classified ${totalCompleted} alerts.`,
            'success'
          );
          navigate(ROUTES.CLASSIFY);
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
      if (missedSmokeReview === null) {
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
      activeDetectionIndex: activeIndex,
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
    });

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeIndex,
    cards,
    laneBboxes,
    showKeyboardModal,
    missedSmokeReview,
    primaryClassification,
    canSubmit,
  ]);

  const handlePreviousAlert = () => {
    const prev = navigateToPreviousInWorkflow();
    if (prev) navigate(classifyDetail(prev.id));
  };

  const handleNextAlert = () => {
    const next = navigateToNextInWorkflow();
    if (next) navigate(classifyDetail(next.id));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !alertDetail) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load alert</p>
          <p className="text-gray-500 text-sm">{String(error)}</p>
          <button
            onClick={() => navigate(ROUTES.CLASSIFY)}
            className="mt-4 text-primary-600 hover:text-primary-900"
          >
            Back to Alerts
          </button>
        </div>
      </div>
    );
  }

  const primaryLane = alertDetail.lanes[0];

  return (
    <>
      <div className="fixed top-0 left-0 md:left-64 right-0 backdrop-blur-sm shadow-sm z-30 bg-white/85 border-b border-gray-200">
        <div className="px-10 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => {
                  clearAnnotationWorkflow();
                  navigate(ROUTES.CLASSIFY);
                }}
                className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75"
                title="Back to alerts"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-900">
                  {alertDetail.organisation_name}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-sm text-gray-600">{alertDetail.camera_name}</span>
                <span className="text-gray-400">•</span>
                <span className="text-sm text-gray-600">
                  {new Date(alertDetail.recorded_at).toLocaleString()}
                </span>

                {annotationWorkflow && annotationWorkflow.isActive && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-blue-600 font-medium">
                      Alert {annotationWorkflow.currentIndex + 1} of{' '}
                      {annotationWorkflow.sequences.length}
                    </span>
                  </>
                )}

                <span className="text-gray-400">•</span>
                <span className="text-xs text-gray-500">
                  {
                    editableCards.filter(
                      c => laneUnsure[c.laneSequenceId] || hasUserAnnotations(getBbox(c))
                    ).length
                  }{' '}
                  of {editableCards.length} objects classified
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {annotationWorkflow && annotationWorkflow.isActive && (
                <>
                  <button
                    onClick={handlePreviousAlert}
                    disabled={!canNavigatePrevious()}
                    className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={canNavigatePrevious() ? 'Previous alert' : 'Already at first alert'}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleNextAlert}
                    disabled={!canNavigateNext()}
                    className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={canNavigateNext() ? 'Next alert' : 'Already at last alert'}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}

              <button
                onClick={handleSubmit}
                disabled={!canSubmit || submitMutation.isPending}
                className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Submit alert (Enter)"
              >
                {submitMutation.isPending ? (
                  <div className="w-3 h-3 mr-1 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Upload className="w-3 h-3 mr-1" />
                )}
                Submit alert ({editableCards.length} objects)
              </button>

              <button
                onClick={() => setShowKeyboardModal(true)}
                className="inline-flex items-center px-2 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                title="Show keyboard shortcuts (?)"
              >
                <Keyboard className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 pt-20">
        {groupConflictWarnings.length > 0 && (
          <div className="sticky top-20 z-30 bg-amber-50 border-b-2 border-amber-400 px-4 py-3 shadow">
            <div className="max-w-7xl mx-auto space-y-2">
              {groupConflictWarnings.map((warning, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex-1 text-sm text-amber-900">
                    <div className="font-medium">Group propagation skipped</div>
                    <div className="mt-0.5">{warning.message}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {warning.groupId != null && (
                      <Link
                        to={classifyGroup(warning.groupId)}
                        className="text-sm font-medium text-amber-900 underline hover:text-amber-700"
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
                className="text-sm font-medium px-3 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="space-y-8">
          {renderItems.map((item, i) => {
            const objectNumber = i + 1;

            if (item.kind === 'placeholder') {
              return (
                <div
                  key={`placeholder-${item.laneSequenceId}`}
                  data-testid={`object-card-placeholder-${item.laneSequenceId}`}
                  className="rounded-lg border-4 border-gray-200 bg-gray-50 p-6 text-center"
                >
                  <h4 className="text-lg font-medium text-gray-900 mb-2">Object {objectNumber}</h4>
                  <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">Not imported yet</p>
                </div>
              );
            }

            const { card } = item;
            const lane = alertDetail.lanes.find(l => l.sequence.id === card.laneSequenceId)!;
            const bbox = getBbox(card);
            const stageBadge = card.locked
              ? getProcessingStageLabel(lane.annotation!.processing_stage)
              : undefined;
            const overlay = cardOverlayData.find(o => o.cardKey === card.cardKey);
            const siblingOverlays: ObjectOverlay[] = cardOverlayData
              .filter(o => o.cardKey !== card.cardKey)
              .map(o => ({
                color: o.color,
                label: o.label,
                boxesByRecordedAt: o.boxesByRecordedAt,
              }));

            return (
              <ObjectCard
                key={card.cardKey}
                cardRef={el => (cardRefs.current[card.cardKey] = el)}
                objectNumber={objectNumber}
                cardKey={card.cardKey}
                bbox={bbox}
                sequenceId={card.laneSequenceId}
                classification={primaryClassification[card.cardKey] ?? 'unselected'}
                isActive={activeCardKey === card.cardKey}
                isAnnotated={card.locked || hasUserAnnotations(bbox)}
                locked={card.locked}
                stageBadge={stageBadge}
                unsure={laneUnsure[card.laneSequenceId] ?? false}
                color={overlay?.color}
                siblingOverlays={siblingOverlays}
                frameRecordedAt={overlay?.frameRecordedAt}
                onCardClick={key => {
                  setActiveCardKey(key);
                  setActiveSection('detections');
                }}
                onBboxChange={handleBboxChangeByCardKey}
                onClassificationChange={handleClassificationChangeByCardKey}
                onUnsureChange={card.locked ? undefined : handleUnsureChangeByCardKey}
              />
            );
          })}
        </div>

        <ObjectPresenceStrip objects={presenceStripObjects} />

        {/* Alert-level missed smoke review — shared player over the primary lane, footer control. */}
        <div ref={sequenceReviewerRef}>
          <MissedSmokePanel
            sequenceId={primaryLane.sequence.id}
            missedSmokeReview={missedSmokeReview}
            onMissedSmokeReviewChange={handleMissedSmokeReviewChange}
            annotationLoading={isLoading}
            activeSection={activeSection}
            sequenceReviewerRef={sequenceReviewerRef}
            objectOverlays={playerObjectOverlays}
          />
        </div>

        <NotificationSystem
          showToast={showToast}
          toastMessage={toastMessage}
          toastType={toastType}
          onDismiss={dismissToast}
          autoDismissMs={3500}
        />

        {showKeyboardModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl max-h-[90vh] overflow-y-auto m-4">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Keyboard Shortcuts</h2>
                <button
                  onClick={() => setShowKeyboardModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-md"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Previous / next object</span>
                  <span className="text-xs text-gray-500">↑ / ↓</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">
                    Mark active object as smoke / false positive
                  </span>
                  <span className="text-xs text-gray-500">S / F</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">
                    Smoke type (wildfire / industrial / other)
                  </span>
                  <span className="text-xs text-gray-500">1 / 2 / 3</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Missed smoke yes / no</span>
                  <span className="text-xs text-gray-500">Y / N</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Submit alert</span>
                  <span className="text-xs text-gray-500">Enter</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
