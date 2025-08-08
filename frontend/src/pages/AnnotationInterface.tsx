import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, RotateCcw, CheckCircle, AlertCircle, Eye, Keyboard, X, Upload, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS, FALSE_POSITIVE_TYPES } from '@/utils/constants';
import { SequenceAnnotation, SequenceBbox, FalsePositiveType } from '@/types/api';
import { useGifUrls } from '@/hooks/useGifUrls';
import SequenceReviewer from '@/components/sequence/SequenceReviewer';
import { useSequenceStore } from '@/store/useSequenceStore';

// Helper functions for annotation state management
const hasUserAnnotations = (bbox: SequenceBbox): boolean => {
  return bbox.is_smoke || bbox.false_positive_types.length > 0;
};

const initializeCleanBbox = (originalBbox: SequenceBbox): SequenceBbox => {
  return {
    ...originalBbox,
    is_smoke: false,
    false_positive_types: [],
    // Preserve structure like gif_key_main, gif_key_crop, bboxes with detection_ids
  };
};

const shouldShowAsAnnotated = (bbox: SequenceBbox, processingStage: string): boolean => {
  // If already marked as annotated in processing stage, show as annotated
  if (processingStage === 'annotated') {
    return true;
  }
  // If ready to annotate, only show as annotated if user has made selections
  if (processingStage === 'ready_to_annotate') {
    return hasUserAnnotations(bbox);
  }
  // For other stages, default to checking user annotations
  return hasUserAnnotations(bbox);
};

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
    canNavigateNext
  } = useSequenceStore();
  
  const sequenceId = id ? parseInt(id) : null;
  
  const [bboxes, setBboxes] = useState<SequenceBbox[]>([]);
  const [, setCurrentAnnotation] = useState<SequenceAnnotation | null>(null);
  const [hasMissedSmoke, setHasMissedSmoke] = useState<boolean>(false);
  const [missedSmokeReview, setMissedSmokeReview] = useState<'yes' | 'no' | null>(null);
  
  // Keyboard shortcuts state
  const [activeDetectionIndex, setActiveDetectionIndex] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<'detections' | 'sequence'>('detections');
  const [showKeyboardModal, setShowKeyboardModal] = useState(false);
  const detectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sequenceReviewerRef = useRef<HTMLDivElement | null>(null);

  // Toast notification state
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');

  // Fetch sequence annotation by sequence ID
  const { data: annotationResponse, isLoading, error } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, 'by-sequence', sequenceId],
    queryFn: async () => {
      const response = await apiClient.getSequenceAnnotations({ sequence_id: sequenceId!, size: 1 });
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

  // Fetch GIF URLs
  const { data: gifUrls, isLoading: loadingGifs } = useGifUrls(annotation?.id || null);

  // Initialize bboxes and missed smoke when annotation loads - respecting processing stage
  useEffect(() => {
    if (annotation) {
      setCurrentAnnotation(annotation);
      
      // Initialize missed smoke flag from existing annotation
      setHasMissedSmoke(annotation.has_missed_smoke || false);
      
      // Initialize missed smoke review from existing annotation
      setMissedSmokeReview(annotation.has_missed_smoke ? 'yes' : null);
      
      // Smart initialization based on processing stage
      if (annotation.processing_stage === 'ready_to_annotate') {
        // For sequences ready to annotate, start with clean checkboxes
        const cleanBboxes = annotation.annotation.sequences_bbox.map(bbox => 
          initializeCleanBbox(bbox)
        );
        setBboxes(cleanBboxes);
      } else {
        // For other stages (like 'annotated'), preserve existing data
        setBboxes([...annotation.annotation.sequences_bbox]);
      }
    }
  }, [annotation]);

  // Intersection Observer for viewport-based active detection
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0;
        let bestIndex: number | null = null;
        let sequenceReviewerVisible = false;
        
        entries.forEach((entry) => {
          // Check if it's the sequence reviewer
          if (entry.target === sequenceReviewerRef.current) {
            if (entry.intersectionRatio > 0.5) {
              sequenceReviewerVisible = true;
            }
            return;
          }

          // Check detection elements
          const index = detectionRefs.current.findIndex(ref => ref === entry.target);
          if (index !== -1 && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            bestIndex = index;
          }
        });
        
        // Priority: sequence reviewer if visible, otherwise best detection
        if (sequenceReviewerVisible) {
          setActiveSection('sequence');
          setActiveDetectionIndex(null);
        } else if (maxRatio > 0.5 && bestIndex !== null) {
          setActiveSection('detections');
          setActiveDetectionIndex(bestIndex);
        }
      },
      {
        threshold: [0.1, 0.3, 0.5, 0.7, 0.9],
        rootMargin: '-20px'
      }
    );

    // Observe all detection cards
    detectionRefs.current.forEach(ref => {
      if (ref) observer.observe(ref);
    });

    // Observe sequence reviewer
    if (sequenceReviewerRef.current) {
      observer.observe(sequenceReviewerRef.current);
    }

    return () => {
      detectionRefs.current.forEach(ref => {
        if (ref) observer.unobserve(ref);
      });
      if (sequenceReviewerRef.current) {
        observer.unobserve(sequenceReviewerRef.current);
      }
    };
  }, [bboxes.length]);

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Debug: Log all key events for troubleshooting
      console.log('Key pressed:', {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        target: e.target,
        activeDetectionIndex,
        showKeyboardModal
      });

      // Handle help modal first (works regardless of focus)
      // Note: '?' key requires Shift to be pressed, so we shouldn't check for !e.shiftKey
      if (e.key === '?') {
        console.log('? key pressed, toggling keyboard modal'); // Debug log
        setShowKeyboardModal(!showKeyboardModal);
        e.preventDefault();
        return;
      }
      
      // Handle Escape to close modal
      if (e.key === 'Escape' && showKeyboardModal) {
        console.log('Escape pressed, closing modal'); // Debug log
        setShowKeyboardModal(false);
        e.preventDefault();
        return;
      }

      // Handle global shortcuts (work regardless of active detection)
      // Reset annotation (Ctrl + Z)
      if (e.key === 'z' && e.ctrlKey) {
        console.log('Ctrl+Z pressed, resetting annotation'); // Debug log
        handleReset();
        e.preventDefault();
        return;
      }

      // Complete annotation (Enter)
      if (e.key === 'Enter' && !showKeyboardModal) {
        console.log('Enter pressed, attempting to complete annotation'); // Debug log
        if (isAnnotationComplete()) {
          handleSave();
        } else {
          handleSave(); // Use the same error logic as handleSave
        }
        e.preventDefault();
        return;
      }

      // Navigation shortcuts (Arrow Up/Down)
      if (e.key === 'ArrowUp' && !showKeyboardModal) {
        console.log('Arrow Up pressed, navigating to previous detection'); // Debug log
        navigateToPreviousDetection();
        e.preventDefault();
        return;
      }

      if (e.key === 'ArrowDown' && !showKeyboardModal) {
        console.log('Arrow Down pressed, navigating to next detection'); // Debug log
        navigateToNextDetection();
        e.preventDefault();
        return;
      }

      // Missed smoke review shortcuts (Y/N)
      if ((e.key === 'y' || e.key === 'Y') && !showKeyboardModal) {
        console.log('Y pressed, marking as missed smoke'); // Debug log
        handleMissedSmokeReviewChange('yes');
        e.preventDefault();
        return;
      }

      if ((e.key === 'n' || e.key === 'N') && !showKeyboardModal) {
        console.log('N pressed, marking as no missed smoke'); // Debug log
        handleMissedSmokeReviewChange('no');
        e.preventDefault();
        return;
      }

      // Ignore if focused on input elements, no active detection, modal is open, or modifier keys are pressed
      if (e.target instanceof HTMLInputElement || 
          e.target instanceof HTMLTextAreaElement || 
          activeDetectionIndex === null ||
          showKeyboardModal ||
          e.ctrlKey || e.metaKey || e.altKey) {
        console.log('Ignoring key event due to:', {
          isInput: e.target instanceof HTMLInputElement,
          isTextarea: e.target instanceof HTMLTextAreaElement,
          noActiveDetection: activeDetectionIndex === null,
          modalOpen: showKeyboardModal,
          hasModifier: e.ctrlKey || e.metaKey || e.altKey
        });
        return;
      }

      const key = e.key.toLowerCase();
      
      if (key === 's') {
        // Toggle smoke for active detection
        const bbox = bboxes[activeDetectionIndex];
        if (bbox) {
          const updatedBbox = { ...bbox, is_smoke: !bbox.is_smoke };
          if (updatedBbox.is_smoke) {
            updatedBbox.false_positive_types = [];
          }
          handleBboxChange(activeDetectionIndex, updatedBbox);
          e.preventDefault();
        }
      } else {
        // Handle letter-based shortcuts for false positive types
        const typeIndex = getTypeIndexForKey(key);
        if (typeIndex !== -1) {
          toggleFalsePositiveType(activeDetectionIndex, typeIndex);
          e.preventDefault();
        }
      }
    };

    // Use capture phase to ensure we get events before other handlers
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [activeDetectionIndex, bboxes, showKeyboardModal]);

  // Toast auto-dismiss logic
  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => {
        setShowToast(false);
      }, 3500); // Auto-dismiss after 3.5 seconds

      return () => clearTimeout(timer);
    }
  }, [showToast]);

  // Helper function to show toast notifications
  const showToastNotification = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
  };

  // Helper function to map keyboard keys to false positive type indices
  const getTypeIndexForKey = (key: string): number => {
    const keyMap: Record<string, number> = {
      'a': FALSE_POSITIVE_TYPES.indexOf('antenna'),
      'b': FALSE_POSITIVE_TYPES.indexOf('building'),
      'c': FALSE_POSITIVE_TYPES.indexOf('cliff'),
      'd': FALSE_POSITIVE_TYPES.indexOf('dark'),
      'u': FALSE_POSITIVE_TYPES.indexOf('dust'), // 'd' taken by dark
      'h': FALSE_POSITIVE_TYPES.indexOf('high_cloud'),
      'l': FALSE_POSITIVE_TYPES.indexOf('low_cloud'),
      'f': FALSE_POSITIVE_TYPES.indexOf('lens_flare'),
      'p': FALSE_POSITIVE_TYPES.indexOf('lens_droplet'), // 'l' taken by low_cloud, use 'p' for droplet
      'i': FALSE_POSITIVE_TYPES.indexOf('light'), // 'l' taken
      'r': FALSE_POSITIVE_TYPES.indexOf('rain'),
      't': FALSE_POSITIVE_TYPES.indexOf('trail'),
      'o': FALSE_POSITIVE_TYPES.indexOf('road'), // 'r' taken by rain, use 'o' for road
      'k': FALSE_POSITIVE_TYPES.indexOf('sky'), // 's' taken by smoke
      'e': FALSE_POSITIVE_TYPES.indexOf('tree'), // 't' taken by trail
      'w': FALSE_POSITIVE_TYPES.indexOf('water_body'),
      'x': FALSE_POSITIVE_TYPES.indexOf('other'), // 'o' taken by road
    };
    
    return keyMap[key] ?? -1;
  };

  // Helper function to toggle false positive types
  const toggleFalsePositiveType = (detectionIndex: number, typeIndex: number) => {
    const bbox = bboxes[detectionIndex];
    if (!bbox || bbox.is_smoke) return; // Don't allow if it's marked as smoke
    
    const fpType = FALSE_POSITIVE_TYPES[typeIndex] as FalsePositiveType;
    const updatedBbox = { ...bbox };
    
    if (bbox.false_positive_types.includes(fpType)) {
      // Remove the type
      updatedBbox.false_positive_types = bbox.false_positive_types.filter(type => type !== fpType);
    } else {
      // Add the type
      updatedBbox.false_positive_types = [...bbox.false_positive_types, fpType];
    }
    
    handleBboxChange(detectionIndex, updatedBbox);
  };

  // Navigation helper functions
  const navigateToPreviousDetection = () => {
    // If we're in sequence section, go back to last detection
    if (activeSection === 'sequence') {
      if (bboxes.length > 0) {
        const lastIndex = bboxes.length - 1;
        setActiveDetectionIndex(lastIndex);
        setActiveSection('detections');
        
        const lastElement = detectionRefs.current[lastIndex];
        if (lastElement) {
          lastElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }
      }
      return;
    }

    // If at first detection, go to sequence reviewer
    if (activeSection === 'detections' && activeDetectionIndex === 0) {
      setActiveSection('sequence');
      setActiveDetectionIndex(null);
      
      // Scroll sequence reviewer into view
      if (sequenceReviewerRef.current) {
        sequenceReviewerRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
      return;
    }

    // Regular detection navigation
    if (activeDetectionIndex === null || activeDetectionIndex <= 0) {
      console.log('Already at first detection or no active detection');
      return;
    }
    
    const previousIndex = activeDetectionIndex - 1;
    setActiveDetectionIndex(previousIndex);
    
    // Scroll the previous detection into view
    const previousElement = detectionRefs.current[previousIndex];
    if (previousElement) {
      previousElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  };

  const navigateToNextDetection = () => {
    // If in sequence section with detections, go to first detection
    if (activeSection === 'sequence' && bboxes.length > 0) {
      setActiveSection('detections');
      setActiveDetectionIndex(0);
      
      // Scroll first detection into view
      const firstElement = detectionRefs.current[0];
      if (firstElement) {
        firstElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
      return;
    }

    // If in sequence section and no detections, stay in sequence
    if (activeSection === 'sequence' && bboxes.length === 0) {
      console.log('Already at sequence section with no detections');
      return;
    }

    // Regular detection navigation
    if (activeDetectionIndex === null || activeDetectionIndex >= bboxes.length - 1) {
      console.log('Already at last detection or no active detection');
      return;
    }
    
    const nextIndex = activeDetectionIndex + 1;
    setActiveDetectionIndex(nextIndex);
    
    // Scroll the next detection into view
    const nextElement = detectionRefs.current[nextIndex];
    if (nextElement) {
      nextElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  };

  // Save annotation mutation
  const saveAnnotation = useMutation({
    mutationFn: async (updatedBboxes: SequenceBbox[]) => {
      const updatedAnnotation: Partial<SequenceAnnotation> = {
        annotation: {
          sequences_bbox: updatedBboxes
        },
        processing_stage: 'annotated', // Move to annotated stage
        // Update derived fields
        has_smoke: updatedBboxes.some(bbox => bbox.is_smoke),
        has_false_positives: updatedBboxes.some(bbox => bbox.false_positive_types.length > 0),
        false_positive_types: JSON.stringify(
          [...new Set(updatedBboxes.flatMap(bbox => bbox.false_positive_types))]
        ),
        // Include missed smoke flag
        has_missed_smoke: hasMissedSmoke,
      };

      return apiClient.updateSequenceAnnotation(annotation!.id, updatedAnnotation);
    },
    onSuccess: () => {
      // Show success toast notification
      showToastNotification('Annotation saved successfully', 'success');
      
      // Refresh annotations and sequences
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCES });
      
      // Check for next sequence in workflow
      setTimeout(() => {
        const nextSequence = getNextSequenceInWorkflow();
        
        if (nextSequence) {
          // Navigate to next sequence in workflow
          const currentIndex = annotationWorkflow?.currentIndex || 0;
          const totalSequences = annotationWorkflow?.sequences?.length || 0;
          showToastNotification(`Moving to sequence ${currentIndex + 2} of ${totalSequences}`, 'info');
          navigate(`/sequences/${nextSequence.id}/annotate`);
        } else {
          // No more sequences - workflow complete
          const totalCompleted = annotationWorkflow?.sequences?.length || 1;
          clearAnnotationWorkflow();
          showToastNotification(`Workflow completed! Annotated ${totalCompleted} sequences.`, 'success');
          navigate('/sequences');
        }
      }, 1000);
    },
  });

  const handleBboxChange = (index: number, updatedBbox: SequenceBbox) => {
    const newBboxes = [...bboxes];
    newBboxes[index] = updatedBbox;
    setBboxes(newBboxes);
  };

  const handleMissedSmokeReviewChange = (review: 'yes' | 'no') => {
    setMissedSmokeReview(review);
    // Sync with the boolean hasMissedSmoke state for backward compatibility
    setHasMissedSmoke(review === 'yes');
  };

  const handleSave = () => {
    const bboxesComplete = bboxes.every(bbox => 
      bbox.is_smoke || bbox.false_positive_types.length > 0
    );
    const missedSmokeComplete = missedSmokeReview !== null;

    if (!bboxesComplete && !missedSmokeComplete) {
      const progress = getAnnotationProgress();
      const remaining = progress.total - progress.completed;
      showToastNotification(
        `Cannot save: ${remaining} detection${remaining !== 1 ? 's' : ''} still need${remaining === 1 ? 's' : ''} annotation and missed smoke review is required`,
        'error'
      );
      return;
    } else if (!bboxesComplete) {
      const progress = getAnnotationProgress();
      const remaining = progress.total - progress.completed;
      showToastNotification(
        `Cannot save: ${remaining} detection${remaining !== 1 ? 's' : ''} still need${remaining === 1 ? 's' : ''} annotation`,
        'error'
      );
      return;
    } else if (!missedSmokeComplete) {
      showToastNotification(
        'Cannot save: Please complete the missed smoke review',
        'error'
      );
      return;
    }
    
    saveAnnotation.mutate(bboxes);
  };

  const handleReset = () => {
    if (annotation) {
      // Reset missed smoke to original value
      setHasMissedSmoke(annotation.has_missed_smoke || false);
      
      // Reset missed smoke review to original value
      setMissedSmokeReview(annotation.has_missed_smoke ? 'yes' : null);
      
      // Use the same logic as initialization to respect processing stage
      if (annotation.processing_stage === 'ready_to_annotate') {
        // For sequences ready to annotate, reset to clean checkboxes
        const cleanBboxes = annotation.annotation.sequences_bbox.map(bbox => 
          initializeCleanBbox(bbox)
        );
        setBboxes(cleanBboxes);
      } else {
        // For other stages (like 'annotated'), reset to original server data
        setBboxes([...annotation.annotation.sequences_bbox]);
      }
      
      // Show success toast notification
      showToastNotification('Annotation reset successfully', 'success');
    }
  };

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

  const isAnnotationComplete = () => {
    const bboxesComplete = bboxes.every(bbox => 
      bbox.is_smoke || bbox.false_positive_types.length > 0
    );
    const missedSmokeComplete = missedSmokeReview !== null;
    return bboxesComplete && missedSmokeComplete;
  };

  const getAnnotationProgress = () => {
    const completed = bboxes.filter(bbox => 
      bbox.is_smoke || bbox.false_positive_types.length > 0
    ).length;
    return { completed, total: bboxes.length };
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
            onClick={() => navigate('/annotations')}
            className="mt-4 text-primary-600 hover:text-primary-900"
          >
            Back to Annotations
          </button>
        </div>
      </div>
    );
  }

  const progress = getAnnotationProgress();

  return (
    <>
      {/* Fixed Header - Always at top */}
      <div className="fixed top-0 left-0 md:left-64 right-0 bg-white/85 backdrop-blur-sm border-b border-gray-200 shadow-sm z-30">
        <div className="px-10 py-3">
          {/* Top Row: Context + Action Buttons + Keyboard Shortcuts */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => {
                  clearAnnotationWorkflow(); // Clear workflow when manually navigating back
                  navigate('/sequences');
                }}
                className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75"
                title="Back to sequence"
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
                  {sequence?.recorded_at ? new Date(sequence.recorded_at).toLocaleString() : 'Loading...'}
                </span>
                {sequence?.azimuth !== null && sequence?.azimuth !== undefined && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {sequence.azimuth}°
                    </span>
                  </>
                )}
                {sequence?.lat !== null && sequence?.lat !== undefined && sequence?.lon !== null && sequence?.lon !== undefined && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {sequence.lat.toFixed(3)}, {sequence.lon.toFixed(3)}
                    </span>
                  </>
                )}
                
                {/* Workflow Progress Indicator */}
                {annotationWorkflow && annotationWorkflow.isActive && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-blue-600 font-medium">
                      Sequence {annotationWorkflow.currentIndex + 1} of {annotationWorkflow.sequences.length}
                    </span>
                  </>
                )}
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              {/* Workflow Navigation Buttons */}
              {annotationWorkflow && annotationWorkflow.isActive && (
                <>
                  <button
                    onClick={handlePreviousSequence}
                    disabled={!canNavigatePrevious()}
                    className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={canNavigatePrevious() ? "Previous sequence" : "Already at first sequence"}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleNextSequence}
                    disabled={!canNavigateNext()}
                    className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={canNavigateNext() ? "Next sequence" : "Already at last sequence"}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                onClick={handleReset}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                title="Reset annotation (Ctrl+Z)"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={!isAnnotationComplete() || saveAnnotation.isPending}
                className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Submit annotation (Enter)"
              >
                {saveAnnotation.isPending ? (
                  <div className="w-3 h-3 mr-1 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Upload className="w-3 h-3 mr-1" />
                )}
                Submit
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

          {/* Bottom Row: Progress + Status + Shortcuts Hint */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center space-x-4">
              <span className="text-xs font-medium text-gray-900">
                Review: {
                  missedSmokeReview ? (
                    <span className="text-green-600">Done</span>
                  ) : (
                    <span className="text-orange-600">Pending</span>
                  )
                } • {progress.completed} of {progress.total} detections • {Math.round((progress.completed / progress.total) * 100)}% complete
              </span>
            </div>
            
            <div className="flex items-center space-x-3">
              <span className="text-xs text-gray-500">
                Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">?</kbd> for shortcuts
              </span>
              {progress.completed === progress.total ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-orange-500" />
              )}
              <div className="w-24 bg-gray-200 rounded-full h-1.5">
                <div 
                  className="bg-primary-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content with top padding to account for fixed header */}
      <div className="space-y-6 pt-20">
        {/* Processing Stage Warning */}
        {annotation.processing_stage !== 'ready_to_annotate' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <div className="flex">
            <AlertCircle className="w-5 h-5 text-yellow-400" />
            <div className="ml-3">
              <p className="text-sm font-medium text-yellow-800">
                Processing Stage Notice
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                This annotation is currently in "{annotation.processing_stage}" stage. 
                Typically annotations should be in "ready_to_annotate" stage before editing.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sequence Review for Missed Smoke */}
      <div 
        ref={sequenceReviewerRef}
        className={`${activeSection === 'sequence' ? 'ring-2 ring-blue-500 ring-offset-2 rounded-lg' : ''}`}
      >
        <SequenceReviewer
          sequenceId={sequenceId!}
          missedSmokeReview={missedSmokeReview}
          onMissedSmokeReviewChange={handleMissedSmokeReviewChange}
        />
      </div>

      {/* GIF Loading State */}
      {loadingGifs && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <div className="flex">
            <Eye className="w-5 h-5 text-blue-400" />
            <div className="ml-3">
              <p className="text-sm font-medium text-blue-800">
                Loading GIF Previews...
              </p>
              <p className="text-sm text-blue-700 mt-1">
                Fetching visualization data for sequence bboxes
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Unified Detection Cards - GIFs + Annotation Controls */}
      <div className="space-y-8">
        {bboxes.map((bbox, index) => {
          const gifData = gifUrls?.gif_urls?.[index];
          
          const isActive = activeDetectionIndex === index;
          
          return (
            <div 
              key={index} 
              ref={(el) => detectionRefs.current[index] = el}
              className={`bg-white rounded-lg border p-6 cursor-pointer transition-all duration-200 ${
                isActive 
                  ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => setActiveDetectionIndex(index)}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                  <h4 className="text-lg font-medium text-gray-900">
                    Detection {index + 1}
                  </h4>
                  {isActive && (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      <Keyboard className="w-3 h-3 mr-1" />
                      Active
                    </span>
                  )}
                </div>
                <span className="text-sm text-gray-500">
                  {bbox.bboxes.length} bbox{bbox.bboxes.length !== 1 ? 'es' : ''}
                </span>
              </div>
              
              {/* Visual Content - Main GIF + Crop GIF */}
              <div className="space-y-6 mb-8">
                {loadingGifs ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="flex items-center justify-center space-x-2">
                      <div className="animate-spin w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full"></div>
                      <span>Loading GIFs...</span>
                    </div>
                  </div>
                ) : gifData ? (
                  <>
                    {/* Main GIF */}
                    {gifData.main_url && (
                      <div className="text-center">
                        <h5 className="text-sm font-medium text-gray-700 mb-3">Full Sequence</h5>
                        <img
                          src={gifData.main_url}
                          alt={`Main GIF for detection ${index + 1}`}
                          className="border border-gray-300 rounded shadow-sm mx-auto"
                          style={{ 
                            width: '1280px',
                            maxWidth: '100%', 
                            height: 'auto' 
                          }}
                        />
                      </div>
                    )}
                    
                    {/* Crop GIF */}
                    {gifData.crop_url && (
                      <div className="text-center">
                        <h5 className="text-sm font-medium text-gray-700 mb-3">Cropped View</h5>
                        <img
                          src={gifData.crop_url}
                          alt={`Crop GIF for detection ${index + 1}`}
                          className="border border-gray-300 rounded shadow-sm mx-auto"
                          style={{ 
                            width: '900px',
                            maxWidth: '100%', 
                            height: 'auto' 
                          }}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <span>No GIFs available for this detection</span>
                  </div>
                )}
              </div>
            
            {/* Annotation Controls */}
            <div className="space-y-4">
              {/* Smoke Classification */}
              <div>
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={bbox.is_smoke}
                    onChange={(e) => {
                      const updatedBbox = { ...bbox, is_smoke: e.target.checked };
                      if (e.target.checked) {
                        updatedBbox.false_positive_types = [];
                      }
                      handleBboxChange(index, updatedBbox);
                    }}
                    className="w-4 h-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                  />
                  <span className="text-sm font-medium text-gray-900">
                    🔥 Is smoke sequence
                  </span>
                  {isActive && (
                    <kbd className="ml-2 px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-mono">
                      S
                    </kbd>
                  )}
                </label>
              </div>

              {/* False Positive Types - Comprehensive selection */}
              {!bbox.is_smoke && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    False Positive Types (Select all that apply)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
                    {FALSE_POSITIVE_TYPES.map((fpType, fpIndex) => {
                      const isSelected = bbox.false_positive_types.includes(fpType);
                      const formatLabel = (type: string) => 
                        type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                      
                      // Get the keyboard shortcut for this type
                      const getKeyForType = (type: string) => {
                        const keyMap: Record<string, string> = {
                          'antenna': 'A',
                          'building': 'B',
                          'cliff': 'C',
                          'dark': 'D',
                          'dust': 'U',
                          'high_cloud': 'H',
                          'low_cloud': 'L',
                          'lens_flare': 'F',
                          'lens_droplet': 'P',
                          'light': 'I',
                          'rain': 'R',
                          'trail': 'T',
                          'road': 'O',
                          'sky': 'K',
                          'tree': 'E',
                          'water_body': 'W',
                          'other': 'X',
                        };
                        return keyMap[type];
                      };
                      
                      return (
                        <label key={fpType} className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const updatedBbox = { ...bbox };
                              if (e.target.checked) {
                                // Add the false positive type
                                updatedBbox.false_positive_types = [
                                  ...bbox.false_positive_types,
                                  fpType as FalsePositiveType
                                ];
                              } else {
                                // Remove the false positive type
                                updatedBbox.false_positive_types = bbox.false_positive_types.filter(
                                  type => type !== fpType
                                );
                              }
                              handleBboxChange(index, updatedBbox);
                            }}
                            className="w-3 h-3 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                          />
                          <span className="text-xs text-gray-600">
                            {formatLabel(fpType)}
                          </span>
                          {isActive && getKeyForType(fpType) && (
                            <kbd className="ml-1 px-1 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-mono">
                              {getKeyForType(fpType)}
                            </kbd>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  
                  {/* Selected types display */}
                  {bbox.false_positive_types.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-medium text-gray-700 mb-2">Selected:</div>
                      <div className="flex flex-wrap gap-1">
                        {bbox.false_positive_types.map((type) => (
                          <span
                            key={type}
                            className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200"
                          >
                            {type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                            <button
                              onClick={() => {
                                const updatedBbox = { ...bbox };
                                updatedBbox.false_positive_types = bbox.false_positive_types.filter(
                                  t => t !== type
                                );
                                handleBboxChange(index, updatedBbox);
                              }}
                              className="ml-1 hover:opacity-80 text-red-600"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Status indicator */}
              <div className="flex items-center space-x-2">
                {shouldShowAsAnnotated(bbox, annotation?.processing_stage || '') ? (
                  <div className="flex items-center text-green-600">
                    <CheckCircle className="w-4 h-4 mr-1" />
                    <span className="text-sm font-medium">Annotated</span>
                  </div>
                ) : (
                  <div className="flex items-center text-gray-400">
                    <AlertCircle className="w-4 h-4 mr-1" />
                    <span className="text-sm font-medium">Needs annotation</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {/* Empty State */}
      {bboxes.length === 0 && (
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

      {/* Toast Notification */}
      {showToast && (
        <div className={`fixed top-4 right-4 z-50 transition-all duration-300 ease-in-out transform ${
          showToast ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
        }`}>
          <div className={`px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 min-w-80 ${
            toastType === 'success' ? 'bg-green-50 border border-green-200' :
            toastType === 'error' ? 'bg-red-50 border border-red-200' :
            'bg-blue-50 border border-blue-200'
          }`}>
            <div className={`flex-shrink-0 w-5 h-5 ${
              toastType === 'success' ? 'text-green-600' :
              toastType === 'error' ? 'text-red-600' :
              'text-blue-600'
            }`}>
              {toastType === 'success' && (
                <CheckCircle className="w-5 h-5" />
              )}
              {toastType === 'error' && (
                <AlertCircle className="w-5 h-5" />
              )}
              {toastType === 'info' && (
                <AlertCircle className="w-5 h-5" />
              )}
            </div>
            <p className={`text-sm font-medium ${
              toastType === 'success' ? 'text-green-800' :
              toastType === 'error' ? 'text-red-800' :
              'text-blue-800'
            }`}>
              {toastMessage}
            </p>
            <button
              onClick={() => setShowToast(false)}
              className={`flex-shrink-0 ml-auto pl-3 ${
                toastType === 'success' ? 'text-green-600 hover:text-green-800' :
                toastType === 'error' ? 'text-red-600 hover:text-red-800' :
                'text-blue-600 hover:text-blue-800'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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
                      <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">Escape</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">Reset annotation</span>
                      <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">Ctrl+Z</kbd>
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
                      <span className="text-sm text-gray-700">Toggle smoke detection</span>
                      <kbd className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">S</kbd>
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
                      <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">F</kbd>
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
                  <strong>Note:</strong> Detection-specific shortcuts (S and false positive types) only work when a detection is active (highlighted in blue). 
                  Global shortcuts (?, Escape, Ctrl+Z, Space, ↑/↓) work anywhere on the page. Arrow keys will activate and scroll to the previous/next detection.
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