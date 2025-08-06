import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Save, Skip, CheckCircle, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/services/api';
import { SequenceAnnotation, SequenceAnnotationData, SequenceBbox } from '@/types/api';
import { QUERY_KEYS, ANNOTATION_LABELS, AnnotationLabel } from '@/utils/constants';
import { useAnnotationStore } from '@/store/useAnnotationStore';
import GifViewer from '@/components/media/GifViewer';
import LabelSelector from '@/components/annotation/LabelSelector';

export default function AnnotationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const sequenceId = id ? Number(id) : null;
  
  const {
    currentBboxIndex,
    selectedLabels,
    missedSmoke,
    setSelectedLabels,
    setMissedSmoke,
    nextBbox,
    previousBbox,
    resetCurrentWork
  } = useAnnotationStore();

  const [currentAnnotation, setCurrentAnnotation] = useState<SequenceAnnotation | null>(null);
  const [gifUrls, setGifUrls] = useState<{ main_gif_url?: string; crop_gif_url?: string }>({});

  // Get sequence data
  const { data: sequence, isLoading: loadingSequence, error: sequenceError } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(sequenceId!),
    queryFn: () => apiClient.getSequence(sequenceId!),
    enabled: !!sequenceId,
  });

  // Get existing annotations for this sequence
  const { data: annotations, isLoading: loadingAnnotations } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, { sequence_id: sequenceId }],
    queryFn: () => apiClient.getSequenceAnnotations({ sequence_id: sequenceId }),
    enabled: !!sequenceId,
  });

  // Create annotation mutation
  const createAnnotationMutation = useMutation({
    mutationFn: (annotationData: Omit<SequenceAnnotation, 'id' | 'created_at' | 'updated_at'>) =>
      apiClient.createSequenceAnnotation(annotationData),
    onSuccess: (newAnnotation) => {
      setCurrentAnnotation(newAnnotation);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
      // Generate GIFs after creating annotation
      generateGifsMutation.mutate(newAnnotation.id);
    },
  });

  // Update annotation mutation
  const updateAnnotationMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SequenceAnnotation> }) =>
      apiClient.updateSequenceAnnotation(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
    },
  });

  // Generate GIFs mutation
  const generateGifsMutation = useMutation({
    mutationFn: (annotationId: number) => apiClient.generateGifs(annotationId),
    onSuccess: (_, annotationId) => {
      // After generating GIFs, get the URLs
      getGifUrlsMutation.mutate(annotationId);
    },
  });

  // Get GIF URLs mutation
  const getGifUrlsMutation = useMutation({
    mutationFn: (annotationId: number) => apiClient.getGifUrls(annotationId),
    onSuccess: (urls) => {
      setGifUrls(urls);
    },
  });

  // Initialize annotation if none exists
  useEffect(() => {
    if (annotations?.items.length === 0 && sequenceId && !createAnnotationMutation.isPending) {
      // Create initial annotation with empty structure
      const initialAnnotation: Omit<SequenceAnnotation, 'id' | 'created_at' | 'updated_at'> = {
        sequence_id: sequenceId,
        has_smoke: false,
        has_false_positives: false,
        false_positive_types: '',
        has_missed_smoke: false,
        annotation: {
          sequences_bbox: []
        },
        processing_stage: 'ready_to_annotate',
      };
      
      createAnnotationMutation.mutate(initialAnnotation);
    } else if (annotations?.items.length === 1) {
      setCurrentAnnotation(annotations.items[0]);
      // Get GIF URLs if they exist
      getGifUrlsMutation.mutate(annotations.items[0].id);
    }
  }, [annotations, sequenceId]);

  const getCurrentBbox = (): SequenceBbox | null => {
    if (!currentAnnotation || currentBboxIndex >= currentAnnotation.annotation.sequences_bbox.length) {
      return null;
    }
    return currentAnnotation.annotation.sequences_bbox[currentBboxIndex];
  };

  const handleSaveAnnotation = () => {
    if (!currentAnnotation) return;

    const currentBbox = getCurrentBbox();
    if (!currentBbox) return;

    // Convert selected labels to false positive types
    const falsePositiveTypes = selectedLabels.filter(label => label !== 'Smoke');
    const isSmoke = selectedLabels.includes('Smoke');

    // Update the current bbox
    const updatedBbox: SequenceBbox = {
      ...currentBbox,
      is_smoke: isSmoke,
      false_positive_types: falsePositiveTypes as any[],
    };

    // Update annotation data
    const updatedSequencesBbox = [...currentAnnotation.annotation.sequences_bbox];
    updatedSequencesBbox[currentBboxIndex] = updatedBbox;

    // Calculate derived fields
    const has_smoke = updatedSequencesBbox.some(bbox => bbox.is_smoke) || missedSmoke;
    const has_false_positives = updatedSequencesBbox.some(bbox => bbox.false_positive_types.length > 0);
    const all_false_positive_types = Array.from(
      new Set(updatedSequencesBbox.flatMap(bbox => bbox.false_positive_types))
    );

    const updatedAnnotation: Partial<SequenceAnnotation> = {
      annotation: {
        sequences_bbox: updatedSequencesBbox
      },
      has_smoke,
      has_false_positives,
      has_missed_smoke: missedSmoke,
      false_positive_types: JSON.stringify(all_false_positive_types),
      processing_stage: 'annotated',
    };

    updateAnnotationMutation.mutate({
      id: currentAnnotation.id,
      data: updatedAnnotation
    });

    // Move to next bbox
    nextBbox();
    setSelectedLabels([]);
  };

  const handleSkipBbox = () => {
    nextBbox();
    setSelectedLabels([]);
  };

  const handlePreviousBbox = () => {
    previousBbox();
    setSelectedLabels([]);
  };

  const handleCompleteSequence = () => {
    navigate('/sequences');
    resetCurrentWork();
  };

  if (loadingSequence || loadingAnnotations) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (sequenceError || !sequence) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load sequence</p>
          <button
            onClick={() => navigate('/sequences')}
            className="text-primary-600 hover:text-primary-700"
          >
            Back to Sequences
          </button>
        </div>
      </div>
    );
  }

  const currentBbox = getCurrentBbox();
  const totalBboxes = currentAnnotation?.annotation.sequences_bbox.length || 0;
  const isLastBbox = currentBboxIndex >= totalBboxes - 1;
  const isComplete = selectedLabels.length > 0 || missedSmoke;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/sequences')}
            className="flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Sequences
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Annotate Sequence
            </h1>
            <p className="text-gray-600">
              {sequence.camera_name} • {new Date(sequence.recorded_at).toLocaleString()}
            </p>
          </div>
        </div>
        
        {totalBboxes > 0 && (
          <div className="text-sm text-gray-600">
            Detection {currentBboxIndex + 1} of {totalBboxes}
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {totalBboxes > 0 && (
        <div className="bg-gray-200 rounded-full h-2">
          <div
            className="bg-primary-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentBboxIndex + 1) / totalBboxes) * 100}%` }}
          ></div>
        </div>
      )}

      {/* Main Content */}
      {totalBboxes === 0 ? (
        <div className="text-center py-12">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Detections Found</h3>
          <p className="text-gray-600 mb-4">
            This sequence has no bounding boxes to annotate.
          </p>
          <button
            onClick={handleCompleteSequence}
            className="btn-primary"
          >
            Return to Sequences
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* GIF Viewer */}
          <div>
            <GifViewer
              mainGifUrl={gifUrls.main_gif_url}
              cropGifUrl={gifUrls.crop_gif_url}
              title={`Detection ${currentBboxIndex + 1}`}
              className="h-96"
            />
            
            {/* Navigation Controls */}
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={handlePreviousBbox}
                disabled={currentBboxIndex === 0}
                className="flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Previous
              </button>
              
              <div className="text-sm text-gray-600">
                {currentBbox && (
                  <span>
                    Bbox: [{currentBbox.bboxes.map(b => 
                      b.xyxyn.map(coord => coord.toFixed(3)).join(', ')
                    ).join(' | ')}]
                  </span>
                )}
              </div>
              
              <button
                onClick={() => isLastBbox ? handleCompleteSequence() : handleSkipBbox()}
                className="flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
              >
                {isLastBbox ? 'Complete' : 'Skip'}
                {!isLastBbox && <ArrowRight className="w-4 h-4 ml-2" />}
              </button>
            </div>
          </div>

          {/* Annotation Panel */}
          <div className="space-y-6">
            <LabelSelector
              selectedLabels={selectedLabels}
              onLabelsChange={setSelectedLabels}
              showMissedSmoke={true}
              missedSmoke={missedSmoke}
              onMissedSmokeChange={setMissedSmoke}
              required={true}
            />

            {/* Action Buttons */}
            <div className="flex items-center space-x-4">
              <button
                onClick={handleSaveAnnotation}
                disabled={!isComplete}
                className={`flex items-center px-6 py-3 rounded-md text-sm font-medium transition-colors ${
                  isComplete
                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <Save className="w-4 h-4 mr-2" />
                {isLastBbox ? 'Save & Complete' : 'Save & Next'}
              </button>

              <button
                onClick={handleSkipBbox}
                className="flex items-center px-6 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Skip className="w-4 h-4 mr-2" />
                Skip This Detection
              </button>
            </div>

            {/* Status */}
            {updateAnnotationMutation.isPending && (
              <div className="flex items-center text-sm text-blue-600">
                <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2"></div>
                Saving annotation...
              </div>
            )}

            {updateAnnotationMutation.isSuccess && (
              <div className="flex items-center text-sm text-green-600">
                <CheckCircle className="w-4 h-4 mr-2" />
                Annotation saved successfully
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}