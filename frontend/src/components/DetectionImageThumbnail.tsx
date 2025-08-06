import { useSequenceDetections, useDetectionImage } from '@/hooks/useDetectionImage';

interface DetectionImageThumbnailProps {
  sequenceId: number;
  className?: string;
}

export default function DetectionImageThumbnail({ sequenceId, className = '' }: DetectionImageThumbnailProps) {
  const { data: detectionsResponse, isLoading: loadingDetections } = useSequenceDetections(sequenceId);
  const firstDetection = detectionsResponse?.items[0];
  
  const { data: imageData, isLoading: loadingImage } = useDetectionImage(
    firstDetection?.id || null
  );

  if (loadingDetections || loadingImage) {
    return (
      <div className={`bg-gray-200 animate-pulse rounded ${className}`}>
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (!imageData?.image_url) {
    return (
      <div className={`bg-gray-100 border border-gray-200 rounded flex items-center justify-center ${className}`}>
        <span className="text-gray-400 text-xs">No Image</span>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded border border-gray-200 ${className}`}>
      <img
        src={imageData.image_url}
        alt="Detection preview"
        className="w-full h-full object-cover"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent) {
            parent.innerHTML = '<span class="text-gray-400 text-xs flex items-center justify-center h-full">Error</span>';
          }
        }}
      />
    </div>
  );
}