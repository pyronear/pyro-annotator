/**
 * Collocated localize screen: renders every workable object (lane) of one
 * alert as a status strip plus a frame grid, mirroring ClassifyAlertPage's
 * alert-level shape for the localize task. Mounted at `/localize/:sequenceId`.
 *
 * Task 3 scope: data loading, the status/frame model, the strip, and the
 * grid — no editing (Task 4) and no submit (Task 5). The header's submit
 * button renders disabled and the grid's cells are inert previews.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { ArrowLeft, Upload } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Detection, DetectionAnnotation } from '@/types/api';
import { buildAlertFrameModel, AlertObjectStatus } from '@/utils/annotation/alertLocalizeUtils';
import { collectLaneBoxes } from '@/utils/annotation';
import { ObjectStatusStrip } from '@/components/sequence-annotation';
import { AlertFrameGrid } from '@/components/detection-sequence';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import { ROUTES } from '@/utils/routes';

export default function LocalizeAlertPage() {
  const { sequenceId } = useParams<{ sequenceId: string }>();
  const navigate = useNavigate();
  const sequenceIdNum = sequenceId ? parseInt(sequenceId, 10) : null;

  const [activeLaneId, setActiveLaneId] = useState<number | null>(null);
  const frameRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  const {
    data: alertDetail,
    isLoading: alertLoading,
    error: alertError,
  } = useQuery({
    queryKey: ['alert-detail', sequence?.source_api, sequence?.platform_alert_id],
    queryFn: () => apiClient.getAlertDetail(sequence!.source_api, sequence!.platform_alert_id),
    enabled: !!sequence,
  });

  const isLoading = sequenceLoading || (!!sequence && alertLoading);
  const error = sequenceError || alertError;

  const laneSequenceIds = alertDetail ? alertDetail.lanes.map(lane => lane.sequence.id) : [];

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

  const detectionsByLaneId: Record<number, Detection[]> = {};
  const annotationsByLaneId: Record<number, DetectionAnnotation[]> = {};
  laneSequenceIds.forEach((laneSequenceId, i) => {
    detectionsByLaneId[laneSequenceId] = laneDetectionsQueries[i]?.data ?? [];
    annotationsByLaneId[laneSequenceId] = laneAnnotationsQueries[i]?.data ?? [];
  });

  const frameModel = alertDetail
    ? buildAlertFrameModel(alertDetail.lanes, detectionsByLaneId, annotationsByLaneId)
    : { frames: [], objectStatus: [] };

  // Strip rows get a crop thumbnail beside the label — the lane's
  // committed-or-winning boxes across all its frames, same source the
  // legacy page's cropped flipbook uses. Omitted (no thumbnail) for a lane
  // with no boxes anywhere yet.
  const objectStatusWithThumb: AlertObjectStatus[] = frameModel.objectStatus.map(object => {
    const laneBoxes = collectLaneBoxes(
      detectionsByLaneId[object.laneSequenceId] ?? [],
      new Map((annotationsByLaneId[object.laneSequenceId] ?? []).map(a => [a.detection_id, a]))
    );
    return {
      ...object,
      thumbnail:
        laneBoxes.length > 0 ? (
          <CroppedImageSequence bboxes={laneBoxes} sequenceId={object.laneSequenceId} />
        ) : undefined,
    };
  });

  const workableObjects = objectStatusWithThumb.filter(o => o.workable);
  const contextObjects = objectStatusWithThumb.filter(o => !o.workable);

  const handleObjectClick = (laneSequenceId: number) => {
    setActiveLaneId(laneSequenceId);
  };

  const handleSegmentClick = (laneSequenceId: number, timestamp: string) => {
    setActiveLaneId(laneSequenceId);
    requestAnimationFrame(() => {
      frameRefs.current[timestamp]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const handleCellRef = (recordedAt: string, el: HTMLDivElement | null) => {
    frameRefs.current[recordedAt] = el;
  };

  // Cells are inert previews until Task 4 wires editing.
  const handleCellClick = (_recordedAt: string) => {};

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
            {/* Submit lands in Task 5 — placeholder disabled so the header's
                final layout is in place now. */}
            <button
              disabled
              title="Submit — coming soon"
              className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white opacity-50 cursor-not-allowed"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Submit alert
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

        <AlertFrameGrid
          frames={frameModel.frames}
          activeLaneId={activeLaneId}
          onCellClick={handleCellClick}
          cellRef={handleCellRef}
        />
      </div>
    </>
  );
}
