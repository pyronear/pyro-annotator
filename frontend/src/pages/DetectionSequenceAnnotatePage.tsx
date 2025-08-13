import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Upload } from 'lucide-react';
import { useSequenceDetections } from '@/hooks/useSequenceDetections';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { Detection, DetectionAnnotation } from '@/types/api';

interface DetectionImageCardProps {
  detection: Detection;
  onClick: () => void;
  isAnnotated?: boolean;
}

function DetectionImageCard({ detection, onClick, isAnnotated = false }: DetectionImageCardProps) {
  const { data: imageData, isLoading } = useDetectionImage(detection.id);

  if (isLoading) {
    return (
      <div className="aspect-video bg-gray-200 animate-pulse rounded-lg">
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (!imageData?.url) {
    return (
      <div className="aspect-video bg-gray-100 border border-gray-200 rounded-lg flex items-center justify-center">
        <span className="text-gray-400 text-sm">No Image</span>
      </div>
    );
  }

  return (
    <div className="group cursor-pointer" onClick={onClick}>
      <div className={`aspect-video overflow-hidden rounded-lg border-2 transition-colors ${
        isAnnotated 
          ? 'border-green-500 hover:border-green-600' 
          : 'border-gray-200 hover:border-gray-300'
      }`}>
        <img
          src={imageData.url}
          alt={`Detection ${detection.id}`}
          className="w-full h-full object-contain bg-gray-50 group-hover:bg-gray-100 transition-colors"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const parent = target.parentElement;
            if (parent) {
              parent.innerHTML = '<span class="text-gray-400 text-sm flex items-center justify-center h-full">Error loading image</span>';
            }
          }}
        />
      </div>
      <div className="mt-2 text-sm text-gray-600">
        <div className="flex items-center justify-between">
          <p className="font-medium">Detection {detection.id}</p>
          {isAnnotated && <CheckCircle className="w-4 h-4 text-green-500" />}
        </div>
        <p className="text-xs text-gray-500">
          {new Date(detection.recorded_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

interface ImageModalProps {
  detection: Detection;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  canNavigatePrev: boolean;
  canNavigateNext: boolean;
  currentIndex: number;
  totalCount: number;
}

function ImageModal({ 
  detection, 
  onClose, 
  onNavigate, 
  canNavigatePrev, 
  canNavigateNext,
  currentIndex,
  totalCount
}: ImageModalProps) {
  const { data: imageData } = useDetectionImage(detection.id);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="relative w-full h-full flex items-center justify-center p-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors"
        >
          <X className="w-6 h-6 text-white" />
        </button>

        {/* Navigation buttons */}
        <button
          onClick={() => onNavigate('prev')}
          disabled={!canNavigatePrev}
          className={`absolute left-4 p-3 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors ${
            !canNavigatePrev ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>

        <button
          onClick={() => onNavigate('next')}
          disabled={!canNavigateNext}
          className={`absolute right-4 p-3 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors ${
            !canNavigateNext ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          <ChevronRight className="w-6 h-6 text-white" />
        </button>

        {/* Image container */}
        <div className="max-w-7xl max-h-full flex flex-col items-center">
          {imageData?.url ? (
            <img
              src={imageData.url}
              alt={`Detection ${detection.id}`}
              className="max-w-full max-h-[80vh] object-contain"
            />
          ) : (
            <div className="w-96 h-96 bg-gray-800 flex items-center justify-center rounded-lg">
              <span className="text-gray-400">No image available</span>
            </div>
          )}

          {/* Detection info */}
          <div className="mt-4 bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 text-white">
            <div className="flex items-center space-x-4">
              <span className="font-medium">Detection {currentIndex + 1} of {totalCount}</span>
              <span className="text-gray-300">•</span>
              <span className="text-gray-300">ID: {detection.id}</span>
              <span className="text-gray-300">•</span>
              <span className="text-gray-300">
                {new Date(detection.recorded_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DetectionSequenceAnnotatePage() {
  const { sequenceId } = useParams<{ sequenceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sequenceIdNum = sequenceId ? parseInt(sequenceId, 10) : null;

  const [selectedDetectionIndex, setSelectedDetectionIndex] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [detectionAnnotations, setDetectionAnnotations] = useState<Map<number, DetectionAnnotation>>(new Map());
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const { data: detections, isLoading, error } = useSequenceDetections(sequenceIdNum);
  
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
      const response = await apiClient.getSequenceAnnotations({ sequence_id: sequenceIdNum!, size: 1 });
      return response.items[0] || null;
    },
    enabled: !!sequenceIdNum,
  });

  const sequenceAnnotation = sequenceAnnotationResponse;

  // Fetch total sequence count for navigation context
  const { data: sequencesData } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'detection-annotate-count'],
    queryFn: () => apiClient.getSequences({
      detection_annotation_completion: 'incomplete',
      include_detection_stats: true,
      size: 1,
    }),
  });

  // Fetch existing detection annotations for this sequence
  const { data: existingAnnotations } = useQuery({
    queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS, 'by-sequence', sequenceIdNum],
    queryFn: async () => {
      const response = await apiClient.getDetectionAnnotations({ 
        sequence_id: sequenceIdNum!,
        size: 100
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
      
      // Create or update annotations for all detections
      const promises = detections.map(async (detection) => {
        const existingAnnotation = detectionAnnotations.get(detection.id);
        
        if (existingAnnotation) {
          // Update existing annotation to 'annotated' stage
          if (existingAnnotation.processing_stage !== 'annotated') {
            return apiClient.updateDetectionAnnotation(existingAnnotation.id, {
              processing_stage: 'annotated',
            });
          }
        } else {
          // Create new annotation with 'annotated' stage
          return apiClient.createDetectionAnnotation({
            detection_id: detection.id,
            annotation: {
              annotation: [] // Empty annotation array matching backend schema
            } as any,
            processing_stage: 'annotated',
            created_at: new Date().toISOString(),
          });
        }
      });
      
      return Promise.all(promises.filter(Boolean));
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS] });
      setToastMessage('Detection annotations saved successfully');
      setShowToast(true);
      
      // Navigate back after a short delay
      setTimeout(() => {
        navigate('/detections/annotate');
      }, 1500);
    },
    onError: () => {
      setToastMessage('Failed to save annotations');
      setShowToast(true);
    },
  });

  const handleBack = () => {
    navigate('/detections/annotate');
  };

  const handleSave = () => {
    saveAnnotations.mutate();
  };

  const openModal = (index: number) => {
    setSelectedDetectionIndex(index);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedDetectionIndex(null);
  };

  const navigateModal = (direction: 'prev' | 'next') => {
    if (!detections || selectedDetectionIndex === null) return;
    
    const newIndex = direction === 'prev' 
      ? Math.max(0, selectedDetectionIndex - 1)
      : Math.min(detections.length - 1, selectedDetectionIndex + 1);
    
    setSelectedDetectionIndex(newIndex);
  };

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Submit with Enter key
      if (e.key === 'Enter' && !showModal) {
        handleSave();
        e.preventDefault();
        return;
      }

      // Modal navigation
      if (showModal) {
        if (e.key === 'Escape') {
          closeModal();
          e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
          navigateModal('prev');
          e.preventDefault();
        } else if (e.key === 'ArrowRight') {
          navigateModal('next');
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, selectedDetectionIndex, detections]);

  // Toast auto-dismiss
  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showToast]);

  // Calculate progress
  const annotatedCount = Array.from(detectionAnnotations.values()).filter(
    a => a.processing_stage === 'annotated'
  ).length;
  const totalCount = detections?.length || 0;
  const completionPercentage = totalCount > 0 ? Math.round((annotatedCount / totalCount) * 100) : 0;

  // Helper to get annotation pills
  const getAnnotationPills = () => {
    if (!sequenceAnnotation) return null;
    
    const pills = [];
    
    if (sequenceAnnotation.has_smoke) {
      pills.push(
        <span key="smoke" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          Smoke
        </span>
      );
    }
    
    if (sequenceAnnotation.has_missed_smoke) {
      pills.push(
        <span key="missed" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
          Missed Smoke
        </span>
      );
    }
    
    if (sequenceAnnotation.has_false_positives) {
      pills.push(
        <span key="false-positive" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          False Positive
        </span>
      );
    }
    
    if (!sequenceAnnotation.has_smoke && !sequenceAnnotation.has_missed_smoke && !sequenceAnnotation.has_false_positives) {
      pills.push(
        <span key="no-smoke" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
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
      <div className={`fixed top-0 left-0 md:left-64 right-0 backdrop-blur-sm shadow-sm z-30 ${
        isAllAnnotated 
          ? 'bg-green-50/90 border-b border-green-200 border-l-4 border-l-green-500' 
          : 'bg-white/85 border-b border-gray-200'
      }`}>
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
                
                {/* Sequence context */}
                {sequencesData && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-blue-600 font-medium">
                      Sequence {sequenceId} of {sequencesData.total}
                    </span>
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
              <button
                onClick={handleSave}
                disabled={saveAnnotations.isPending}
                className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Submit annotations (Enter)"
              >
                {saveAnnotations.isPending ? (
                  <div className="w-3 h-3 mr-1 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Upload className="w-3 h-3 mr-1" />
                )}
                Submit
              </button>
            </div>
          </div>

          {/* Bottom Row: Progress + Annotation Pills */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center space-x-4">
              <span className="text-xs font-medium text-gray-900">
                Review: {isAllAnnotated ? (
                  <span className="text-green-600">Done</span>
                ) : (
                  <span className="text-orange-600">Pending</span>
                )} • {annotatedCount} of {totalCount} detections • {completionPercentage}% complete
              </span>
              
              {/* Annotation pills */}
              <div className="flex items-center space-x-2">
                {getAnnotationPills()}
              </div>
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

      {/* Content with top padding to account for fixed header */}
      <div className="space-y-6 pt-20">
        {/* Detection Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {detections.map((detection, index) => (
            <DetectionImageCard 
              key={detection.id} 
              detection={detection}
              onClick={() => openModal(index)}
              isAnnotated={detectionAnnotations.get(detection.id)?.processing_stage === 'annotated'}
            />
          ))}
        </div>
      </div>

      {/* Image Modal */}
      {showModal && selectedDetectionIndex !== null && detections[selectedDetectionIndex] && (
        <ImageModal
          detection={detections[selectedDetectionIndex]}
          onClose={closeModal}
          onNavigate={navigateModal}
          canNavigatePrev={selectedDetectionIndex > 0}
          canNavigateNext={selectedDetectionIndex < detections.length - 1}
          currentIndex={selectedDetectionIndex}
          totalCount={detections.length}
        />
      )}

      {/* Toast Notification */}
      {showToast && (
        <div className={`fixed top-24 right-4 z-50 transition-all duration-300 ease-in-out transform ${
          showToast ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
        }`}>
          <div className="px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 min-w-80 bg-green-50 border border-green-200">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">{toastMessage}</span>
          </div>
        </div>
      )}
    </>
  );
}