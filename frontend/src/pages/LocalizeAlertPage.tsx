/**
 * Collocated localize screen: renders every workable object (lane) of one
 * alert as a status strip plus a frame grid, mirroring ClassifyAlertPage's
 * alert-level shape for the localize task. Mounted at
 * `/localize/:sequenceId/:detectionId?`.
 *
 * Task 3 built the data loading, status/frame model, strip, and grid. Task 4
 * wires per-frame editing: clicking a grid cell opens the shown object's
 * detection in `ImageModal` (URL-driven via the optional `:detectionId`, so
 * the back button closes the editor), a per-object "Accept boxes" quick
 * action on each workable strip row, and the S/M/L card-size + crop-zoom
 * view controls. Task 5 wires the header's submit button: "Accept all &
 * submit alert" runs every workable lane's quick-accept plan, then submits
 * the whole alert atomically via the bulk `localize-submit` endpoint.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Upload } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Detection, DetectionAnnotation, DetectionAnnotationBbox, SmokeType } from '@/types/api';
import { buildAlertFrameModel, AlertObjectStatus } from '@/utils/annotation/alertLocalizeUtils';
import {
  buildQuickSubmitPlan,
  collectLaneBoxes,
  getIsAnnotated,
  saveDetectionReview,
  sequenceSmokeType,
  type QuickSubmitPlan,
} from '@/utils/annotation';
import { ObjectStatusStrip } from '@/components/sequence-annotation';
import { AlertFrameGrid, ImageModal, ViewToolbar } from '@/components/detection-sequence';
import type { CardSize } from '@/components/detection-sequence/ViewToolbar';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import { usePersistedTabState } from '@/hooks/usePersistedTabState';
import { useToastNotifications } from '@/utils/notification/toastUtils';
import { NotificationSystem } from '@/components/ui/NotificationSystem';
import { ROUTES } from '@/utils/routes';

// Shared with the legacy grid's card-size knob (DetectionSequenceAnnotatePage)
// via the same persisted key, so the preference carries across both pages.
const CARD_MIN_WIDTH: Record<CardSize, number> = { sm: 240, md: 340, lg: 500 };

export default function LocalizeAlertPage() {
  const { sequenceId, detectionId } = useParams<{ sequenceId: string; detectionId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sequenceIdNum = sequenceId ? parseInt(sequenceId, 10) : null;
  const detectionIdNum = detectionId ? parseInt(detectionId, 10) : null;

  const [activeLaneId, setActiveLaneId] = useState<number | null>(null);
  const frameRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [cardSize, setCardSize] = usePersistedTabState<CardSize>('detectionAnnotateCardSize', 'md');
  const cardMinWidth = CARD_MIN_WIDTH[cardSize] ?? CARD_MIN_WIDTH.md;
  const [cropMode, setCropMode] = useState(false);
  const [showCroppedView, setShowCroppedView] = useState(false);
  const [showPredictions, setShowPredictions] = useState(true);
  const [persistentDrawMode, setPersistentDrawMode] = useState(false);
  const [selectedSmokeType, setSelectedSmokeType] = useState<SmokeType>('wildfire');
  const smokeTypeInitFor = useRef<number | null>(null);
  const [submitConfirming, setSubmitConfirming] = useState(false);

  const { showToast, toastMessage, toastType, showToastNotification, dismissToast } =
    useToastNotifications();

  // Clear active-object state immediately when the alert changes so a
  // stale selection from a previous alert can't linger.
  useEffect(() => {
    setActiveLaneId(null);
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
  // fetches per-lane detections and DetectionSequenceAnnotatePage fetches a
  // single lane's annotations — one query per lane, paginated for
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
    ? buildAlertFrameModel(alertDetail.lanes, detectionsByLaneId, annotationsByLaneId)
    : { frames: [], objectStatus: [] };

  // The URL's :detectionId, resolved against every lane's loaded detections
  // to find which lane owns it — so the modal (and its save) always targets
  // the right lane regardless of how the URL was reached (cell click or a
  // pasted/back-button URL).
  const modalContext = useMemo(() => {
    if (detectionIdNum == null || !alertDetail) return null;
    for (const lane of alertDetail.lanes) {
      const laneId = lane.sequence.id;
      const detection = (detectionsByLaneId[laneId] ?? []).find(d => d.id === detectionIdNum);
      if (detection) {
        const existingAnnotation =
          (annotationsByLaneId[laneId] ?? []).find(a => a.detection_id === detectionIdNum) ?? null;
        return {
          laneId,
          detection,
          existingAnnotation,
          smokeType: sequenceSmokeType(lane.annotation),
        };
      }
    }
    return null;
  }, [detectionIdNum, alertDetail, detectionsByLaneId, annotationsByLaneId]);

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
  const modalIndex = modalContext
    ? laneDetectionsSorted.findIndex(d => d.id === modalContext.detection.id)
    : -1;

  const closeModal = useCallback(() => {
    if (sequenceIdNum != null) navigate(`${ROUTES.LOCALIZE}/${sequenceIdNum}`);
  }, [sequenceIdNum, navigate]);

  const navigateModal = useCallback(
    (direction: 'prev' | 'next') => {
      if (modalIndex < 0 || sequenceIdNum == null) return;
      const newIndex =
        direction === 'prev'
          ? Math.max(0, modalIndex - 1)
          : Math.min(laneDetectionsSorted.length - 1, modalIndex + 1);
      const newDetection = laneDetectionsSorted[newIndex];
      if (newDetection) navigate(`${ROUTES.LOCALIZE}/${sequenceIdNum}/${newDetection.id}`);
    },
    [modalIndex, laneDetectionsSorted, sequenceIdNum, navigate]
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

  const handleModalSubmit = (
    detection: Detection,
    items: DetectionAnnotationBbox[],
    currentDrawMode: boolean,
    options?: { autoSave?: boolean }
  ) => {
    if (!modalContext) return;
    setPersistentDrawMode(currentDrawMode);
    saveDetection.mutate(
      {
        laneId: modalContext.laneId,
        detectionId: detection.id,
        existingAnnotation: modalContext.existingAnnotation,
        items,
      },
      {
        onSuccess: () => {
          if (options?.autoSave) return;
          showToastNotification('Frame saved', 'success');
          closeModal();
        },
      }
    );
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

  // Strip rows get a preview popover beside the label — the lane's
  // committed-or-winning boxes across all its frames, same source the
  // legacy page's cropped flipbook uses, with extra context padding and a
  // lower initial zoom (popover-scale surroundings vs. the flipbook's tight
  // crop). Omitted (no popover) for a lane with no boxes anywhere yet.
  // Workable lanes also get a trailing quick-accept action.
  const objectStatusWithThumb: AlertObjectStatus[] = frameModel.objectStatus.map(object => {
    const laneBoxes = collectLaneBoxes(
      detectionsByLaneId[object.laneSequenceId] ?? [],
      new Map((annotationsByLaneId[object.laneSequenceId] ?? []).map(a => [a.detection_id, a]))
    );
    const isAccepting =
      quickAcceptLane.isPending && quickAcceptLane.variables === object.laneSequenceId;
    return {
      ...object,
      preview:
        laneBoxes.length > 0 ? (
          <CroppedImageSequence
            bboxes={laneBoxes}
            sequenceId={object.laneSequenceId}
            contextPadding={0.5}
            initialZoom={2}
          />
        ) : undefined,
      action: object.workable ? (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            quickAcceptLane.mutate(object.laneSequenceId);
          }}
          disabled={isAccepting}
          title={`Accept ${object.label}'s predicted boxes for all pending frames`}
          className="shrink-0 rounded-lg border border-line bg-paper px-2 py-1 font-body text-xs font-medium text-char hover:bg-ash disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAccepting ? 'Accepting…' : `Accept ${object.label}'s boxes`}
        </button>
      ) : undefined,
    };
  });

  const workableObjects = objectStatusWithThumb.filter(o => o.workable);
  const contextObjects = objectStatusWithThumb.filter(o => !o.workable);

  // Every workable lane's quick-accept plan plus its sequence-annotation id
  // (the id `localizeSubmit` needs) — feeds both the two-step confirm's
  // no-box count and the accept-all mutation's submit payload.
  const workableLanePlans: {
    laneSequenceId: number;
    annotationId: number;
    plan: QuickSubmitPlan;
  }[] = useMemo(
    () =>
      workableObjects.flatMap(object => {
        const lane = alertDetail?.lanes.find(l => l.sequence.id === object.laneSequenceId);
        if (!lane?.annotation) return [];
        const detections = detectionsByLaneId[object.laneSequenceId] ?? [];
        const annotations = new Map(
          (annotationsByLaneId[object.laneSequenceId] ?? []).map(a => [a.detection_id, a])
        );
        const plan = buildQuickSubmitPlan(
          detections,
          annotations,
          sequenceSmokeType(lane.annotation)
        );
        return [{ laneSequenceId: object.laneSequenceId, annotationId: lane.annotation.id, plan }];
      }),
    [workableObjects, alertDetail, detectionsByLaneId, annotationsByLaneId]
  );
  const totalNoBoxCount = workableLanePlans.reduce((sum, { plan }) => sum + plan.noBoxCount, 0);

  // Accept-all & submit: runs every workable lane's quick-accept plan in
  // order (sequential, fail-fast), then atomically submits the whole alert.
  const acceptAllAndSubmit = useMutation({
    mutationFn: async () => {
      for (const { laneSequenceId } of workableLanePlans) {
        await runLaneQuickAccept(laneSequenceId);
      }
      return apiClient.localizeSubmit(workableLanePlans.map(p => p.annotationId));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localization-queue'] });
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
      showToastNotification('Alert submitted', 'success');
      setTimeout(() => navigate(ROUTES.LOCALIZE), 1000);
    },
    onError: err => {
      const detail = (err as { detail?: string })?.detail || (err as Error)?.message || '';
      if (detail.includes('localization incomplete')) {
        showToastNotification('Submit rejected — some frames are not yet annotated', 'error');
        workableLanePlans.forEach(({ laneSequenceId }) => {
          queryClient.invalidateQueries({
            queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS, 'by-sequence', laneSequenceId],
          });
        });
        return;
      }
      showToastNotification(`Submit failed: ${detail || 'unknown error'}`, 'error');
    },
  });

  // Same two-step confirm pattern as the legacy page's quick-submit: a
  // lane with pending frames that have no box at all needs an explicit
  // "submit anyway?" before the button's second click actually submits.
  const handleSubmitClick = () => {
    if (workableObjects.length === 0 || acceptAllAndSubmit.isPending) return;
    if (totalNoBoxCount > 0 && !submitConfirming) {
      setSubmitConfirming(true);
      return;
    }
    setSubmitConfirming(false);
    acceptAllAndSubmit.mutate();
  };

  // A click anywhere else cancels the pending confirm (the header button
  // stops propagation, so its own click never lands here).
  useEffect(() => {
    if (!submitConfirming) return;
    const cancel = () => setSubmitConfirming(false);
    window.addEventListener('click', cancel);
    return () => window.removeEventListener('click', cancel);
  }, [submitConfirming]);

  // Cropped flipbook (toolbar toggle): the active object's boxes across all
  // its frames — mirrors the legacy grid's cropped-view block, scoped to
  // whichever object is currently active.
  const activeLaneBoxes = useMemo(() => {
    if (activeLaneId == null) return [];
    return collectLaneBoxes(
      detectionsByLaneId[activeLaneId] ?? [],
      new Map((annotationsByLaneId[activeLaneId] ?? []).map(a => [a.detection_id, a]))
    );
  }, [activeLaneId, detectionsByLaneId, annotationsByLaneId]);

  const handleObjectClick = (laneSequenceId: number) => {
    setActiveLaneId(laneSequenceId);
  };

  const handleSegmentClick = (laneSequenceId: number, timestamp: string) => {
    setActiveLaneId(laneSequenceId);
    requestAnimationFrame(() => {
      frameRefs.current[timestamp]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  // "Open Object N ✎" header shortcut: the first workable object that still
  // has a pending frame, and that frame's own (chronologically earliest)
  // timestamp — activating + scrolling reuses the exact segment-click path.
  const firstPendingObject = workableObjects
    .map(object => {
      const pendingTimestamps = Object.entries(object.statusByTimestamp)
        .filter(([, status]) => status === 'pending')
        .map(([timestamp]) => timestamp)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      return pendingTimestamps.length > 0
        ? {
            laneSequenceId: object.laneSequenceId,
            label: object.label,
            timestamp: pendingTimestamps[0],
          }
        : null;
    })
    .find(
      (entry): entry is { laneSequenceId: number; label: string; timestamp: string } =>
        entry !== null
    );

  const handleOpenPendingObject = () => {
    if (!firstPendingObject) return;
    handleSegmentClick(firstPendingObject.laneSequenceId, firstPendingObject.timestamp);
  };

  const handleCellRef = (recordedAt: string, el: HTMLDivElement | null) => {
    frameRefs.current[recordedAt] = el;
  };

  // Opens the shown (active, or first-present-fallback) object's detection
  // in the editor and makes that lane active, per Task 4.
  const handleCellClick = (_recordedAt: string, laneSequenceId: number, detId: number) => {
    setActiveLaneId(laneSequenceId);
    if (sequenceIdNum != null) navigate(`${ROUTES.LOCALIZE}/${sequenceIdNum}/${detId}`);
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
            onClick={() => navigate(ROUTES.LOCALIZE)}
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
      {/* Pinned toolbar-scale header — same idiom as ClassifyAlertPage: fixed
          to the viewport past the sidebar; the root's pt-20 reserves its
          space. */}
      <div className="fixed top-0 left-0 md:left-64 right-0 z-30 px-6 pt-3 pb-2.5 bg-paper/85 border-b border-line backdrop-blur-sm">
        <button
          onClick={() => navigate(ROUTES.LOCALIZE)}
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
            <span className="flex-none rounded-full px-2.5 py-0.5 font-data text-xs font-semibold bg-ember-soft text-ember">
              {workableObjects.length} object{workableObjects.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex flex-none items-center gap-2">
            <ViewToolbar
              cardSize={cardSize}
              onCardSizeChange={setCardSize}
              showPredictions={showPredictions}
              onTogglePredictions={setShowPredictions}
              isLocalize
              cropMode={cropMode}
              onToggleCropMode={setCropMode}
              showCroppedView={showCroppedView}
              onToggleCroppedView={setShowCroppedView}
            />

            {firstPendingObject && (
              <button
                type="button"
                onClick={handleOpenPendingObject}
                title={`Jump to ${firstPendingObject.label}'s first pending frame`}
                className="inline-flex items-center rounded-lg border border-line bg-paper px-3 py-2 font-body text-sm font-medium text-char hover:bg-ash"
              >
                Open {firstPendingObject.label} ✎
              </button>
            )}

            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                handleSubmitClick();
              }}
              disabled={workableObjects.length === 0 || acceptAllAndSubmit.isPending}
              title="Accept predicted boxes for every pending frame and submit the whole alert"
              className={`inline-flex items-center rounded-lg px-4 py-2 font-body text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                submitConfirming
                  ? 'bg-amber-500 hover:bg-amber-600'
                  : 'bg-ember hover:brightness-95'
              }`}
            >
              {acceptAllAndSubmit.isPending ? (
                <div className="w-3.5 h-3.5 mr-1.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5 mr-1.5" />
              )}
              {submitConfirming
                ? `${totalNoBoxCount} frame${totalNoBoxCount === 1 ? '' : 's'} with no box — submit anyway?`
                : 'Accept all & submit alert'}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-6 pt-20">
        <ObjectStatusStrip
          objects={workableObjects}
          onObjectClick={i => handleObjectClick(workableObjects[i].laneSequenceId)}
          onSegmentClick={(i, ts) => handleSegmentClick(workableObjects[i].laneSequenceId, ts)}
          title="Objects to localize"
        />

        {contextObjects.length > 0 && (
          <div className="opacity-60" data-testid="context-object-strip">
            <ObjectStatusStrip
              objects={contextObjects}
              onObjectClick={i => handleObjectClick(contextObjects[i].laneSequenceId)}
              onSegmentClick={(i, ts) => handleSegmentClick(contextObjects[i].laneSequenceId, ts)}
              title="Already localized"
            />
          </div>
        )}

        {showCroppedView && activeLaneId != null && activeLaneBoxes.length > 0 && (
          <div className="flex justify-center">
            <CroppedImageSequence bboxes={activeLaneBoxes} sequenceId={activeLaneId} />
          </div>
        )}

        <AlertFrameGrid
          frames={frameModel.frames}
          activeLaneId={activeLaneId}
          onCellClick={handleCellClick}
          cellRef={handleCellRef}
          cardMinWidth={cardMinWidth}
          cropMode={cropMode}
        />
      </div>

      {modalContext && (
        <ImageModal
          detection={modalContext.detection}
          onClose={closeModal}
          onNavigate={navigateModal}
          onSubmit={handleModalSubmit}
          onTogglePredictions={setShowPredictions}
          canNavigatePrev={modalIndex > 0}
          canNavigateNext={modalIndex >= 0 && modalIndex < laneDetectionsSorted.length - 1}
          currentIndex={Math.max(modalIndex, 0)}
          totalCount={laneDetectionsSorted.length}
          showPredictions={showPredictions}
          isSubmitting={saveDetection.isPending}
          isAnnotated={getIsAnnotated(modalContext.existingAnnotation ?? undefined)}
          existingAnnotation={modalContext.existingAnnotation}
          selectedSmokeType={selectedSmokeType}
          onSmokeTypeChange={setSelectedSmokeType}
          persistentDrawMode={persistentDrawMode}
          onDrawModeChange={setPersistentDrawMode}
          isAutoAdvance={false}
        />
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
