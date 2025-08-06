import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Calendar, Camera, AlertTriangle, Play } from 'lucide-react';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import { useSequenceDetections } from '@/hooks/useDetectionImage';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';

export default function SequenceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [selectedDetection, setSelectedDetection] = useState<number | null>(null);
  
  const sequenceId = id ? parseInt(id) : null;

  const { data: sequence, isLoading, error } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(sequenceId!),
    queryFn: () => apiClient.getSequence(sequenceId!),
    enabled: !!sequenceId,
  });

  const { data: detectionsResponse, isLoading: loadingDetections } = useSequenceDetections(sequenceId!);
  const detections = detectionsResponse?.items || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !sequence) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load sequence</p>
          <p className="text-gray-500 text-sm">{String(error)}</p>
          <button 
            onClick={() => navigate('/sequences')}
            className="mt-4 text-primary-600 hover:text-primary-900"
          >
            Back to Sequences
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => navigate('/sequences')}
          className="p-2 rounded-md hover:bg-gray-100"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {sequence.camera_name}
          </h1>
          <p className="text-gray-600">
            Sequence Details - Camera ID: {sequence.camera_id}
          </p>
        </div>
      </div>

      {/* Sequence Information */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h2 className="text-lg font-medium text-gray-900">Basic Information</h2>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Camera className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">Camera:</span>
                <span className="text-sm font-medium">{sequence.camera_name} (ID: {sequence.camera_id})</span>
              </div>
              
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">Organization:</span>
                <span className="text-sm font-medium">{sequence.organisation_name}</span>
              </div>
              
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">Recorded:</span>
                <span className="text-sm font-medium">
                  {new Date(sequence.recorded_at).toLocaleString()}
                </span>
              </div>
              
              <div className="flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">Location:</span>
                <span className="text-sm font-medium">
                  {sequence.lat.toFixed(6)}, {sequence.lon.toFixed(6)}
                </span>
              </div>
              
              {sequence.azimuth && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Azimuth:</span>
                  <span className="text-sm font-medium">{sequence.azimuth}°</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="space-y-4">
            <h2 className="text-lg font-medium text-gray-900">Alert Information</h2>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">Source API:</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {sequence.source_api}
                </span>
              </div>
              
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">Alert ID:</span>
                <span className="text-sm font-medium">{sequence.alert_api_id}</span>
              </div>
              
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">Wildfire Alert:</span>
                {sequence.is_wildfire_alertapi ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    🔥 Yes
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    No Alert
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detections */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Detections</h2>
          <p className="text-sm text-gray-600">
            {detections.length} detection{detections.length !== 1 ? 's' : ''} in this sequence
          </p>
        </div>
        
        {loadingDetections ? (
          <div className="p-8 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
          </div>
        ) : detections.length > 0 ? (
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {detections.map((detection) => (
                <div
                  key={detection.id}
                  className={`border rounded-lg overflow-hidden cursor-pointer transition-all ${
                    selectedDetection === detection.id 
                      ? 'border-primary-500 shadow-md' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedDetection(detection.id)}
                >
                  <DetectionImageThumbnail 
                    sequenceId={sequence.id} 
                    className="w-full h-24"
                  />
                  <div className="p-2">
                    <p className="text-xs text-gray-600 truncate">
                      Detection {detection.id}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(detection.recorded_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <p>No detections found for this sequence</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Actions</h2>
          <div className="flex space-x-3">
            <button 
              onClick={() => navigate(`/sequences/${sequence.id}/annotate`)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700"
            >
              <Play className="w-4 h-4 mr-2" />
              Start Annotation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}