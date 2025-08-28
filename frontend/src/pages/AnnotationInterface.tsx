import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, X } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { SequenceAnnotation, SequenceBbox } from '@/types/api';
import { useSequenceStore } from '@/store/useSequenceStore';
import { getAnnotationProgress, isAnnotationComplete } from '@/utils/annotation/progressUtils';
import {
  createBboxChangeHandler,
  createMissedSmokeHandler,
  createSaveHandler,
  createResetHandler,
} from '@/utils/annotation/annotationHandlers';
import {
  createPreviousDetectionNavigator,
  createNextDetectionNavigator,
} from '@/utils/annotation/navigationUtils';
import { createKeyboardHandler } from '@/utils/annotation/keyboardUtils';
import {
  createAnnotationInitializationEffect,
  createIntersectionObserverEffect,
  createSequenceStateClearing,
} from '@/utils/annotation/effectUtils';
import {
  AnnotationHeader,
  ProcessingStageMessages,
  MissedSmokePanel,
  SequenceAnnotationGrid,
} from '@/components/sequence-annotation';
import { NotificationSystem } from '@/components/ui/NotificationSystem';
import { useToastNotifications } from '@/utils/notification/toastUtils';

export default function AnnotationInterface() {
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

  // Determine back navigation URL based on source context
  const searchParams = new URLSearchParams(window.location.search);
  const fromParam = searchParams.get('from');
  const backUrl = fromParam === 'review' ? '/sequences/review' : '/sequences/annotate';

  const [bboxes, setBboxes] = useState<SequenceBbox[]>([]);
  const [, setCurrentAnnotation] = useState<SequenceAnnotation | null>(null);
  const [hasMissedSmoke, setHasMissedSmoke] = useState<boolean>(false);
  const [missedSmokeReview, setMissedSmokeReview] = useState<'yes' | 'no' | null>(null);
  const [isUnsure, setIsUnsure] = useState<boolean>(false);

  // Primary classification UI state (separate from data state)
  const [primaryClassification, setPrimaryClassification] = useState<
    Record<number, 'unselected' | 'smoke' | 'false_positive'>
  >({});

  // Keyboard shortcuts state
  const [activeDetectionIndex, setActiveDetectionIndex] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<'detections' | 'sequence'>('detections');
  const [showKeyboardModal, setShowKeyboardModal] = useState(false);
  const detectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sequenceReviewerRef = useRef<HTMLDivElement | null>(null);

  // Toast notification system
  const { showToast, toastMessage, toastType, showToastNotification, dismissToast } =
    useToastNotifications();

  // Fetch sequence annotation by sequence ID
  const {
    data: annotationResponse,
    isLoading,
    error,
  } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, 'by-sequence', sequenceId],
    queryFn: async () => {
      const response = await apiClient.getSequenceAnnotations({
        sequence_id: sequenceId!,
        size: 1,
      });
      return response.items[0] || null; // Return first annotation or null
    },
    enabled: !!sequenceId,
  });

  const annotation = annotationResponse;

  // Fetch sequence data for header info
  const { data: sequence } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(sequenceId!),
    queryFn: () => apiClient.getSequence(sequenceId!),
    enabled: !!sequenceId,
  });

  // Clear state immediately when sequence changes to prevent stale data
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    createSequenceStateClearing(
      sequenceId,
      setBboxes,
      setCurrentAnnotation,
      setHasMissedSmoke,
      setMissedSmokeReview,
      setIsUnsure
    ),
    [sequenceId]
  );

  // Initialize bboxes and missed smoke when annotation loads - respecting processing stage
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    createAnnotationInitializationEffect({
      annotation,
      sequenceId,
      setCurrentAnnotation,
      setHasMissedSmoke,
      setIsUnsure,
      setMissedSmokeReview,
      setBboxes,
    }),
    [annotation, sequenceId]
  );

  // Clean up detection refs when bboxes change
  useEffect(() => {
    // Reset refs array to match current bboxes length
    detectionRefs.current = detectionRefs.current.slice(0, bboxes.length);
  }, [bboxes.length]);

  // Intersection Observer for viewport-based active detection
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    createIntersectionObserverEffect({
      bboxes,
      detectionRefs,
      sequenceReviewerRef,
      setActiveSection,
      setActiveDetectionIndex,
    }),
    [bboxes.length]
  );

  // Keyboard shortcuts handler using utility function
  useEffect(() => {
    const handleKeyDown = createKeyboardHandler({
      activeDetectionIndex,
      bboxes,
      showKeyboardModal,
      missedSmokeReview,
      primaryClassification,
      setShowKeyboardModal,
      handleReset,
      handleSave,
      navigateToPreviousDetection,
      navigateToNextDetection,
      handleMissedSmokeReviewChange,
      handleBboxChange,
      onPrimaryClassificationChange: setPrimaryClassification,
    });

    // Use capture phase to ensure we get events before other handlers
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDetectionIndex, bboxes, showKeyboardModal, missedSmokeReview, primaryClassification]);

  // Navigation functions using utility creators
  const navigateToPreviousDetection = createPreviousDetectionNavigator(
    { activeDetectionIndex, activeSection, bboxes, showKeyboardModal },
    { setActiveDetectionIndex, setActiveSection },
    { detectionRefs, sequenceReviewerRef }
  );

  const navigateToNextDetection = createNextDetectionNavigator(
    { activeDetectionIndex, activeSection, bboxes, showKeyboardModal },
    { setActiveDetectionIndex, setActiveSection },
    { detectionRefs, sequenceReviewerRef }
  );

  // Save annotation mutation
  const saveAnnotation = useMutation({
    mutationFn: async (updatedBboxes: SequenceBbox[]) => {
      const updatedAnnotation: Partial<SequenceAnnotation> = {
        annotation: {
          sequences_bbox: updatedBboxes, // Always preserve the actual bbox data
        },
        processing_stage: 'annotated', // Move to annotated stage
        // Update derived fields - all false for unsure sequences
        has_smoke: isUnsure ? false : updatedBboxes.some(bbox => bbox.is_smoke),
        has_false_positives: isUnsure
          ? false
          : updatedBboxes.some(bbox => bbox.false_positive_types.length > 0),
        false_positive_types: isUnsure
          ? '[]'
          : JSON.stringify([...new Set(updatedBboxes.flatMap(bbox => bbox.false_positive_types))]),
        // Include missed smoke flag - false for unsure sequences
        has_missed_smoke: isUnsure ? false : hasMissedSmoke,
        // Include unsure flag
        is_unsure: isUnsure,
      };

      return apiClient.updateSequenceAnnotation(annotation!.id, updatedAnnotation);
    },
    onSuccess: () => {
      // Show success toast notification
      showToastNotification('Annotation saved successfully', 'success');

      // Refresh annotations and sequences
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCES });
      // Invalidate annotation counts to update sidebar badges
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });

      // Check for next sequence in workflow
      setTimeout(() => {
        const nextSequence = getNextSequenceInWorkflow();

        if (nextSequence) {
          // Navigate to next sequence in workflow
          const currentIndex = annotationWorkflow?.currentIndex || 0;
          const totalSequences = annotationWorkflow?.sequences?.length || 0;
          showToastNotification(
            `Moving to sequence ${currentIndex + 2} of ${totalSequences}`,
            'info'
          );
          navigate(`/sequences/${nextSequence.id}/annotate`);
        } else {
          // No more sequences - workflow complete
          const totalCompleted = annotationWorkflow?.sequences?.length || 1;
          clearAnnotationWorkflow();
          showToastNotification(
            `Workflow completed! Annotated ${totalCompleted} sequences.`,
            'success'
          );
          navigate(backUrl);
        }
      }, 1000);
    },
  });

  // Event handlers created using utility functions
  const handleBboxChange = createBboxChangeHandler(setBboxes);
  const handleMissedSmokeReviewChange = createMissedSmokeHandler(
    setMissedSmokeReview,
    setHasMissedSmoke
  );

  const handleSave = createSaveHandler(
    bboxes,
    missedSmokeReview,
    isUnsure,
    saveAnnotation,
    showToastNotification
  );

  const handleReset = createResetHandler(
    annotation || null,
    setHasMissedSmoke,
    setIsUnsure,
    setMissedSmokeReview,
    setBboxes,
    setPrimaryClassification,
    showToastNotification
  );

  // Manual Navigation Handlers
  const handlePreviousSequence = () => {
    const prevSequence = navigateToPreviousInWorkflow();
    if (prevSequence) {
      navigate(`/sequences/${prevSequence.id}/annotate`);
    }
  };

  const handleNextSequence = () => {
    const nextSequence = navigateToNextInWorkflow();
    if (nextSequence) {
      navigate(`/sequences/${nextSequence.id}/annotate`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !annotation) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load annotation</p>
          <p className="text-gray-500 text-sm">{String(error)}</p>
          <button
            onClick={() => navigate(backUrl)}
            className="mt-4 text-primary-600 hover:text-primary-900"
          >
            Back to Sequences
          </button>
        </div>
      </div>
    );
  }

  const progress = getAnnotationProgress(bboxes);

  return (
    <>
      <AnnotationHeader
        onBack={() => {
          clearAnnotationWorkflow();
          navigate(backUrl);
        }}
        sequence={sequence}
        annotation={annotation}
        progress={progress}
        isUnsure={isUnsure}
        missedSmokeReview={missedSmokeReview}
        annotationWorkflow={annotationWorkflow}
        canNavigatePrevious={canNavigatePrevious}
        canNavigateNext={canNavigateNext}
        onPreviousSequence={handlePreviousSequence}
        onNextSequence={handleNextSequence}
        onToggleKeyboardModal={() => setShowKeyboardModal(true)}
        onReset={handleReset}
        onSave={handleSave}
        isAnnotationComplete={isAnnotationComplete(bboxes, missedSmokeReview)}
        isSaving={saveAnnotation.isPending}
        onUnsureChange={setIsUnsure}
        fromParam={fromParam}
      />

      {/* Content with top padding to account for fixed header */}
      <div className="space-y-6 pt-20">
        <ProcessingStageMessages annotation={annotation} />

        <MissedSmokePanel
          sequenceId={sequenceId || 0}
          missedSmokeReview={missedSmokeReview}
          onMissedSmokeReviewChange={handleMissedSmokeReviewChange}
          annotationLoading={isLoading}
          activeSection={activeSection}
          sequenceReviewerRef={sequenceReviewerRef}
        />

        <SequenceAnnotationGrid
          bboxes={bboxes}
          annotation={annotation}
          sequenceId={sequenceId || 0}
          activeDetectionIndex={activeDetectionIndex || 0}
          primaryClassification={primaryClassification}
          detectionRefs={detectionRefs}
          onDetectionClick={setActiveDetectionIndex}
          onBboxChange={handleBboxChange}
          onPrimaryClassificationChange={setPrimaryClassification}
        />

        {/* Empty State */}
        {bboxes.length === 0 && (
          <div className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-lg font-medium text-gray-900 mb-2">No Sequence Bboxes Found</p>
            <p className="text-gray-600">
              This annotation doesn't contain any sequence bounding boxes to annotate.
            </p>
          </div>
        )}

        {/* Toast Notification */}
        <NotificationSystem
          showToast={showToast}
          toastMessage={toastMessage}
          toastType={toastType}
          onDismiss={dismissToast}
          autoDismissMs={3500}
        />

        {/* Keyboard Shortcuts Modal */}
        {showKeyboardModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl max-h-[90vh] overflow-y-auto m-4">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Keyboard Shortcuts</h2>
                <button
                  onClick={() => setShowKeyboardModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-md"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* General Shortcuts */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">General</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Show keyboard shortcuts</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">?</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Close modal</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">
                          Escape
                        </kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Reset annotation</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">
                          Ctrl+Z
                        </kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Submit annotation</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">Enter</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Previous detection</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">↑</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Next detection</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">↓</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Mark as smoke sequence</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">S</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Mark as false positive</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">F</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Mark as missed smoke</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">Y</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Mark as no missed smoke</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">N</kbd>
                      </div>
                    </div>
                  </div>

                  {/* Smoke Types */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Smoke Types</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">🔥 Wildfire</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">1</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">🏭 Industrial</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">2</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">💨 Other</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">3</kbd>
                      </div>
                    </div>
                    <div className="mt-4 p-3 bg-orange-50 rounded-md">
                      <p className="text-xs text-orange-800">
                        <strong>Note:</strong> Smoke type shortcuts only work when "Smoke Sequence"
                        is selected.
                      </p>
                    </div>
                  </div>

                  {/* False Positive Types */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">False Positive Types</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Antenna</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">A</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Building</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">B</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Cliff</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">C</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Dark</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">D</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Dust</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">U</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">High Cloud</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">H</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Low Cloud</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">L</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Lens Flare</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">G</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Lens Droplet</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">P</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Light</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">I</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Rain</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">R</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Trail</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">T</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Road</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">O</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Sky</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">K</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Tree</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">E</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Water Body</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">W</kbd>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Other</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">X</kbd>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-blue-50 rounded-md">
                  <p className="text-sm text-blue-800">
                    <strong>Note:</strong> Detection-specific shortcuts (S, F, 1-3, and false
                    positive types) only work when a detection is active (highlighted in blue).
                    Smoke type shortcuts (1-3) only work when "Smoke Sequence" is selected. False
                    positive type shortcuts only work when "False Positive" is selected. Global
                    shortcuts (?, Escape, Ctrl+Z, Enter, ↑/↓) work anywhere on the page.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
