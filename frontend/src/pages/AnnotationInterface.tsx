import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, RotateCcw, CheckCircle } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS, SMOKE_TYPES, FALSE_POSITIVE_TYPES } from '@/utils/constants';
import { SmokeType, FalsePositiveType, SequenceAnnotation } from '@/types/api';
import { useSequenceDetections, useDetectionImage } from '@/hooks/useDetectionImage';

export default function AnnotationInterface() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const sequenceId = id ? parseInt(id) : null;
  
  const [selectedType, setSelectedType] = useState<'smoke' | 'false_positive' | null>(null);
  const [smokeType, setSmokeType] = useState<SmokeType>('wildfire');
  const [falsePositiveType, setFalsePositiveType] = useState<FalsePositiveType>('other');
  const [notes, setNotes] = useState('');
  const [currentAnnotation, setCurrentAnnotation] = useState<SequenceAnnotation | null>(null);

  // Fetch sequence data
  const { data: sequence } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(sequenceId!),
    queryFn: () => apiClient.getSequence(sequenceId!),
    enabled: !!sequenceId,
  });

  // Fetch existing annotation
  const { data: annotations } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, { sequence_id: sequenceId }],
    queryFn: () => apiClient.getSequenceAnnotations({ sequence_id: sequenceId! }),
    enabled: !!sequenceId,
  });

  // Fetch detections for preview
  const { data: detectionsResponse } = useSequenceDetections(sequenceId!);
  const firstDetection = detectionsResponse?.items[0];
  const { data: imageData } = useDetectionImage(firstDetection?.id || null);

  // Set existing annotation data
  useEffect(() => {
    if (annotations?.items && annotations.items.length > 0) {
      const annotation = annotations.items[0];
      setCurrentAnnotation(annotation);
      setNotes(annotation.notes || '');
      
      if (annotation.smoke_type) {
        setSelectedType('smoke');
        setSmokeType(annotation.smoke_type);
      } else if (annotation.false_positive_type) {
        setSelectedType('false_positive');
        setFalsePositiveType(annotation.false_positive_type);
      }
    }
  }, [annotations]);

  // Save annotation mutation
  const saveAnnotation = useMutation({
    mutationFn: async (data: { smoke_type?: SmokeType; false_positive_type?: FalsePositiveType; notes: string }) => {
      const annotationData = {
        sequence_id: sequenceId!,
        ...data,
        smoke_type: selectedType === 'smoke' ? data.smoke_type : undefined,
        false_positive_type: selectedType === 'false_positive' ? data.false_positive_type : undefined,
      };

      if (currentAnnotation) {
        return apiClient.updateSequenceAnnotation(currentAnnotation.id, annotationData);
      } else {
        return apiClient.createSequenceAnnotation(annotationData);
      }
    },
    onSuccess: () => {
      // Refresh annotations
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SEQUENCE_ANNOTATIONS });
      // Navigate back to sequence detail
      navigate(`/sequences/${sequenceId}`);
    },
  });

  const handleSave = () => {
    if (!selectedType) return;
    
    saveAnnotation.mutate({
      smoke_type: selectedType === 'smoke' ? smokeType : undefined,
      false_positive_type: selectedType === 'false_positive' ? falsePositiveType : undefined,
      notes,
    });
  };

  const handleReset = () => {
    setSelectedType(null);
    setSmokeType('wildfire');
    setFalsePositiveType('other');
    setNotes('');
  };

  if (!sequence) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate(`/sequences/${sequenceId}`)}
            className="p-2 rounded-md hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Annotate Sequence
            </h1>
            <p className="text-gray-600">
              {sequence.camera_name} - {new Date(sequence.recorded_at).toLocaleDateString()}
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
            disabled={!selectedType || saveAnnotation.isPending}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveAnnotation.isPending ? (
              <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {currentAnnotation ? 'Update' : 'Save'} Annotation
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Image Preview */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Detection Preview</h2>
          {imageData?.image_url ? (
            <div className="w-full h-64 bg-gray-100 rounded-lg overflow-hidden">
              <img
                src={imageData.image_url}
                alt="Detection"
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
              <span className="text-gray-400">No image available</span>
            </div>
          )}
        </div>

        {/* Annotation Form */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Annotation</h2>
          
          <div className="space-y-4">
            {/* Classification Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Classification Type
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="type"
                    value="smoke"
                    checked={selectedType === 'smoke'}
                    onChange={(e) => setSelectedType(e.target.value as 'smoke')}
                    className="focus:ring-primary-500 h-4 w-4 text-primary-600 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-900">Smoke Detection</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="type"
                    value="false_positive"
                    checked={selectedType === 'false_positive'}
                    onChange={(e) => setSelectedType(e.target.value as 'false_positive')}
                    className="focus:ring-primary-500 h-4 w-4 text-primary-600 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-900">False Positive</span>
                </label>
              </div>
            </div>

            {/* Smoke Type Selection */}
            {selectedType === 'smoke' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Smoke Type
                </label>
                <select
                  value={smokeType}
                  onChange={(e) => setSmokeType(e.target.value as SmokeType)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  {SMOKE_TYPES.map(type => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* False Positive Type Selection */}
            {selectedType === 'false_positive' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  False Positive Type
                </label>
                <select
                  value={falsePositiveType}
                  onChange={(e) => setFalsePositiveType(e.target.value as FalsePositiveType)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  {FALSE_POSITIVE_TYPES.map(type => (
                    <option key={type} value={type}>
                      {type.replace('_', ' ').charAt(0).toUpperCase() + type.replace('_', ' ').slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Add any additional notes about this sequence..."
              />
            </div>

            {/* Current Status */}
            {currentAnnotation && (
              <div className="bg-green-50 border border-green-200 rounded-md p-3">
                <div className="flex">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-green-800">
                      This sequence is already annotated
                    </p>
                    <p className="text-sm text-green-700 mt-1">
                      Last updated: {new Date(currentAnnotation.updated_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}