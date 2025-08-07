import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/services/api';
import { SequenceAnnotation, SequenceBbox, GifUrlsResponse } from '@/types/api';
import { QUERY_KEYS } from '@/utils/constants';
import { useAnnotationStore } from '@/store/useAnnotationStore';

export default function AnnotationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const sequenceId = id ? Number(id) : null;
  
  const {
    missedSmoke,
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
    queryFn: () => apiClient.getSequenceAnnotations({ sequence_id: sequenceId! }),
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
    onSuccess: (response: GifUrlsResponse) => {
      // Extract URLs from the first bbox if available
      if (response.gif_urls && response.gif_urls.length > 0) {
        setGifUrls({
          main_gif_url: response.gif_urls[0].main_url,
          crop_gif_url: response.gif_urls[0].crop_url
        });
      }
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


  const handleCompleteSequence = () => {
    navigate('/sequences');
    resetCurrentWork();
  };

  const handleBboxUpdate = (bboxIndex: number, updatedBbox: SequenceBbox) => {
    if (!currentAnnotation) return;

    // Update the specific bbox
    const updatedSequencesBbox = [...currentAnnotation.annotation.sequences_bbox];
    updatedSequencesBbox[bboxIndex] = updatedBbox;

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

    // Update the annotation
    updateAnnotationMutation.mutate({
      id: currentAnnotation.id,
      data: updatedAnnotation
    });

    // Update local state
    setCurrentAnnotation({
      ...currentAnnotation,
      ...updatedAnnotation,
      annotation: {
        sequences_bbox: updatedSequencesBbox
      }
    } as SequenceAnnotation);
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

  const totalBboxes = currentAnnotation?.annotation.sequences_bbox.length || 0;

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
            {totalBboxes} detection{totalBboxes !== 1 ? 's' : ''} to annotate
          </div>
        )}
      </div>


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
        <div className="space-y-6">
          {/* GIF Display */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Sequence GIFs
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Main GIF */}
              {gifUrls.main_gif_url && (
                <div className="text-center">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Full Sequence</h4>
                  <img
                    src={gifUrls.main_gif_url}
                    alt="Main sequence GIF"
                    className="max-w-full h-auto border border-gray-300 rounded shadow-sm mx-auto"
                    style={{ maxHeight: '500px' }}
                  />
                </div>
              )}
              
              {/* Crop GIF */}
              {gifUrls.crop_gif_url && (
                <div className="text-center">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Cropped View</h4>
                  <img
                    src={gifUrls.crop_gif_url}
                    alt="Cropped sequence GIF"
                    className="max-w-full h-auto border border-gray-300 rounded shadow-sm mx-auto"
                    style={{ maxHeight: '500px' }}
                  />
                </div>
              )}
              
              {/* Loading/Error States */}
              {!gifUrls.main_gif_url && !gifUrls.crop_gif_url && (
                <div className="col-span-2 text-center py-8">
                  <div className="text-gray-500">
                    {generateGifsMutation.isPending ? (
                      <div className="flex items-center justify-center space-x-2">
                        <div className="animate-spin w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full"></div>
                        <span>Generating GIFs...</span>
                      </div>
                    ) : (
                      <span>No GIFs available</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Annotation Controls */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                Sequence Annotations
              </h3>
              <button
                onClick={handleCompleteSequence}
                className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Complete Sequence
              </button>
            </div>
            
            <div className="text-sm text-gray-600 mb-6">
              Annotate each detection below. All annotations will be saved automatically.
            </div>
            
            {/* Vertical BBox List */}
            <div className="space-y-4">
              {currentAnnotation?.annotation.sequences_bbox.map((bbox, index) => (
                <div key={index} className="bg-gray-50 rounded-lg border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-medium text-gray-900">
                      Detection {index + 1}
                    </h4>
                    <span className="text-sm text-gray-500">
                      {bbox.bboxes.length} detection{bbox.bboxes.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  
                  {/* Individual GIFs for this bbox */}
                  {bbox.gif_key_main || bbox.gif_key_crop ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      {bbox.gif_key_main && (
                        <div className="text-center">
                          <h5 className="text-sm font-medium text-gray-600 mb-2">Main GIF</h5>
                          <img
                            src={`/api/gifs/${bbox.gif_key_main}`}
                            alt={`Main GIF for detection ${index + 1}`}
                            className="max-w-full h-auto border border-gray-300 rounded shadow-sm mx-auto"
                            style={{ maxHeight: '300px' }}
                          />
                        </div>
                      )}
                      {bbox.gif_key_crop && (
                        <div className="text-center">
                          <h5 className="text-sm font-medium text-gray-600 mb-2">Crop GIF</h5>
                          <img
                            src={`/api/gifs/${bbox.gif_key_crop}`}
                            alt={`Crop GIF for detection ${index + 1}`}
                            className="max-w-full h-auto border border-gray-300 rounded shadow-sm mx-auto"
                            style={{ maxHeight: '300px' }}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-gray-500 mb-6">
                      <div className="text-sm">GIFs not available for this detection</div>
                    </div>
                  )}
                  
                  {/* Annotation Interface for this bbox */}
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
                            handleBboxUpdate(index, updatedBbox);
                          }}
                          className="w-4 h-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                        />
                        <span className="text-sm font-medium text-gray-900">
                          🔥 Contains Smoke/Fire
                        </span>
                      </label>
                    </div>

                    {/* False Positive Types - Simple implementation for now */}
                    {!bbox.is_smoke && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          False Positive Types
                        </label>
                        <div className="text-xs text-gray-500">
                          TODO: Add false positive type selection interface
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {/* Status Messages */}
              {updateAnnotationMutation.isPending && (
                <div className="text-center py-4">
                  <div className="flex items-center justify-center text-sm text-blue-600">
                    <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2"></div>
                    Saving annotation...
                  </div>
                </div>
              )}

              {updateAnnotationMutation.isSuccess && (
                <div className="text-center py-4">
                  <div className="flex items-center justify-center text-sm text-green-600">
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Annotation saved successfully
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}