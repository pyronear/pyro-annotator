import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Upload,
} from 'lucide-react';
import { useSequenceDetections } from '@/hooks/useSequenceDetections';
// useDetectionImage now handled by DetectionAnnotationCanvas
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import {
  analyzeSequenceAccuracy,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  getModelAccuracyBadgeClasses,
  parseFalsePositiveTypes,
} from '@/utils/modelAccuracy';
import { Detection, DetectionAnnotation, SmokeType } from '@/types/api';
import { createDefaultFilterState } from '@/hooks/usePersistedFilters';

// New imports for refactored utilities
import {
  DrawnRectangle,
  calculateAnnotationCompleteness,
} from '@/utils/annotation';
import { ImageModal, DetectionGrid } from '@/components/detection-sequence';

// Helper function for context-aware annotation status
const getIsAnnotated = (
  annotation: DetectionAnnotation | undefined,
  fromContext: string | null
): boolean => {
  if (fromContext === 'detections-review') {
    // Review context: optimistically assume completed unless explicitly not
    if (!annotation) return true; // Loading state: assume completed
    return (
      annotation.processing_stage === 'annotated' ||
      annotation.processing_stage === 'bbox_annotation'
    );
  } else {
    // Annotate context: conservatively assume pending unless explicitly completed
    return annotation?.processing_stage === 'annotated';
  }
};

