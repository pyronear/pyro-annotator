import { useState, useEffect, useRef } from 'react';
import { AlertCircle, Eye } from 'lucide-react';
import { Detection, AlgoPrediction } from '@/types/api';
import { useDetectionImage } from '@/hooks/useSequenceDetections';

interface SequencePlayerProps {
  detections: Detection[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  className?: string;
}

export default function SequencePlayer({ 
  detections, 
  currentIndex, 
  onIndexChange,
  className = '' 
}: SequencePlayerProps) {
  const [imageCache, setImageCache] = useState<Record<number, string>>({});
  const [imageErrors, setImageErrors] = useState<Record<number, boolean>>({});
  const [imageLoading, setImageLoading] = useState<Record<number, boolean>>({});
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentDetection = detections[currentIndex];

  // Fetch current image URL
  const { data: currentImageData, isLoading: currentImageLoading, error: currentImageError } = useDetectionImage(
    currentDetection?.id || null,
    !!currentDetection
  );

  // Preload next few images
  const nextDetection = detections[currentIndex + 1];
  const { data: nextImageData } = useDetectionImage(
    nextDetection?.id || null,
    !!nextDetection
  );

  // Cache image URLs when they load
  useEffect(() => {
    if (currentImageData?.url && currentDetection) {
      setImageCache(prev => ({
        ...prev,
        [currentDetection.id]: currentImageData.url
      }));
    }
  }, [currentImageData, currentDetection]);

  useEffect(() => {
    if (nextImageData?.url && nextDetection) {
      setImageCache(prev => ({
        ...prev,
        [nextDetection.id]: nextImageData.url
      }));
    }
  }, [nextImageData, nextDetection]);

  // Preload image in browser cache
  useEffect(() => {
    if (currentImageData?.url && currentDetection) {
      const img = new Image();
      img.src = currentImageData.url;
      
      setImageLoading(prev => ({ ...prev, [currentDetection.id]: true }));
      
      img.onload = () => {
        setImageLoading(prev => ({ ...prev, [currentDetection.id]: false }));
        setImageErrors(prev => ({ ...prev, [currentDetection.id]: false }));
      };
      
      img.onerror = () => {
        setImageLoading(prev => ({ ...prev, [currentDetection.id]: false }));
        setImageErrors(prev => ({ ...prev, [currentDetection.id]: true }));
      };
    }
  }, [currentImageData, currentDetection]);

  if (!currentDetection) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-lg p-8 ${className}`}>
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-900 mb-2">
            No Detections Found
          </p>
          <p className="text-gray-600">
            This sequence doesn't contain any detections to review.
          </p>
        </div>
      </div>
    );
  }

  // Handle image load to get dimensions
  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setImageDimensions({ width: img.offsetWidth, height: img.offsetHeight });
    setImageLoading(prev => ({ ...prev, [currentDetection.id]: false }));
    setImageErrors(prev => ({ ...prev, [currentDetection.id]: false }));
  };

  // Render bounding boxes overlay
  const renderBoundingBoxes = () => {
    if (!imageDimensions || !currentDetection?.algo_predictions?.predictions) return null;

    return currentDetection.algo_predictions.predictions.map((prediction: AlgoPrediction, index: number) => {
      // Convert normalized coordinates (xyxyn) to pixel coordinates
      const [x1, y1, x2, y2] = prediction.xyxyn;
      const left = x1 * imageDimensions.width;
      const top = y1 * imageDimensions.height;
      const width = (x2 - x1) * imageDimensions.width;
      const height = (y2 - y1) * imageDimensions.height;

      return (
        <div
          key={`${currentDetection.id}-${index}`}
          className="absolute border-2 border-red-500 bg-red-500/20 pointer-events-none"
          style={{
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
          }}
        >
          {/* Confidence label */}
          <div className="absolute -top-6 left-0 bg-red-500 text-white text-xs px-1 py-0.5 rounded whitespace-nowrap">
            {prediction.class_name} {(prediction.confidence * 100).toFixed(0)}%
          </div>
        </div>
      );
    });
  };

  const isLoading = currentImageLoading || imageLoading[currentDetection.id];
  const hasError = currentImageError || imageErrors[currentDetection.id];
  const imageUrl = imageCache[currentDetection.id] || currentImageData?.url;

  return (
    <div className={`bg-white border border-gray-200 rounded-lg overflow-hidden ${className}`}>
      {/* Image Display Area */}
      <div 
        ref={containerRef}
        className="relative aspect-video bg-gray-900 flex items-center justify-center"
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="flex items-center space-x-3">
              <div className="animate-spin w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full"></div>
              <span className="text-sm text-gray-600">Loading detection image...</span>
            </div>
          </div>
        )}

        {hasError && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50">
            <div className="text-center">
              <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-600">Failed to load detection image</p>
              <p className="text-xs text-gray-500 mt-1">Detection #{currentDetection.id}</p>
            </div>
          </div>
        )}

        {imageUrl && !isLoading && !hasError && (
          <>
            <img
              ref={imgRef}
              src={imageUrl}
              alt={`Detection ${currentIndex + 1} of ${detections.length}`}
              className="max-w-full max-h-full object-contain"
              onLoad={handleImageLoad}
              onError={() => {
                setImageLoading(prev => ({ ...prev, [currentDetection.id]: false }));
                setImageErrors(prev => ({ ...prev, [currentDetection.id]: true }));
              }}
            />
            
            {/* Bounding Boxes Overlay */}
            {imageDimensions && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative" style={{ width: imageDimensions.width, height: imageDimensions.height }}>
                  {renderBoundingBoxes()}
                </div>
              </div>
            )}
          </>
        )}

        {/* Detection Info Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          <div className="flex items-center justify-between text-white">
            <div>
              <p className="text-sm font-medium">
                Detection {currentIndex + 1} of {detections.length}
              </p>
              <p className="text-xs opacity-90">
                {new Date(currentDetection.recorded_at).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Eye className="w-4 h-4" />
              <span className="text-xs">
                {currentDetection.algo_predictions.predictions.length} prediction{currentDetection.algo_predictions.predictions.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}