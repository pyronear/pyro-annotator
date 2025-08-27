import { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { BoundingBox } from '@/types/api';
import { apiClient } from '@/services/api';

interface FullImageSequenceProps {
  bboxes: BoundingBox[];
  sequenceId: number;
  className?: string;
}

interface ImageData {
  url: string;
  loaded: boolean;
  error: boolean;
}

export default function FullImageSequence({
  bboxes,
  sequenceId,
  className = '',
}: FullImageSequenceProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [images, setImages] = useState<ImageData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clear state immediately when props change to prevent stale data
  useEffect(() => {
    setImages([]);
    setCurrentIndex(0);
    setIsLoading(true);
    setError(null);
    setImageInfo(null); // Clear image positioning info
  }, [bboxes, sequenceId]);

  // Fetch detection image URLs
  useEffect(() => {
    const fetchImages = async () => {
      if (!bboxes.length || !sequenceId) {
        setIsLoading(false);
        return;
      }

      try {
        // Fetch all detection image URLs
        const imagePromises = bboxes.map(async bbox => {
          try {
            const response = await apiClient.getDetectionImageUrl(bbox.detection_id);
            return {
              url: response.url,
              loaded: false,
              error: false,
            };
          } catch (err) {
            // Failed to fetch image for detection
            return {
              url: '',
              loaded: false,
              error: true,
            };
          }
        });

        const imageResults = await Promise.all(imagePromises);
        setImages(imageResults);

        // Start preloading images
        imageResults.forEach((image, index) => {
          if (!image.error && image.url) {
            const img = new Image();
            img.onload = () => {
              setImages(prev =>
                prev.map((item, i) => (i === index ? { ...item, loaded: true } : item))
              );
            };
            img.onerror = () => {
              setImages(prev =>
                prev.map((item, i) => (i === index ? { ...item, error: true } : item))
              );
            };
            img.src = image.url;
          }
        });
      } catch (err) {
        setError('Failed to fetch detection images');
        // Error fetching images
      } finally {
        setIsLoading(false);
      }
    };

    // Only fetch if we have cleared state (prevents duplicate fetching)
    if (bboxes.length > 0 && sequenceId && images.length === 0) {
      fetchImages();
    }
  }, [bboxes, sequenceId, images.length]);

  // Auto-play animation with 200ms interval - only when images are loaded
  useEffect(() => {
    const loadedImagesCount = images.filter(img => img.loaded && !img.error).length;

    if (images.length > 1 && loadedImagesCount > 1 && !isLoading) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex(prev => (prev + 1) % images.length);
      }, 200);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [images.length, images, isLoading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Handle image load to get dimensions for bbox positioning
  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();

      const offsetX = imgRect.left - containerRect.left;
      const offsetY = imgRect.top - containerRect.top;
      const width = imgRect.width;
      const height = imgRect.height;

      setImageInfo({
        width,
        height,
        offsetX,
        offsetY,
      });
    }
  };

  // Render bounding box overlay (same pattern as SequencePlayer)
  const renderBoundingBox = () => {
    if (!imageInfo || currentIndex >= bboxes.length) return null;

    const currentBbox = bboxes[currentIndex];
    const [x1, y1, x2, y2] = currentBbox.xyxyn;

    // Ensure valid bbox
    if (x2 <= x1 || y2 <= y1) return null;

    // Calculate pixel coordinates relative to the image
    const imageWidth = imageInfo.width;
    const imageHeight = imageInfo.height;

    const bboxLeft = imageInfo.offsetX + x1 * imageWidth;
    const bboxTop = imageInfo.offsetY + y1 * imageHeight;
    const bboxWidth = (x2 - x1) * imageWidth;
    const bboxHeight = (y2 - y1) * imageHeight;

    return (
      <div
        className="absolute border-2 border-red-500 bg-red-500/20 pointer-events-none"
        style={{
          left: `${bboxLeft}px`,
          top: `${bboxTop}px`,
          width: `${bboxWidth}px`,
          height: `${bboxHeight}px`,
        }}
      />
    );
  };

  if (isLoading) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <div className="flex items-center justify-center space-x-2">
          <Loader2 className="animate-spin w-5 h-5" />
          <span>Loading full sequence...</span>
        </div>
      </div>
    );
  }

  if (error || !images.length) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-400" />
        <span>Failed to load full sequence</span>
      </div>
    );
  }

  const currentImage = images[currentIndex];
  const showLoadingState = !currentImage?.loaded && !currentImage?.error;

  return (
    <div className={className}>
      {/* Full Image Container */}
      <div
        ref={containerRef}
        className="relative border border-gray-300 rounded shadow-sm mx-auto overflow-hidden"
        style={{
          width: '1280px',
          maxWidth: '100%',
          height: 'auto',
        }}
      >
        {/* Loading State */}
        {showLoadingState && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-30">
            <div className="flex flex-col items-center space-y-3">
              <Loader2 className="animate-spin w-6 h-6 text-primary-600" />
              <span className="text-sm text-gray-600">Loading image...</span>
            </div>
          </div>
        )}

        {/* Error State */}
        {currentImage?.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-30">
            <div className="flex flex-col items-center space-y-2">
              <AlertCircle className="w-6 h-6 text-red-400" />
              <span className="text-sm text-gray-600">Failed to load image</span>
            </div>
          </div>
        )}

        {/* Full Image */}
        {currentImage?.url && (
          <>
            <img
              ref={imgRef}
              src={currentImage.url}
              alt={`Detection ${currentIndex + 1}`}
              onLoad={handleImageLoad}
              className="w-full h-auto"
            />

            {/* Bounding Box Overlay */}
            {renderBoundingBox()}
          </>
        )}
      </div>
    </div>
  );
}