export default function DetectionSequenceAnnotatePage() {
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
  const [showPredictions, setShowPredictions] = useState(false);

  // Persistent smoke type selection across detections
  const [persistentSmokeType, setPersistentSmokeType] = useState<SmokeType>('wildfire');

  // Track drawing mode state across auto-advance navigation
  const [persistentDrawMode, setPersistentDrawMode] = useState(false);
  const isAutoAdvanceRef = useRef(false);

  // Detect source page from URL search params
  const [searchParams] = useSearchParams();
  const fromParam = searchParams.get('from');

  // Determine source page and appropriate filter storage key
  const sourcePage = fromParam === 'detections-review' ? 'review' : 'annotate';
  const filterStorageKey =
    sourcePage === 'review' ? 'filters-detections-review' : 'filters-detections-annotate';

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
  const getDetectionIndexById = (detectionId: number): number | null => {
    if (!detections) return null;
    const index = detections.findIndex(detection => detection.id === detectionId);
    return index >= 0 ? index : null;
  };

  const getDetectionIdByIndex = (index: number): number | null => {
    if (!detections || index < 0 || index >= detections.length) return null;
    return detections[index].id;
  };

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
        acc[sequenceId] = annotation;
        return acc;
      },
      {} as Record<number, any>
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
      const response = await apiClient.getDetectionAnnotations({
        sequence_id: sequenceIdNum!,
        size: 100,
      });
      return response.items;
    },
    enabled: !!sequenceIdNum,
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
      setToastMessage('Detection annotations saved successfully');
      setShowToast(true);

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
          const sourceParam = fromParam ? `?from=${fromParam}` : '';
          navigate(`/detections/${nextSequence.id}/annotate${sourceParam}`);
        } else {
          // No next sequence, return to appropriate source page
          const backPath = sourcePage === 'review' ? '/detections/review' : '/detections/annotate';
          navigate(backPath);
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
      drawnRectangles,
    }: {
      detection: Detection;
      drawnRectangles: DrawnRectangle[];
    }) => {
      const existingAnnotation = detectionAnnotations.get(detection.id);

      if (existingAnnotation) {
        // Convert drawn rectangles to annotation format
        const annotationItems = drawnRectangles.map(rect => ({
          xyxyn: rect.xyxyn,
          class_name: 'smoke',
          smoke_type: rect.smokeType,
        }));

        // Update existing annotation with proper annotation data and 'annotated' stage
        return apiClient.updateDetectionAnnotation(existingAnnotation.id, {
          annotation: {
            annotation: annotationItems,
          },
          processing_stage: 'annotated',
        });
      } else {
        // No annotation exists - this shouldn't happen if sequence annotation was submitted first
        // But in case it does, throw an error to guide the user
        throw new Error(
          `No detection annotation found for detection ${detection.id}. Please ensure the sequence annotation has been submitted first to auto-create detection annotations.`
        );
      }
    },
    onSuccess: (result, { detection }) => {
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

      setToastMessage(`Detection ${detection.id} annotated successfully`);
      setShowToast(true);

      // Auto-advance to next detection if available
      if (
        selectedDetectionIndex !== null &&
        detections &&
        selectedDetectionIndex < detections.length - 1
      ) {
        // Mark as auto-advance (drawing mode already stored in onSubmit above)
        isAutoAdvanceRef.current = true;

        // Move to next detection
        const nextDetectionId = getDetectionIdByIndex(selectedDetectionIndex + 1);
        if (nextDetectionId && sequenceId) {
          navigate(`/detections/${sequenceId}/annotate/${nextDetectionId}`);
        }
      } else if (
        selectedDetectionIndex !== null &&
        detections &&
        selectedDetectionIndex === detections.length - 1
      ) {
        // At last detection - close modal after a brief delay to show success message
        setTimeout(() => {
          if (sequenceId) {
            navigate(`/detections/${sequenceId}/annotate`);
          }
        }, 1000);
      }
    },
    onError: (_, { detection }) => {
      setToastMessage(`Failed to annotate detection ${detection.id}`);
      setShowToast(true);
    },
  });

  const handleBack = () => {
    const backPath = sourcePage === 'review' ? '/detections/review' : '/detections/annotate';
    navigate(backPath);
  };

  const handleSave = () => {
    saveAnnotations.mutate();
  };

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
    return currentIndex >= 0 && allSequences?.items && currentIndex < allSequences.items.length - 1;
  };

  const handlePreviousSequence = () => {
    const currentIndex = getCurrentSequenceIndex();
    if (currentIndex > 0 && allSequences?.items) {
      const prevSequence = allSequences.items[currentIndex - 1];
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${prevSequence.id}/annotate${sourceParam}`);
    }
  };

  const handleNextSequence = () => {
    const currentIndex = getCurrentSequenceIndex();
    if (currentIndex >= 0 && allSequences?.items && currentIndex < allSequences.items.length - 1) {
      const nextSequence = allSequences.items[currentIndex + 1];
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${nextSequence.id}/annotate${sourceParam}`);
    }
  };

  const openModal = (index: number) => {
    const detectionId = getDetectionIdByIndex(index);
    if (detectionId && sequenceId) {
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${sequenceId}/annotate/${detectionId}${sourceParam}`);
    }
  };

  const closeModal = () => {
    if (sequenceId) {
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${sequenceId}/annotate${sourceParam}`);
    }
  };

  const navigateModal = (direction: 'prev' | 'next') => {
    if (!detections || selectedDetectionIndex === null || !sequenceId) return;

    const newIndex =
      direction === 'prev'
        ? Math.max(0, selectedDetectionIndex - 1)
        : Math.min(detections.length - 1, selectedDetectionIndex + 1);

    const newDetectionId = getDetectionIdByIndex(newIndex);
    if (newDetectionId) {
      const sourceParam = fromParam ? `?from=${fromParam}` : '';
      navigate(`/detections/${sequenceId}/annotate/${newDetectionId}${sourceParam}`);
    }
  };

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
        // Invalid detection ID - redirect to base URL
        console.warn(`Invalid detection ID ${detectionId} for sequence ${sequenceId}`);
        if (sequenceId) {
          navigate(`/detections/${sequenceId}/annotate`, { replace: true });
        }
      }
    } else if (!detectionId) {
      // No detection ID in URL - ensure modal is closed
      setShowModal(false);
      setSelectedDetectionIndex(null);
    }
  }, [detectionId, detections, sequenceId, navigate, getDetectionIndexById]);

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Submit with Enter key
      if (e.key === 'Enter' && !showModal) {
        handleSave();
        e.preventDefault();
        return;
      }

      // Toggle predictions visibility with 'p' key (works globally, whether modal is open or not)
      if (e.key === 'p' || e.key === 'P') {
        setShowPredictions(!showPredictions);
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

  const { annotatedDetections, totalDetections, completionPercentage } = progressStats;
  const annotatedCount = annotatedDetections;
  const totalCount = totalDetections;
  const allInVisualCheck = areAllInVisualCheckStage();

  // Helper to get annotation pills
  const getAnnotationPills = () => {
    if (!sequenceAnnotation) return null;

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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-video bg-gray-200 animate-pulse rounded-lg"></div>
              <div className="h-4 bg-gray-200 animate-pulse rounded"></div>
              <div className="h-3 w-24 bg-gray-200 animate-pulse rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load detections</p>
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
            <p className="text-lg font-medium mb-2">No detections found</p>
            <p className="text-gray-500">This sequence doesn't have any detections to annotate.</p>
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
    <>
      {/* Fixed Header */}
      <div
        className={`fixed top-0 left-0 md:left-64 right-0 backdrop-blur-sm shadow-sm z-30 ${
          isAllAnnotated
            ? 'bg-green-50/90 border-b border-green-200 border-l-4 border-l-green-500'
            : 'bg-white/85 border-b border-gray-200'
        }`}
      >
        <div className="px-10 py-3">
          {/* Top Row: Context + Action Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={handleBack}
                className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75"
                title="Back to sequences"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-900">
                  {sequence?.organisation_name || 'Loading...'}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-sm text-gray-600">
                  {sequence?.camera_name || 'Loading...'}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-sm text-gray-600">
                  {sequence?.recorded_at
                    ? new Date(sequence.recorded_at).toLocaleString()
                    : 'Loading...'}
                </span>
                {sequence?.azimuth !== null && sequence?.azimuth !== undefined && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">{sequence.azimuth}°</span>
                  </>
                )}
                {sequence?.lat !== null &&
                  sequence?.lat !== undefined &&
                  sequence?.lon !== null &&
                  sequence?.lon !== undefined && (
                    <>
                      <span className="text-gray-400">•</span>
                      <span className="text-xs text-gray-500">
                        {sequence.lat.toFixed(3)}, {sequence.lon.toFixed(3)}
                      </span>
                    </>
                  )}

                {/* Sequence context */}
                {rawSequencesLoading ? (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500 animate-pulse">
                      Loading sequences...
                    </span>
                  </>
                ) : rawSequencesError ? (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-red-500">Error loading sequences</span>
                  </>
                ) : allSequences && allSequences.total > 0 ? (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-blue-600 font-medium">
                      Sequence {getCurrentSequenceIndex() + 1} of {allSequences.total}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">No sequences found</span>
                  </>
                )}

                {/* Completion Badge */}
                {isAllAnnotated && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="inline-flex items-center text-xs text-green-600 font-medium">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Completed
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Navigation Buttons */}
              {rawSequencesLoading ? (
                <>
                  <button
                    disabled
                    className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                    title="Loading sequences..."
                  >
                    <ChevronLeft className="w-4 h-4 animate-pulse" />
                  </button>
                  <button
                    disabled
                    className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                    title="Loading sequences..."
                  >
                    <ChevronRight className="w-4 h-4 animate-pulse" />
                  </button>
                </>
              ) : rawSequencesError ? (
                <>
                  <button
                    disabled
                    className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                    title="Error loading sequences"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    disabled
                    className="p-1.5 rounded-md opacity-40 cursor-not-allowed"
                    title="Error loading sequences"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handlePreviousSequence}
                    disabled={!canNavigatePrevious()}
                    className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={
                      canNavigatePrevious() ? 'Previous sequence' : 'Already at first sequence'
                    }
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleNextSequence}
                    disabled={!canNavigateNext()}
                    className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={canNavigateNext() ? 'Next sequence' : 'Already at last sequence'}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}

              {/* Predictions Toggle */}
              <label className="flex items-center space-x-2 px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPredictions}
                  onChange={e => setShowPredictions(e.target.checked)}
                  className="w-3 h-3 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span>Show predictions</span>
              </label>

              {allInVisualCheck && (
                <button
                  onClick={handleSave}
                  disabled={saveAnnotations.isPending}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Submit all detection annotations (Enter) - All flagged as false positive sequences"
                >
                  {saveAnnotations.isPending ? (
                    <div className="w-3 h-3 mr-1 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Upload className="w-3 h-3 mr-1" />
                  )}
                  Submit All
                </button>
              )}
            </div>
          </div>

          {/* Bottom Row: Progress + Model Accuracy + Annotation Pills */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center space-x-4">
              <span className="text-xs font-medium text-gray-900">
                Review:{' '}
                {isAllAnnotated ? (
                  <span className="text-green-600">Done</span>
                ) : (
                  <span className="text-orange-600">Pending</span>
                )}{' '}
                • {annotatedCount} of {totalCount} detections • {completionPercentage}% complete
              </span>

              {/* Model Accuracy Context */}
              {sequence && sequenceAnnotation && (
                <div className="flex items-center space-x-2">
                  {(() => {
                    const accuracy = analyzeSequenceAccuracy({
                      ...sequence,
                      annotation: sequenceAnnotation,
                    });
                    return (
                      <span className={getModelAccuracyBadgeClasses(accuracy, 'sm')}>
                        {accuracy.icon} {accuracy.label}
                      </span>
                    );
                  })()}
                </div>
              )}

              {/* Annotation pills */}
              <div className="flex items-center space-x-2">{getAnnotationPills()}</div>
            </div>

            <div className="flex items-center space-x-3">
              {isAllAnnotated ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-orange-500" />
              )}
              <div className="w-24 bg-gray-200 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    isAllAnnotated ? 'bg-green-600' : 'bg-primary-600'
                  }`}
                  style={{ width: `${completionPercentage}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <DetectionGrid
        detections={detections}
        onDetectionClick={openModal}
        showPredictions={showPredictions}
        detectionAnnotations={detectionAnnotations}
        fromParam={fromParam}
        getIsAnnotated={getIsAnnotated}
      />

      {/* Image Modal */}
      {showModal && selectedDetectionIndex !== null && detections[selectedDetectionIndex] && (
        <ImageModal
          detection={detections[selectedDetectionIndex]}
          onClose={closeModal}
          onNavigate={navigateModal}
          onSubmit={(detection, drawnRectangles, currentDrawMode) => {
            // Store current drawing mode state before auto-advancing
            setPersistentDrawMode(currentDrawMode);
            annotateIndividualDetection.mutate({ detection, drawnRectangles });
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
            fromParam
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
    </>
  );
}
