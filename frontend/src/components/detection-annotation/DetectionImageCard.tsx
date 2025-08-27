/**
 * Detection image card with overlay visualization.
 * Shows a detection image with optional predictions and user annotations.
 */

import { useState, useRef } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { Detection, DetectionAnnotation } from '@/types/api';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { BoundingBoxOverlay, UserAnnotationOverlay } from '@/components/annotation/ImageOverlays';

interface DetectionImageCardProps {
  detection: Detection;
  onClick: () => void;
  isAnnotated?: boolean;
  showPredictions?: boolean;
  userAnnotation?: DetectionAnnotation | null;
}

interface ImageInfo {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function DetectionImageCard({ 
  detection, 
  onClick, 
  isAnnotated = false, 
  showPredictions = false, 
  userAnnotation = null 
}: DetectionImageCardProps) {
  const { data: imageData, isLoading } = useDetectionImage(detection.id);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      // Get actual rendered positions from DOM
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();

      // Calculate the image position relative to the container
      const offsetX = imgRect.left - containerRect.left;
      const offsetY = imgRect.top - containerRect.top;

      // Use the actual rendered dimensions
      const width = imgRect.width;
      const height = imgRect.height;

      console.log('handleImageLoad called for detection:', detection.id, { width, height, offsetX, offsetY });
      setImageInfo({
        width,
        height,
        offsetX,
        offsetY
      });
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gray-50 rounded-lg p-3 shadow-sm">
        <div className="aspect-video bg-gray-200 animate-pulse rounded-lg">
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
        </div>
        <div className="mt-3 h-8 bg-gray-200 animate-pulse rounded"></div>
      </div>
    );
  }

  if (!imageData?.url) {
    return (
      <div className="bg-gray-50 rounded-lg p-3 shadow-sm border-2 border-gray-200">
        <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
          <span className="text-gray-400 text-sm">No Image</span>
        </div>
        <div className="mt-3 py-2">
          <p className="text-xs text-gray-500">
            {new Date(detection.recorded_at).toLocaleString()}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`
        bg-white rounded-lg p-3 shadow-sm border-2 cursor-pointer transition-all duration-200
        hover:shadow-md hover:scale-[1.02] active:scale-[0.98]
        ${isAnnotated ? 'border-green-200 bg-green-50' : 'border-gray-200 hover:border-blue-300'}
      `}
      onClick={onClick}
    >
      {/* Image Container with Overlays */}
      <div ref={containerRef} className="aspect-video relative overflow-hidden rounded-lg bg-gray-100">
        <img
          ref={imgRef}
          src={imageData.url}
          alt={`Detection ${detection.id}`}
          className="w-full h-full object-contain"
          onLoad={handleImageLoad}
          draggable={false}
        />
        
        {/* AI Predictions Overlay */}
        {showPredictions && detection.algo_predictions?.predictions && imageInfo && (
          <BoundingBoxOverlay
            detection={detection}
            imageInfo={imageInfo}
          />
        )}

        {/* User Annotations Overlay */}
        {userAnnotation?.annotation?.annotation && imageInfo && (
          <UserAnnotationOverlay
            detectionAnnotation={userAnnotation}
            imageInfo={imageInfo}
          />
        )}
      </div>

      {/* Card Footer */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex flex-col">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-900">
              Detection #{detection.id}
            </span>
            {isAnnotated && <CheckCircle className="w-4 h-4 text-green-500" />}
          </div>
          
          <p className="text-xs text-gray-500">
            {new Date(detection.recorded_at).toLocaleString()}
          </p>
          
          {detection.confidence && (
            <p className="text-xs text-gray-600">
              Confidence: {(detection.confidence * 100).toFixed(1)}%
            </p>
          )}
        </div>

        {/* Status Indicator */}
        <div className="flex flex-col items-end space-y-1">
          {detection.algo_predictions?.predictions?.length && (
            <div className="flex items-center space-x-1">
              <AlertCircle className="w-3 h-3 text-blue-500" />
              <span className="text-xs text-blue-600">
                {detection.algo_predictions.predictions.length} prediction{detection.algo_predictions.predictions.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
          
          {userAnnotation?.annotation?.annotation?.length && (
            <div className="flex items-center space-x-1">
              <CheckCircle className="w-3 h-3 text-green-500" />
              <span className="text-xs text-green-600">
                {userAnnotation.annotation.annotation.length} annotation{userAnnotation.annotation.annotation.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}