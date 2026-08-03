import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { useSequenceDetections } from '@/hooks/useSequenceDetections';
// useDetectionImage now handled by DetectionAnnotationCanvas
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import {
  analyzeSequenceAccuracy,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  parseFalsePositiveTypes,
} from '@/utils/modelAccuracy';
import {
  Detection,
  DetectionAnnotation,
  DetectionAnnotationBbox,
  SmokeType,
  SequenceAnnotation,
} from '@/types/api';
import { createDefaultFilterState } from '@/hooks/usePersistedFilters';

// New imports for refactored utilities
import {
  buildQuickSubmitPlan,
  calculateAnnotationCompleteness,
  collectLaneBoxes,
  getCellState,
  getIsAnnotated,
  sequenceSmokeType,
} from '@/utils/annotation';
import { pickNextLocalizeLane } from '@/utils/annotation/localizeUtils';
import { ImageModal, DetectionGrid, DetectionHeader } from '@/components/detection-sequence';
import type { CardSize } from '@/components/detection-sequence/DetectionHeader';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import { usePersistedTabState } from '@/hooks/usePersistedTabState';
import { ROUTES, localizeDetail } from '@/utils/routes';

const CARD_MIN_WIDTH: Record<CardSize, number> = { sm: 240, md: 340, lg: 500 };

interface DetectionSequenceAnnotatePageProps {
  /** 'done' when mounted under /localize/done/… — entered from the Done list. */
  mode?: 'done';
}

