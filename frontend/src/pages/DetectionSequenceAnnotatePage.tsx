import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSequenceDetections } from '@/hooks/useSequenceDetections';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { Detection } from '@/types/api';

interface DetectionImageCardProps {
  detection: Detection;
}

function DetectionImageCard({ detection }: DetectionImageCardProps) {
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
    <div className="group cursor-pointer">
      <div className="aspect-video overflow-hidden rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
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
        <p className="font-medium">Detection {detection.id}</p>
        <p className="text-xs text-gray-500">
          {new Date(detection.recorded_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

export default function DetectionSequenceAnnotatePage() {
  const { sequenceId } = useParams<{ sequenceId: string }>();
  const navigate = useNavigate();
  const sequenceIdNum = sequenceId ? parseInt(sequenceId, 10) : null;

  const { data: detections, isLoading, error } = useSequenceDetections(sequenceIdNum);

  const handleBack = () => {
    navigate('/detections/annotate');
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
          <p className="text-gray-600">
            Sequence {sequenceId} • {detections.length} detection{detections.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Detection Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {detections.map((detection) => (
          <DetectionImageCard key={detection.id} detection={detection} />
        ))}
      </div>
    </div>
  );
}