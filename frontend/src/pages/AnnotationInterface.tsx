import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, RotateCcw, CheckCircle, AlertCircle, Eye } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { SequenceAnnotation, SequenceBbox } from '@/types/api';
import { useGifUrls } from '@/hooks/useGifUrls';
import SequenceBboxCard from '@/components/annotation/SequenceBboxCard';

export default function AnnotationInterface() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const annotationId = id ? parseInt(id) : null;
  
  const [bboxes, setBboxes] = useState<SequenceBbox[]>([]);
  const [, setCurrentAnnotation] = useState<SequenceAnnotation | null>(null);

  // Fetch sequence annotation
  const { data: annotation, isLoading, error } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE_ANNOTATION(annotationId!),
    queryFn: () => apiClient.getSequenceAnnotation(annotationId!),
    enabled: !!annotationId,
  });

  // Fetch sequence data for header info
  const { data: sequence } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(annotation?.sequence_id!),
    queryFn: () => apiClient.getSequence(annotation?.sequence_id!),
    enabled: !!annotation?.sequence_id,
  });

  // Fetch GIF URLs
  const { data: gifUrls, isLoading: loadingGifs } = useGifUrls(annotationId);

  // Initialize bboxes when annotation loads
  useEffect(() => {
    if (annotation) {
      setCurrentAnnotation(annotation);
      setBboxes([...annotation.annotation.sequences_bbox]);
    }
  }, [annotation]);

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
      };

      return apiClient.updateSequenceAnnotation(annotationId!, updatedAnnotation);
    },
    onSuccess: () => {
      // Refresh annotations and sequences
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCES });
      // Navigate back to sequence detail
      navigate(`/sequences/${annotation?.sequence_id}`);
    },
  });

  const handleBboxChange = (index: number, updatedBbox: SequenceBbox) => {
    const newBboxes = [...bboxes];
    newBboxes[index] = updatedBbox;
    setBboxes(newBboxes);
  };

  const handleSave = () => {
    if (!isAnnotationComplete()) return;
    saveAnnotation.mutate(bboxes);
  };

  const handleReset = () => {
    if (annotation) {
      setBboxes([...annotation.annotation.sequences_bbox]);
    }
  };

  const isAnnotationComplete = () => {
    return bboxes.every(bbox => 
      bbox.is_smoke || bbox.false_positive_types.length > 0
    );
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate(`/sequences/${annotation.sequence_id}`)}
            className="p-2 rounded-md hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Annotate Sequence Bboxes
            </h1>
            <p className="text-gray-600">
              {sequence?.camera_name || 'Loading...'} - Annotation #{annotation.id}
            </p>
          </div>
        </div>
        
        <div className="flex space-x-3">
          <button
            onClick={handleReset}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!isAnnotationComplete() || saveAnnotation.isPending}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveAnnotation.isPending ? (
              <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Complete Annotation
          </button>
        </div>
      </div>

      {/* Progress Overview */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Annotation Progress</h2>
            <p className="text-sm text-gray-600">
              {progress.completed} of {progress.total} bounding boxes annotated
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {progress.completed === progress.total ? (
              <CheckCircle className="w-6 h-6 text-green-500" />
            ) : (
              <AlertCircle className="w-6 h-6 text-orange-500" />
            )}
            <span className="text-sm font-medium">
              {Math.round((progress.completed / progress.total) * 100)}%
            </span>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
          <div 
            className="bg-primary-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(progress.completed / progress.total) * 100}%` }}
          ></div>
        </div>
      </div>

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

      {/* Bbox Annotation Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {bboxes.map((bbox, index) => (
          <SequenceBboxCard
            key={index}
            bbox={bbox}
            bboxIndex={index}
            gifData={gifUrls?.gif_urls[index]}
            onChange={(updatedBbox) => handleBboxChange(index, updatedBbox)}
          />
        ))}
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
    </div>
  );
}