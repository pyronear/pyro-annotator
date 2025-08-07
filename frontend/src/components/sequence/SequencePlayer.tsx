import { useState, useEffect, useRef } from 'react';
import { AlertCircle, Eye, Loader2 } from 'lucide-react';
import { Detection, AlgoPrediction } from '@/types/api';
import { useImagePreloader } from '@/hooks/useImagePreloader';

interface SequencePlayerProps {
  detections: Detection[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onPreloadComplete?: () => void;
  className?: string;
}

export default function SequencePlayer({ 
  detections, 
  currentIndex, 
  onIndexChange,
  onPreloadComplete,
  className = '' 
}: SequencePlayerProps) {
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  
  // Use the image preloader hook
  const { 
    currentImage, 
    imageCache, 
    isInitialLoading, 
    isImageReady,
    getPreloadProgress 
  } = useImagePreloader(detections, currentIndex, {
    preloadAhead: 10,
    preloadBehind: 5
  });
  
  const currentDetection = detections[currentIndex];
  const preloadProgress = getPreloadProgress();
  
  // Trigger preload complete callback when initial loading is done
  useEffect(() => {
    if (!isInitialLoading && onPreloadComplete) {
      onPreloadComplete();
    }
  }, [isInitialLoading, onPreloadComplete]);
  
  // Update image when index changes
  useEffect(() => {
    if (currentImage?.loaded && imgRef.current) {
      // Set the new image source
      if (imgRef.current.src !== currentImage.url) {
        imgRef.current.src = currentImage.url;
      }
    }
  }, [currentImage]);
  
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
  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth;
      const containerHeight = containerRef.current.offsetHeight;
      const imgNaturalWidth = imgRef.current.naturalWidth;
      const imgNaturalHeight = imgRef.current.naturalHeight;
      
      // Calculate scaled dimensions to fit container
      const scale = Math.min(
        containerWidth / imgNaturalWidth,
        containerHeight / imgNaturalHeight
      );
      
      setImageDimensions({
        width: imgNaturalWidth * scale,
        height: imgNaturalHeight * scale
      });
    }
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
  
  // Only show loading spinner when image isn't loaded
  const showLoadingState = !currentImage?.loaded;
  const hasError = currentImage?.error;
  
  return (
    <div className={`bg-white border border-gray-200 rounded-lg overflow-hidden ${className}`}>
      {/* Preload Progress Bar (only visible during initial load) */}
      {isInitialLoading && preloadProgress.percentage < 100 && (
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
            <span>Preloading images...</span>
            <span>{preloadProgress.loaded} / {preloadProgress.total}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1">
            <div 
              className="bg-primary-600 h-1 rounded-full transition-all duration-300"
              style={{ width: `${preloadProgress.percentage}%` }}
            />
          </div>
        </div>
      )}
      
      {/* Image Display Area */}
      <div 
        ref={containerRef}
        className="relative aspect-video bg-gray-900 flex items-center justify-center"
        style={{
          // GPU acceleration hints
          transform: 'translateZ(0)',
          willChange: 'contents'
        }}
      >
        {/* Loading State */}
        {showLoadingState && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-30">
            <div className="flex flex-col items-center space-y-3">
              <Loader2 className="animate-spin w-8 h-8 text-primary-600" />
              <span className="text-sm text-gray-600">Loading detection image...</span>
              {preloadProgress.percentage > 0 && (
                <span className="text-xs text-gray-500">
                  {Math.round(preloadProgress.percentage)}% cached
                </span>
              )}
            </div>
          </div>
        )}
        
        {/* Error State */}
        {hasError && !showLoadingState && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-30">
            <div className="text-center">
              <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-600">Failed to load detection image</p>
              <p className="text-xs text-gray-500 mt-1">Detection #{currentDetection.id}</p>
            </div>
          </div>
        )}
        
        {/* Main Image */}
        {currentImage?.url && !hasError && (
          <>
            <img
              ref={imgRef}
              src={currentImage.url}
              alt={`Detection ${currentIndex + 1} of ${detections.length}`}
              className="max-w-full max-h-full object-contain"
              style={{
                opacity: showLoadingState ? 0 : 1,
                transition: 'opacity 200ms ease-in-out',
                transform: 'translateZ(0)', // Force GPU layer
              }}
              onLoad={handleImageLoad}
            />
            
            {/* Bounding Boxes Overlay */}
            {imageDimensions && !showLoadingState && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <div className="relative" style={{ width: imageDimensions.width, height: imageDimensions.height }}>
                  {renderBoundingBoxes()}
                </div>
              </div>
            )}
          </>
        )}
        
        {/* Detection Info Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 z-25">
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
                {currentDetection.algo_predictions?.predictions?.length || 0} prediction{currentDetection.algo_predictions?.predictions?.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}