export default function DetectionSequenceAnnotatePage({
  mode,
}: DetectionSequenceAnnotatePageProps = {}) {
  const { sequenceId, detectionId } = useParams<{ sequenceId: string; detectionId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sequenceIdNum = sequenceId ? parseInt(sequenceId, 10) : null;

  const [selectedDetectionIndex, setSelectedDetectionIndex] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [detectionAnnotations, setDetectionAnnotations] = useState<
    Map<number, DetectionAnnotation>
  >(new Map());
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  // Default ON: the detection review is *about* the model predictions, so the
  // winning layer (auto if present, else engine) should be visible on open
  // rather than hidden behind a toggle.
  const [showPredictions, setShowPredictions] = useState(true);

  // Persistent smoke type selection across detections
  const [persistentSmokeType, setPersistentSmokeType] = useState<SmokeType>('wildfire');

  // Track drawing mode state across auto-advance navigation
  const [persistentDrawMode, setPersistentDrawMode] = useState(false);
  const isAutoAdvanceRef = useRef(false);

  // Provenance comes from the mounted route: /localize/… vs /localize/done/…
  const basePath = mode === 'done' ? ROUTES.LOCALIZE_DONE : ROUTES.LOCALIZE;

  // Determine source page and appropriate filter storage key
  const sourcePage = mode === 'done' ? 'review' : 'annotate';
  const filterStorageKey = mode === 'done' ? 'filters-localize-done' : 'filters-localize';

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
      console.warn(
        `[DetectionSequenceAnnotate] Failed to read filters from localStorage key "${filterStorageKey}":`,
        error
      );
    }

    // Always return something (either stored filters or defaults)
    const defaultState = {
      ...createDefaultFilterState('annotated'),
      filters: {
        ...createDefaultFilterState('annotated').filters,
        detection_annotation_completion:
          sourcePage === 'review' ? ('complete' as const) : ('incomplete' as const),
        include_detection_stats: true,
        processing_stage: 'annotated' as const,
      },
    };

    return storedFilters || defaultState;
  }, [filterStorageKey, sourcePage]);

  const { data: detections, isLoading, error } = useSequenceDetections(sequenceIdNum);

  // Helper functions to map between detection ID and array index
  const getDetectionIndexById = useCallback(
    (detectionId: number): number | null => {
      if (!detections) return null;
      const index = detections.findIndex(detection => detection.id === detectionId);
      return index >= 0 ? index : null;
    },
    [detections]
  );

  const getDetectionIdByIndex = useCallback(
    (index: number): number | null => {
      if (!detections || index < 0 || index >= detections.length) return null;
      return detections[index].id;
    },
    [detections]
  );

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
      const response = await apiClient.getSequenceAnnotations({
        sequence_id: sequenceIdNum!,
        size: 1,
      });
      return response.items[0] || null;
    },
    enabled: !!sequenceIdNum,
  });

  const sequenceAnnotation = sequenceAnnotationResponse;

  // Default the review smoke type to the sequence's classified type (not a
  // hardcoded 'wildfire') — accepted model boxes inherit it. Set once per
  // sequence so it doesn't clobber a manual change mid-review.
  const smokeTypeInitFor = useRef<number | null>(null);
  useEffect(() => {
    if (!sequenceAnnotation) return;
    if (smokeTypeInitFor.current === sequenceAnnotation.sequence_id) return;
    smokeTypeInitFor.current = sequenceAnnotation.sequence_id;
    setPersistentSmokeType(sequenceSmokeType(sequenceAnnotation));
  }, [sequenceAnnotation]);

  // Localize quick submit: the per-frame accept plan (winning model boxes for
  // every frame without a committed annotation) and the confirm gate for
  // frames that have no box at all. Queue mode (/localize/:id) is the
  // localize flow; done mode (/localize/done/:id) is read-mostly review.
  const isLocalize = mode !== 'done';
  const [quickSubmitConfirming, setQuickSubmitConfirming] = useState(false);
  // Crop mode: zoom each cell around its boxes for the glance-check.
  const [cropMode, setCropMode] = useState(false);
  // Animated cropped flipbook of the lane's boxes (localize).
  const [showCroppedView, setShowCroppedView] = useState(false);
  // Card size (S/M/L) driving the grid's auto-fill column width.
  const [cardSize, setCardSize] = usePersistedTabState<CardSize>('detectionAnnotateCardSize', 'md');
  const cardMinWidth = CARD_MIN_WIDTH[cardSize] ?? CARD_MIN_WIDTH.md;

  const laneSmokeType = sequenceSmokeType(sequenceAnnotation);
  const quickSubmitPlan = useMemo(
    () =>
      isLocalize && detections
        ? buildQuickSubmitPlan(detections, detectionAnnotations, laneSmokeType)
        : null,
    [isLocalize, detections, detectionAnnotations, laneSmokeType]
  );

  // The lane's boxes across all frames, feeding the cropped flipbook view.
  const laneBoxes = useMemo(
    () => (isLocalize && detections ? collectLaneBoxes(detections, detectionAnnotations) : []),
    [isLocalize, detections, detectionAnnotations]
  );

  // Fetch all sequences for navigation using filters from the source page
  const {
    data: rawSequences,
    isLoading: rawSequencesLoading,
    error: rawSequencesError,
  } = useQuery({
    queryKey: [
      ...QUERY_KEYS.SEQUENCES,
      'navigation-context',
      sourcePage,
      sourcePageFilters?.filters,
    ],
    queryFn: () => {
      // Always provide a fallback query - use stored filters if available, otherwise use basic filters
      const baseFilters = {
        detection_annotation_completion:
          sourcePage === 'review' ? ('complete' as const) : ('incomplete' as const),
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
    queryKey: [
      ...QUERY_KEYS.SEQUENCE_ANNOTATIONS,
      'navigation-context',
      rawSequences?.items?.map(s => s.id),
      sourcePageFilters?.selectedModelAccuracy,
    ],
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
        apiClient
          .getSequenceAnnotations({ sequence_id: sequence.id, size: 1 })
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

    const annotationMap = allSequenceAnnotations.reduce(
      (acc, { sequenceId, annotation }) => {
        acc[sequenceId] = annotation || undefined;
        return acc;
      },
      {} as Record<number, SequenceAnnotation | undefined>
    );

    const filtered = rawSequences.items.filter(sequence => {
      const annotation = annotationMap[sequence.id];
      if (!annotation) {
        return modelAccuracy === 'unknown';
      }

      const accuracy = analyzeSequenceAccuracy({
        ...sequence,
        annotation: annotation,
      });

      return accuracy.type === modelAccuracy;
    });

    return {
      ...rawSequences,
      items: filtered,
      total: filtered.length,
      pages: Math.ceil(filtered.length / rawSequences.size),
    };
  }, [rawSequences, allSequenceAnnotations, sourcePageFilters?.selectedModelAccuracy]);

  // Fetch existing detection annotations for this sequence
  const { data: existingAnnotations } = useQuery({
    queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS, 'by-sequence', sequenceIdNum],
    queryFn: async () => {
      const all: DetectionAnnotation[] = [];
      let page = 1;
      let pages = 1;
      while (page <= pages) {
        const response = await apiClient.getDetectionAnnotations({
          sequence_id: sequenceIdNum!,
          size: 100,
          page,
        });
        all.push(...response.items);
        pages = response.pages || 1;
        page += 1;
      }
      return all;
    },
    enabled: !!sequenceIdNum,
    staleTime: 30 * 1000,
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

  // Localize queue flow (non-done mode): explicit lane submit — the user-driven
  // seq_annotation_done -> annotated transition (guarded server-side for
  // completeness), then advance to the alert's next unfinished smoke lane.
  const submitLocalizedLane = useMutation({
    mutationFn: () => {
      if (!sequenceAnnotation || !sequence) {
        throw new Error('Sequence not loaded yet — try again in a moment');
      }
      return apiClient.updateSequenceAnnotation(sequenceAnnotation.id, {
        processing_stage: 'annotated',
      });
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['localization-queue'] });
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
      setToastMessage('Sequence submitted');
      setShowToast(true);
      // Advance to the alert's next unfinished smoke lane; any failure here
      // must still land the user somewhere sensible (the queue).
      let next: number | null = null;
      try {
        const siblings = await apiClient.getSequencesWithAnnotations({
          source_api: sequence!.source_api,
          platform_alert_id: sequence!.platform_alert_id,
          processing_stage: 'seq_annotation_done',
          needs_localization: true,
          size: 100,
        });
        const lanes = siblings.items.map(s => ({
          sequence_id: s.id,
          alert_api_id: s.alert_api_id,
          has_smoke: s.annotation?.has_smoke ?? false,
          has_missed_smoke: s.annotation?.has_missed_smoke ?? false,
          is_unsure: s.annotation?.is_unsure ?? false,
          processing_stage: 'seq_annotation_done',
          smoke_types: s.annotation?.smoke_types ?? [],
          total_detections: 0,
          annotated_detections: 0,
          auto_annotated_at: null,
        }));
        next = pickNextLocalizeLane(lanes, sequenceIdNum!);
      } catch {
        next = null;
      }
      setTimeout(() => {
        if (next !== null) {
          navigate(localizeDetail(next));
        } else {
          navigate(ROUTES.LOCALIZE);
        }
      }, 1000);
    },
    onError: err => {
      const detail = (err as { detail?: string })?.detail || (err as Error)?.message || '';
      setToastMessage(
        detail.includes('localization incomplete')
          ? 'Submit rejected — some frames are not yet annotated'
          : `Submit failed: ${detail || 'unknown error'}`
      );
      setShowToast(true);
    },
  });

  // Quick submit is only safe once the lane's smoke type (sequenceAnnotation)
  // and the existing per-frame annotations have loaded: an early submit would
  // commit the 'wildfire' fallback type and misroute updates to creates.
  const quickSubmitReady = !!sequenceAnnotation && !!existingAnnotations;

  // Localize quick submit: accept the winning model boxes for every pending
  // frame (manual/committed frames untouched), then submit the lane.
  const quickSubmitLane = useMutation({
    mutationFn: async () => {
      if (!quickSubmitPlan) throw new Error('Sequence not loaded yet — try again in a moment');
      const results = await Promise.allSettled(
        quickSubmitPlan.payloads.map(({ detection, existingAnnotationId, body }) =>
          existingAnnotationId !== null
            ? apiClient.updateDetectionAnnotation(existingAnnotationId, body)
            : apiClient.createDetectionAnnotation({ detection_id: detection.id, ...body })
        )
      );
      const fulfilled = results
        .filter((r): r is PromiseFulfilledResult<DetectionAnnotation> => r.status === 'fulfilled')
        .map(r => r.value);
      return { fulfilled, failedCount: results.length - fulfilled.length };
    },
    onSuccess: ({ fulfilled, failedCount }) => {
      if (fulfilled.length > 0) {
        setDetectionAnnotations(prev => {
          const next = new Map(prev);
          fulfilled.forEach(annotation => next.set(annotation.detection_id, annotation));
          return next;
        });
        queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS] });
        queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
        queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
      }
      if (failedCount > 0) {
        // Landed frames stay committed; the button re-enables so a retry
        // just completes the rest.
        setToastMessage(
          `Failed to submit ${failedCount} frame${failedCount === 1 ? '' : 's'} — try again`
        );
        setShowToast(true);
        return;
      }
      submitLocalizedLane.mutate();
    },
    onError: () => {
      setToastMessage('Failed to submit frames — try again');
      setShowToast(true);
    },
  });

  const handleQuickSubmit = useCallback(() => {
    if (
      !quickSubmitReady ||
      !quickSubmitPlan ||
      quickSubmitLane.isPending ||
      submitLocalizedLane.isPending
    )
      return;
    if (quickSubmitPlan.noBoxCount > 0 && !quickSubmitConfirming) {
      setQuickSubmitConfirming(true);
      return;
    }
    setQuickSubmitConfirming(false);
    quickSubmitLane.mutate();
  }, [
    quickSubmitReady,
    quickSubmitPlan,
    quickSubmitConfirming,
    quickSubmitLane,
    submitLocalizedLane,
  ]);

  // A click anywhere else cancels the pending confirm (the header button
  // stops propagation, so its own click never lands here).
  useEffect(() => {
    if (!quickSubmitConfirming) return;
    const cancel = () => setQuickSubmitConfirming(false);
    window.addEventListener('click', cancel);
    return () => window.removeEventListener('click', cancel);
  }, [quickSubmitConfirming]);

  // Save detection annotations mutation
  const saveAnnotations = useMutation({
    mutationFn: async () => {
      if (!detections) return;

      // Update annotations for all detections (should already exist from sequence annotation)
      const promises = detections.map(async detection => {
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
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
      setToastMessage('Detection annotations saved successfully');
      setShowToast(true);

      // Localize flow: saving completes the boxes; submit the lane and
      // advance within the alert instead of the generic filter navigation.
      if (mode !== 'done') {
        submitLocalizedLane.mutate();
        return;
      }

      // Auto-advance to next sequence or navigate back after a short delay
      setTimeout(() => {
        // Check if there's a next sequence to auto-advance to
        const currentIndex = getCurrentSequenceIndex();
        if (
          currentIndex >= 0 &&
          allSequences?.items &&
          currentIndex < allSequences.items.length - 1
        ) {
          // Auto-advance to next filtered sequence
          const nextSequence = allSequences.items[currentIndex + 1];
          navigate(`${basePath}/${nextSequence.id}`);
        } else {
          // No next sequence, return to the source list page
          navigate(basePath);
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
    mutationFn: async ({
      detection,
      items,
    }: {
      detection: Detection;
      items: DetectionAnnotationBbox[];
      /** Draw auto-save: commit without advancing to the next frame. */
      autoSave?: boolean;
    }) => {
      const existingAnnotation = detectionAnnotations.get(detection.id);

      if (existingAnnotation) {
        // Preserve false-positive items: they are not editable rectangles
        // (filtered out of the modal) and must survive a smoke-box edit
        const falsePositiveItems = (existingAnnotation.annotation?.annotation ?? []).filter(
          item => item.false_positive_type != null
        );

        // Update existing annotation with proper annotation data and 'annotated' stage
        const payload = {
          annotation: {
            annotation: [...items, ...falsePositiveItems],
          },
          processing_stage: 'annotated' as const,
        };
        console.debug('Annotating detection', detection.id, 'with payload', payload);
        return apiClient.updateDetectionAnnotation(existingAnnotation.id, payload);
      } else {
        // Create detection annotation on the fly if missing
        const payload = {
          detection_id: detection.id,
          annotation: {
            annotation: items,
          },
          processing_stage: 'annotated' as const,
        };
        console.debug('Creating detection annotation for', detection.id, 'with payload', payload);
        return apiClient.createDetectionAnnotation(payload);
      }
    },
    onSuccess: (result, { detection, autoSave }) => {
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
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });

      setToastMessage(autoSave ? 'Box saved' : `Detection ${detection.id} annotated successfully`);
      setShowToast(true);

      // Draw auto-save stays on the frame — no advance.
      if (autoSave) return;

      // Auto-advance to next detection if available
      if (
        selectedDetectionIndex !== null &&
        detections &&
        selectedDetectionIndex < detections.length - 1
      ) {
        // Mark as auto-advance (drawing mode already stored in onSubmit above)
        isAutoAdvanceRef.current = true;

        // Move to next detection on the same provenance base path so the
        // lane-submit flow stays active at save time.
        const nextDetectionId = getDetectionIdByIndex(selectedDetectionIndex + 1);
        if (nextDetectionId && sequenceId) {
          navigate(`${basePath}/${sequenceId}/${nextDetectionId}`);
        }
      } else if (
        selectedDetectionIndex !== null &&
        detections &&
        selectedDetectionIndex === detections.length - 1
      ) {
        // At last detection - close modal after a brief delay to show success message
        setTimeout(() => {
          if (sequenceId) {
            navigate(`${basePath}/${sequenceId}`);
          }
        }, 1000);
      }
    },
    onError: (err, { detection }) => {
      const msg =
        (err as { detail?: string })?.detail || (err as Error)?.message || 'Unknown error';
      console.error('Failed to annotate detection', detection.id, err);
      setToastMessage(`Failed to annotate detection ${detection.id}: ${msg}`);
      setShowToast(true);
    },
  });

  const handleBack = () => {
    navigate(basePath);
  };

  const handleSave = useCallback(() => {
    saveAnnotations.mutate();
  }, [saveAnnotations]);

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
    return !!(
      currentIndex >= 0 &&
      allSequences?.items &&
      currentIndex < allSequences.items.length - 1
    );
  };

  const handlePreviousSequence = () => {
    const currentIndex = getCurrentSequenceIndex();
    if (currentIndex > 0 && allSequences?.items) {
      const prevSequence = allSequences.items[currentIndex - 1];
      navigate(`${basePath}/${prevSequence.id}`);
    }
  };

  const handleNextSequence = () => {
    const currentIndex = getCurrentSequenceIndex();
    if (currentIndex >= 0 && allSequences?.items && currentIndex < allSequences.items.length - 1) {
      const nextSequence = allSequences.items[currentIndex + 1];
      navigate(`${basePath}/${nextSequence.id}`);
    }
  };

  const openModal = (index: number) => {
    const detectionId = getDetectionIdByIndex(index);
    if (detectionId && sequenceId) {
      navigate(`${basePath}/${sequenceId}/${detectionId}`);
    }
  };

  const closeModal = useCallback(() => {
    if (sequenceId) {
      navigate(`${basePath}/${sequenceId}`);
    }
  }, [sequenceId, basePath, navigate]);

  const navigateModal = useCallback(
    (direction: 'prev' | 'next') => {
      if (!detections || selectedDetectionIndex === null || !sequenceId) return;

      const newIndex =
        direction === 'prev'
          ? Math.max(0, selectedDetectionIndex - 1)
          : Math.min(detections.length - 1, selectedDetectionIndex + 1);

      const newDetectionId = getDetectionIdByIndex(newIndex);
      if (newDetectionId) {
        navigate(`${basePath}/${sequenceId}/${newDetectionId}`);
      }
    },
    [detections, selectedDetectionIndex, sequenceId, getDetectionIdByIndex, basePath, navigate]
  );

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
        // Invalid detection ID - redirect to the provenance base URL
        console.warn(`Invalid detection ID ${detectionId} for sequence ${sequenceId}`);
        if (sequenceId) {
          navigate(`${basePath}/${sequenceId}`, { replace: true });
        }
      }
    } else if (!detectionId) {
      // No detection ID in URL - ensure modal is closed
      setShowModal(false);
      setSelectedDetectionIndex(null);
    }
  }, [detectionId, detections, sequenceId, navigate, getDetectionIndexById, basePath]);

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Submit with Enter key
      if (e.key === 'Enter' && !showModal) {
        if (isLocalize) {
          handleQuickSubmit();
        } else {
          handleSave();
        }
        e.preventDefault();
        return;
      }

      // Toggle predictions visibility with 'p' key (works globally, whether modal is open or not)
      if (e.key === 'p' || e.key === 'P') {
        setShowPredictions(!showPredictions);
        e.preventDefault();
        return;
      }

      // Toggle crop mode with 'c' key (localize grid only)
      if ((e.key === 'c' || e.key === 'C') && isLocalize && !showModal) {
        setCropMode(prev => !prev);
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
  }, [
    showModal,
    selectedDetectionIndex,
    detections,
    detectionAnnotations,
    annotateIndividualDetection,
    showPredictions,
    closeModal,
    handleSave,
    navigateModal,
    isLocalize,
    handleQuickSubmit,
  ]);

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
    return (
      detections.length === annotationValues.length &&
      annotationValues.every(annotation => annotation.processing_stage === 'visual_check')
    );
  };

  // Calculate progress using pure utility function
  const progressStats = detections
    ? calculateAnnotationCompleteness(detections, detectionAnnotations)
    : {
        annotatedDetections: 0,
        totalDetections: 0,
        completionPercentage: 0,
        isComplete: false,
        hasAnnotations: false,
      };

  const { annotatedDetections, totalDetections } = progressStats;
  const annotatedCount = annotatedDetections;
  const totalCount = totalDetections;
  const allInVisualCheck = areAllInVisualCheckStage();

  // Helper to get annotation pills
  const getAnnotationPills = () => {
    if (!sequenceAnnotation) return [];

    const pills = [];

    if (sequenceAnnotation.has_smoke) {
      pills.push(
        <span
          key="smoke"
          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800"
        >
          Smoke
        </span>
      );
    }

    if (sequenceAnnotation.has_missed_smoke) {
      pills.push(
        <span
          key="missed"
          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800"
        >
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

    if (
      !sequenceAnnotation.has_smoke &&
      !sequenceAnnotation.has_missed_smoke &&
      !sequenceAnnotation.has_false_positives
    ) {
      pills.push(
        <span
          key="no-smoke"
          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"
        >
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-video bg-gray-200 animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load frames</p>
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
            <p className="text-lg font-medium mb-2">No frames found</p>
            <p className="text-gray-500">This sequence doesn't have any frames to annotate.</p>
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
    // Pull the page over <main>'s p-6 so the sticky header's containing
    // block reaches the scrollport top (sticky cannot escape into padding);
    // the content re-adds the padding below.
    <div className="-m-6">
      <DetectionHeader
        sequence={sequence}
        sequenceAnnotation={sequenceAnnotation}
        isAllAnnotated={isAllAnnotated}
        onBack={handleBack}
        canNavigatePrevious={canNavigatePrevious}
        canNavigateNext={canNavigateNext}
        onPreviousSequence={handlePreviousSequence}
        onNextSequence={handleNextSequence}
        rawSequencesLoading={rawSequencesLoading}
        rawSequencesError={!!rawSequencesError}
        showPredictions={showPredictions}
        onTogglePredictions={setShowPredictions}
        allInVisualCheck={allInVisualCheck}
        onSave={handleSave}
        saveAnnotations={saveAnnotations}
        isLocalize={isLocalize}
        noBoxCount={quickSubmitPlan?.noBoxCount ?? 0}
        quickSubmitPending={
          !quickSubmitReady || quickSubmitLane.isPending || submitLocalizedLane.isPending
        }
        quickSubmitConfirming={quickSubmitConfirming}
        onQuickSubmit={handleQuickSubmit}
        cropMode={cropMode}
        onToggleCropMode={setCropMode}
        showCroppedView={showCroppedView}
        onToggleCroppedView={setShowCroppedView}
        cardSize={cardSize}
        onCardSizeChange={setCardSize}
        getAnnotationPills={getAnnotationPills}
      />

      <div className="space-y-4 px-6 pb-6 pt-4">
        {isLocalize && showCroppedView && laneBoxes.length > 0 && sequenceIdNum && (
          <div className="flex justify-center">
            <CroppedImageSequence bboxes={laneBoxes} sequenceId={sequenceIdNum} />
          </div>
        )}

        <DetectionGrid
          detections={detections}
          onDetectionClick={openModal}
          showPredictions={showPredictions}
          detectionAnnotations={detectionAnnotations}
          mode={mode}
          getIsAnnotated={getIsAnnotated}
          getCellState={
            isLocalize
              ? (detection: Detection) =>
                  getCellState(detection, detectionAnnotations.get(detection.id))
              : undefined
          }
          smokeType={laneSmokeType}
          cropMode={isLocalize && cropMode}
          cardMinWidth={cardMinWidth}
        />
      </div>

      {/* Image Modal */}
      {showModal && selectedDetectionIndex !== null && detections[selectedDetectionIndex] && (
        <ImageModal
          detection={detections[selectedDetectionIndex]}
          onClose={closeModal}
          onNavigate={navigateModal}
          onSubmit={(detection, items, currentDrawMode, options) => {
            // Store current drawing mode state before auto-advancing
            setPersistentDrawMode(currentDrawMode);
            annotateIndividualDetection.mutate({ detection, items, autoSave: options?.autoSave });
          }}
          onTogglePredictions={setShowPredictions}
          canNavigatePrev={selectedDetectionIndex > 0}
          canNavigateNext={selectedDetectionIndex < detections.length - 1}
          currentIndex={selectedDetectionIndex}
          totalCount={detections.length}
          showPredictions={showPredictions}
          isSubmitting={annotateIndividualDetection.isPending}
          isAnnotated={getIsAnnotated(
            detectionAnnotations.get(detections[selectedDetectionIndex].id),
            mode
          )}
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
        <div
          className={`fixed top-24 right-4 z-50 transition-all duration-300 ease-in-out transform ${
            showToast ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
          }`}
        >
          <div className="px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 min-w-80 bg-green-50 border border-green-200">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}
