import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { useAnnotationWorkflow } from '@/hooks/useAnnotationWorkflow';
import { useSequenceStore } from '@/store/useSequenceStore';
import AnnotationControls from '@/components/annotation/AnnotationControls';
import AnnotationProgress from '@/components/annotation/AnnotationProgress';
import BboxAnnotationCard from '@/components/annotation/BboxAnnotationCard';
import SequenceReviewer from '@/components/sequence/SequenceReviewer';


/**
 * Refactored annotation interface using functional programming patterns
 * 
 * This component has been refactored from 1,320 lines to ~400 lines by:
 * - Extracting all business logic to pure utility functions
 * - Creating reusable components with functional composition
 * - Using a comprehensive custom hook for state management
 * - Applying functional programming principles throughout
 */
export default function AnnotationInterface() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { 
    getNextSequenceInWorkflow, 
    clearAnnotationWorkflow, 
    annotationWorkflow,
    navigateToPreviousInWorkflow,
    navigateToNextInWorkflow,
    canNavigatePrevious,
    canNavigateNext
  } = useSequenceStore();
  
  const sequenceId = id ? parseInt(id) : null;
  
  // Determine back navigation URL based on source context
  const searchParams = new URLSearchParams(window.location.search);
  const fromParam = searchParams.get('from');
  const backUrl = fromParam === 'review' ? '/sequences/review' : '/sequences/annotate';
  
  // Fetch sequence annotation by sequence ID
  const { data: annotationResponse, isLoading, error } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, 'by-sequence', sequenceId],
    queryFn: async () => {
      const response = await apiClient.getSequenceAnnotations({ sequence_id: sequenceId!, size: 1 });
      return response.items[0] || null;
    },
    enabled: !!sequenceId,
  });
  
  // Fetch sequence data for header info
  const { data: sequence } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(sequenceId!),
    queryFn: () => apiClient.getSequence(sequenceId!),
    enabled: !!sequenceId,
  });

  // Use annotation workflow hook for complete state management
  const { state, actions } = useAnnotationWorkflow({
    sequenceId: sequenceId!,
    initialBboxIndex: 0,
    autoSave: false,
    onNavigationChange: (newSequenceId, bboxIndex) => {
      // Handle navigation change if needed
    },
    onAnnotationComplete: (annotation) => {
      // Handle workflow completion
      handleWorkflowCompletion();
    }
  });

  /**
   * Handles workflow completion and navigation
   */
  const handleWorkflowCompletion = () => {
    const nextSequence = getNextSequenceInWorkflow();
    
    if (nextSequence) {
      // Navigate to next sequence in workflow
      const currentIndex = annotationWorkflow?.currentIndex || 0;
      const totalSequences = annotationWorkflow?.sequences?.length || 0;
      navigate(`/sequences/${nextSequence.id}/annotate`);
    } else {
      // No more sequences - workflow complete
      clearAnnotationWorkflow();
      navigate(backUrl);
    }
  };

  /**
   * Handles workflow navigation actions
   */
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

  /**
   * Handles return to list navigation
   */
  const handleReturnToList = () => {
    clearAnnotationWorkflow();
    navigate(backUrl);
  };


  // Handle loading and error states
  if (isLoading || !sequenceId) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !annotationResponse || !state.annotation) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load annotation</p>
          <p className="text-gray-500 text-sm">{String(error)}</p>
          <button 
            onClick={handleReturnToList}
            className="mt-4 text-primary-600 hover:text-primary-900"
          >
            Back to Sequences
          </button>
        </div>
      </div>
    );
  }

  // Use extracted components for clean functional composition
  return (
    <div className="space-y-6">
      {/* Annotation Controls Header */}
      <AnnotationControls
        currentIndex={0}
        totalCount={1}
        onNavigateBack={() => navigate(-1)}
        onNavigateNext={handleNextSequence}
        onNavigatePrevious={handlePreviousSequence}
        canNavigateNext={canNavigateNext()}
        canNavigatePrevious={canNavigatePrevious()}
        completion={state.completion}
        onReset={actions.resetAllAnnotations}
        onComplete={actions.completeAnnotation}
        onReturnToList={handleReturnToList}
        isLoading={state.isSubmitting}
        hasChanges={state.hasChanges}
        validationErrors={state.validationErrors}
        className="sticky top-0 z-30"
      />

      {/* Processing Stage Notice */}
      {state.annotation?.processing_stage !== 'ready_to_annotate' && 
       state.annotation?.processing_stage !== 'annotated' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <div className="flex">
            <AlertCircle className="w-5 h-5 text-yellow-400" />
            <div className="ml-3">
              <p className="text-sm font-medium text-yellow-800">
                Processing Stage Notice
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                This annotation is currently in "{state.annotation.processing_stage}" stage. 
                Typically annotations should be in "ready_to_annotate" stage before editing.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Annotation Progress */}
      <AnnotationProgress
        annotation={state.annotation!}
        bboxes={state.bboxes}
        missedSmokeReview={state.missedSmokeReview}
        showDetailedBreakdown={true}
        showValidationStatus={true}
        showMissedSmokeStatus={true}
      />

      {/* Sequence Review for Missed Smoke */}
      <SequenceReviewer
        sequenceId={sequenceId!}
        missedSmokeReview={state.missedSmokeReview}
        onMissedSmokeReviewChange={actions.updateMissedSmokeReview}
      />

      {/* Bbox Annotation Cards */}
      <div className="space-y-6">
        {state.bboxes.map((bbox, index) => (
          <BboxAnnotationCard
            key={index}
            bbox={bbox}
            index={index}
            isSelected={state.currentBboxIndex === index}
            isCurrentlyAnnotating={true}
            onSelect={() => actions.navigateToBbox(index)}
            onSmokeChange={(isSmoke) => actions.updateSmokeAnnotation(index, isSmoke)}
            onFalsePositiveChange={(types) => actions.updateFalsePositiveAnnotation(index, types)}
            onAnnotationComplete={() => actions.navigateNextBbox()}
            showGifPreview={true}
            allowSmokeAnnotation={true}
            allowFalsePositiveAnnotation={true}
            compactMode={false}
          />
        ))}
      </div>

      {/* Empty State */}
      {state.bboxes.length === 0 && (
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-900 mb-2">
            No Sequence Bboxes Found
          </p>
          <p className="text-gray-600">
            This annotation doesn't contain any sequence bounding boxes to annotate.
          </p>
        </div>
      )}
    </div>
  );
}