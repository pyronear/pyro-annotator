import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, AlertCircle, Minus, Plus, RotateCcw } from 'lucide-react';
import { BoundingBox } from '@/types/api';
import { apiClient } from '@/services/api';

interface CroppedImageSequenceProps {
  bboxes: BoundingBox[];
  sequenceId: number;
  className?: string;
}

interface ImageData {
  url: string;
  loaded: boolean;
  error: boolean;
  imageElement?: HTMLImageElement;
}

export default function CroppedImageSequence({
  bboxes,
  sequenceId,
  className = '',
}: CroppedImageSequenceProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [images, setImages] = useState<ImageData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(4); // Default 4x zoom

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate average bounding box from all xyxyn coordinates (port from backend)
  const calculateAverageBbox = (bboxes: BoundingBox[]): [number, number, number, number] => {
    if (!bboxes.length) return [0, 0, 1, 1];

    const xyxyns = bboxes.map(b => b.xyxyn);
    const avgX1 = xyxyns.reduce((sum, bbox) => sum + bbox[0], 0) / xyxyns.length;
    const avgY1 = xyxyns.reduce((sum, bbox) => sum + bbox[1], 0) / xyxyns.length;
    const avgX2 = xyxyns.reduce((sum, bbox) => sum + bbox[2], 0) / xyxyns.length;
    const avgY2 = xyxyns.reduce((sum, bbox) => sum + bbox[3], 0) / xyxyns.length;

    return [avgX1, avgY1, avgX2, avgY2];
  };

  // Clear state immediately when props change to prevent stale data
  useEffect(() => {
    setImages([]);
    setCurrentIndex(0);
    setIsLoading(true);
    setError(null);
    setZoomLevel(4); // Reset zoom to default
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
            // Note: Not setting crossOrigin to avoid CORS issues with local S3
            img.onload = () => {
              setImages(prev =>
                prev.map((item, i) =>
                  i === index ? { ...item, loaded: true, imageElement: img } : item
                )
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

  // Draw current image to canvas with cropping
  const drawToCanvas = useCallback(() => {
    if (!canvasRef.current || !images.length || currentIndex >= images.length) return;

    const currentImage = images[currentIndex];
    if (!currentImage?.loaded || !currentImage.imageElement) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = currentImage.imageElement;

    // Calculate crop coordinates
    const avgBbox = calculateAverageBbox(bboxes);
    const [avgX1, avgY1, avgX2, avgY2] = avgBbox;

    // Padding around the bbox to show surrounding context.
    const padding = 0.2;
    const padX = (avgX2 - avgX1) * padding;
    const padY = (avgY2 - avgY1) * padding;

    const cropX1 = Math.max(0, avgX1 - padX);
    const cropY1 = Math.max(0, avgY1 - padY);
    const cropX2 = Math.min(1, avgX2 + padX);
    const cropY2 = Math.min(1, avgY2 + padY);

    // Convert normalized coordinates to pixels
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    const sourceX = cropX1 * imgWidth;
    const sourceY = cropY1 * imgHeight;
    const sourceWidth = (cropX2 - cropX1) * imgWidth;
    const sourceHeight = (cropY2 - cropY1) * imgHeight;

    // Calculate maximum allowed zoom based on original image dimensions
    const maxZoomX = imgWidth / sourceWidth;
    const maxZoomY = imgHeight / sourceHeight;
    const maxAllowedZoom = Math.min(maxZoomX, maxZoomY, 8); // Cap at 8x

    // Use effective zoom (user's choice or maximum allowed)
    const effectiveZoom = Math.min(zoomLevel, maxAllowedZoom);

    // Set canvas size to cropped area × effective zoom
    const canvasWidth = Math.round(sourceWidth * effectiveZoom);
    const canvasHeight = Math.round(sourceHeight * effectiveZoom);

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Clear canvas and draw cropped image
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(
      img,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight, // source rectangle
      0,
      0,
      canvasWidth,
      canvasHeight // destination rectangle
    );
  }, [bboxes, currentIndex, images, zoomLevel]);

  // Redraw canvas when current index or zoom level changes
  useEffect(() => {
    drawToCanvas();
  }, [currentIndex, images, zoomLevel, drawToCanvas]);

  if (isLoading) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <div className="flex items-center justify-center space-x-2">
          <Loader2 className="animate-spin w-5 h-5" />
          <span>Loading cropped sequence...</span>
        </div>
      </div>
    );
  }

  if (error || !images.length) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-400" />
        <span>Failed to load cropped sequence</span>
      </div>
    );
  }

  const currentImage = images[currentIndex];
  const showLoadingState = !currentImage?.loaded && !currentImage?.error;

  return (
    <div className={className}>
      {/* Cropped Image Container */}
      <div
        ref={containerRef}
        className="relative mx-auto overflow-hidden"
        style={{
          width: '900px',
          maxWidth: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Loading State */}
        {showLoadingState && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <div className="flex flex-col items-center space-y-3">
              <Loader2 className="animate-spin w-6 h-6 text-primary-600" />
              <span className="text-sm text-gray-600">Loading image...</span>
            </div>
          </div>
        )}

        {/* Error State */}
        {currentImage?.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <div className="flex flex-col items-center space-y-2">
              <AlertCircle className="w-6 h-6 text-red-400" />
              <span className="text-sm text-gray-600">Failed to load image</span>
            </div>
          </div>
        )}

        {/* Cropped Canvas */}
        {currentImage?.loaded && currentImage.imageElement && (
          <canvas
            ref={canvasRef}
            className="max-w-full h-auto"
            style={{
              display: 'block',
              margin: '0 auto',
            }}
          />
        )}
      </div>

      {/* Zoom controls — compact strip matching the grid's ViewToolbar */}
      {currentImage?.loaded && currentImage.imageElement && (
        <div className="mt-2 flex items-center justify-center">
          <div className="inline-flex items-center rounded-md bg-gray-200 p-0.5 gap-1">
            <button
              onClick={() => setZoomLevel(prev => Math.max(1, prev - 0.5))}
              disabled={zoomLevel <= 1}
              title="Zoom out"
              aria-label="Zoom out"
              className="px-1.5 py-0.5 rounded text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min="1"
              max="8"
              step="0.5"
              value={zoomLevel}
              onChange={e => setZoomLevel(parseFloat(e.target.value))}
              className="w-24 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer"
            />
            <button
              onClick={() => setZoomLevel(prev => Math.min(8, prev + 0.5))}
              disabled={zoomLevel >= 8}
              title="Zoom in"
              aria-label="Zoom in"
              className="px-1.5 py-0.5 rounded text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-medium text-gray-700 w-8 text-center">
              {zoomLevel.toFixed(1)}x
            </span>
            <button
              onClick={() => setZoomLevel(4)}
              title="Reset zoom"
              aria-label="Reset zoom"
              className="px-1.5 py-0.5 rounded text-xs text-gray-600 hover:text-gray-900 hover:bg-white"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
