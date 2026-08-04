import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, AlertCircle, Minus, Plus } from 'lucide-react';
import { BoundingBox } from '@/types/api';
import { apiClient } from '@/services/api';
import { computeSquareCrop, MAX_ZOOM, MIN_ZOOM } from '@/utils/annotation/squareCropUtils';

/** Constant canvas backing resolution — CSS scales it; zoom never resizes the element. */
const CANVAS_RES = 840;

interface CroppedImageSequenceProps {
  bboxes: BoundingBox[];
  sequenceId: number;
  /** Ties the crop to its object: a thin viewport frame in the object's overlay color. */
  accentColor?: string;
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
  accentColor,
  className = '',
}: CroppedImageSequenceProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [images, setImages] = useState<ImageData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(MIN_ZOOM); // 1x = wide default framing

  // Callback-ref state, not a plain ref: the viewport doesn't exist during
  // the loading/error branches, so the wheel listener must (re)bind when
  // the element actually mounts, not on component mount.
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
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

  // Value-based identity for the frame list, mirroring FullImageSequence:
  // which images to fetch depends only on the detection ids, never on the box
  // coordinates (those drive the crop, and `drawToCanvas` keys on them
  // separately). Keying the effect below on the `bboxes` array *reference*
  // instead would make it hostage to caller memoization — and now that the
  // effect cancels its in-flight fetch, a caller that rebuilt the array each
  // render would leave this stuck on a permanent spinner rather than merely
  // flickering.
  const frameKey = bboxes.map(b => b.detection_id).join(',');

  // Reset + fetch in ONE effect keyed on that frame list, with the in-flight
  // fetch cancelled on change. Splitting them (reset here, fetch in a second
  // effect gated on `images.length === 0`) raced: switching alerts while the
  // previous alert's URL fetch was still in flight let that stale fetch
  // commit its results afterwards, and the length guard then permanently
  // blocked a fetch for the current props — the loop stayed on the previous
  // alert's images until a page reload.
  useEffect(() => {
    let cancelled = false;

    setImages([]);
    setCurrentIndex(0);
    setIsLoading(true);
    setError(null);
    setZoomLevel(MIN_ZOOM); // Reset zoom to default

    // No frames yet (the classify cockpit renders an object before its
    // detections resolve). Stay in the loading state rather than falling
    // through to the "Failed to load" branch — an empty list isn't a failure,
    // and the effect re-runs with real frames the moment they arrive.
    if (!bboxes.length || !sequenceId) return;

    const fetchImages = async () => {
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
        if (cancelled) return;
        setImages(imageResults);

        // Start preloading images
        imageResults.forEach((image, index) => {
          if (!image.error && image.url) {
            const img = new Image();
            // Note: Not setting crossOrigin to avoid CORS issues with local S3
            img.onload = () => {
              if (cancelled) return;
              setImages(prev =>
                prev.map((item, i) =>
                  i === index ? { ...item, loaded: true, imageElement: img } : item
                )
              );
            };
            img.onerror = () => {
              if (cancelled) return;
              setImages(prev =>
                prev.map((item, i) => (i === index ? { ...item, error: true } : item))
              );
            };
            img.src = image.url;
          }
        });
      } catch (err) {
        if (!cancelled) setError('Failed to fetch detection images');
        // Error fetching images
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchImages();
    return () => {
      cancelled = true;
    };
    // `bboxes` is read through the closure on purpose — see `frameKey` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, sequenceId]);

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

    const crop = computeSquareCrop(
      calculateAverageBbox(bboxes),
      img.naturalWidth,
      img.naturalHeight,
      zoomLevel
    );

    // Size once — reassigning width/height reallocates the buffer per draw.
    if (canvas.width !== CANVAS_RES) {
      canvas.width = CANVAS_RES;
      canvas.height = CANVAS_RES;
    }
    ctx.clearRect(0, 0, CANVAS_RES, CANVAS_RES);
    ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, CANVAS_RES, CANVAS_RES);
  }, [bboxes, currentIndex, images, zoomLevel]);

  // Wheel-zoom must preventDefault so the page doesn't scroll — React's
  // onWheel is passive, so attach the listener manually.
  useEffect(() => {
    if (!viewportEl) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoomLevel(prev => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * factor)));
    };
    viewportEl.addEventListener('wheel', onWheel, { passive: false });
    return () => viewportEl.removeEventListener('wheel', onWheel);
  }, [viewportEl]);

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
      {/* Fixed square viewport — the element never resizes; zoom changes the
          drawn source rect instead (see squareCropUtils). */}
      <div
        ref={setViewportEl}
        data-testid="cropped-viewport"
        className={`relative mx-auto w-full max-w-[min(380px,33vh)] aspect-square overflow-hidden bg-gray-900 ${
          accentColor ? 'border-2' : ''
        }`}
        style={accentColor ? { borderColor: accentColor } : undefined}
      >
        {showLoadingState && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <div className="flex flex-col items-center space-y-3">
              <Loader2 className="animate-spin w-6 h-6 text-primary-600" />
              <span className="text-sm text-gray-600">Loading image...</span>
            </div>
          </div>
        )}

        {currentImage?.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <div className="flex flex-col items-center space-y-2">
              <AlertCircle className="w-6 h-6 text-red-400" />
              <span className="text-sm text-gray-600">Failed to load image</span>
            </div>
          </div>
        )}

        {currentImage?.loaded && currentImage.imageElement && (
          <>
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
            <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-white">
              <button
                onClick={() => setZoomLevel(prev => Math.max(MIN_ZOOM, prev - 0.5))}
                disabled={zoomLevel <= MIN_ZOOM}
                title="Zoom out"
                aria-label="Zoom out"
                className="p-0.5 hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="font-data text-[11px] font-medium w-8 text-center">
                {zoomLevel.toFixed(1)}x
              </span>
              <button
                onClick={() => setZoomLevel(prev => Math.min(MAX_ZOOM, prev + 0.5))}
                disabled={zoomLevel >= MAX_ZOOM}
                title="Zoom in"
                aria-label="Zoom in"
                className="p-0.5 hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
