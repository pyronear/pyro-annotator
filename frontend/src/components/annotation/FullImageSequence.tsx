import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { apiClient } from '@/services/api';
import { ObjectOverlay } from '@/utils/annotation/objectColors';

// Legacy default border color for the own-object box, kept for callers that
// don't pass `color` (e.g. the single-object AnnotationInterface flow via
// SequenceAnnotationGrid, where there's no per-object identity to color by).
const DEFAULT_OWN_BOX_COLOR = '#ef4444'; // Tailwind red-500

/**
 * One frame of the sequence: which detection image to show, and (optionally)
 * the object's own box on it. `xyxyn: null` shows the frame with no own box
 * drawn — the classify cockpit plays the whole alert's frame union so an
 * object's absence on a frame is visible instead of the frame being skipped.
 * `BoundingBox` from the API types is assignable (its `xyxyn` is always set).
 */
export interface FullImageFrame {
  detection_id: number;
  xyxyn: number[] | null;
}

/** A click-to-seek request from the caller. `nonce` is a monotonic counter so a new click on the same index still re-seeks. */
export interface SeekRequest {
  index: number;
  nonce: number;
}

const SEEK_HOLD_MS = 2000;

interface FullImageSequenceProps {
  bboxes: FullImageFrame[];
  sequenceId: number;
  className?: string;
  /** This object's accent color for its own box. Defaults to red (legacy look) when omitted. */
  color?: string;
  /** `bboxes[i]`'s detection `recorded_at`, used to align `siblingOverlays` boxes to the currently shown frame. Omit to skip sibling rendering. */
  frameRecordedAt?: (string | undefined)[];
  /** Other objects' track boxes, rendered dimmed in their own colors — "which plume is mine" context for this card. */
  siblingOverlays?: ObjectOverlay[];
  /** Jump the loop to this frame, hold it SEEK_HOLD_MS, then resume — keyed on `nonce`. */
  seekRequest?: SeekRequest | null;
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
  color,
  frameRecordedAt,
  siblingOverlays,
  seekRequest,
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
  // Locked aspect ratio for the reserved box, measured once from the first
  // frame that decodes so a non-16:9 camera is never letterboxed. Null until
  // then — the box holds 16:9 in the meantime.
  const [aspect, setAspect] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isHolding, setIsHolding] = useState(false);
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Value-based identity for the frame list: callers (the classify cockpit)
  // rebuild the bboxes array every render, so keying the reset/fetch effects
  // on the array reference would loop them forever. Box coordinates aren't
  // part of the key on purpose — they only affect drawing, not which images
  // to fetch. Nor is sequenceId: detection ids are globally unique, and in
  // the cockpit every object of an alert shares the same union frame list —
  // keying on ids alone means switching objects doesn't reload the images.
  const frameKey = bboxes.map(b => b.detection_id).join(',');

  // Reset + fetch in ONE effect keyed on the frame list, with the in-flight
  // fetch cancelled on change. Splitting them (reset here, fetch in a second
  // effect gated on `images.length === 0`) raced: switching alerts while the
  // previous alert's URL fetch was still in flight let that stale fetch
  // commit its results afterwards, and the length guard then permanently
  // blocked a fetch for the current frame list — the player stayed on the
  // previous alert's images until a page reload.
  useEffect(() => {
    let cancelled = false;

    setImages([]);
    setCurrentIndex(0);
    setIsLoading(true);
    setError(null);
    setImageInfo(null); // Clear image positioning info
    setAspect(null); // A new frame list measures its own box.
    // A pending seek-hold belongs to the old frame list.
    setIsHolding(false);
    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);

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
            img.onload = () => {
              if (cancelled) return;
              setImages(prev =>
                prev.map((item, i) => (i === index ? { ...item, loaded: true } : item))
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
    // `bboxes`/`sequenceId` are read through the closure on purpose — see
    // `frameKey` above for why neither belongs in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  // Jump-and-hold per seek request: show the requested frame with the loop
  // suspended, then resume. Keyed on the nonce so re-clicking the same
  // frame re-holds. `bboxes` is read through the closure like the fetch
  // effect above (see `frameKey`); an index that no longer fits the current
  // frame list (list changed mid-flight) is ignored.
  useEffect(() => {
    if (!seekRequest) return;
    if (seekRequest.index < 0 || seekRequest.index >= bboxes.length) return;
    setCurrentIndex(seekRequest.index);
    setIsHolding(true);
    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    holdTimeoutRef.current = setTimeout(() => setIsHolding(false), SEEK_HOLD_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.nonce]);

  // The frame list is read through a ref by the interval below. Listing
  // `images` in that effect's dependencies tore the 200ms timer down and
  // recreated it on every single image load, so during the initial load burst
  // the timer kept resetting and playback lurched.
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  });

  // The old start condition as one boolean. It flips false -> true once, early
  // in the load, and stays true — so the effect below re-runs on that single
  // transition rather than once per loaded image.
  const canPlay = images.length > 1 && images.filter(img => img.loaded && !img.error).length > 1;

  // Auto-play animation with 200ms interval - only when images are loaded
  // and no seek-hold is pinning the current frame.
  useEffect(() => {
    if (!canPlay || isLoading || isHolding) return;

    intervalRef.current = setInterval(() => {
      setCurrentIndex(prev => {
        // Advance only onto frames the browser has decoded. An <img> whose
        // src has nothing decoded has no intrinsic height, so landing on one
        // used to collapse the container entirely; with the box now reserved
        // it still blanks the player for a tick. Errored frames stay in the
        // rotation on purpose: "not decoded yet" is transient and the frame
        // rejoins the loop when it arrives, but an error is permanent, and
        // skipping it would silently shorten the loop and hide the failure.
        // The transient assumption holds for the cases that actually occur —
        // a frame queued behind the browser's per-host connection limit
        // settles in seconds, and a hard failure fires onerror. A request
        // that hangs without firing either handler would stay skipped, which
        // is accepted: bounding the skip to N passes would just reinstate the
        // blanking this exists to remove.
        const frames = imagesRef.current;
        for (let step = 1; step <= frames.length; step++) {
          const next = (prev + step) % frames.length;
          if (frames[next]?.loaded || frames[next]?.error) return next;
        }
        return prev;
      });
    }, 200);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [canPlay, isLoading, isHolding]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (holdTimeoutRef.current) {
        clearTimeout(holdTimeoutRef.current);
      }
    };
  }, []);

  // Where the image actually sits inside the reserved box — the overlays are
  // positioned against this, and `object-contain` means it is not simply the
  // box itself (a frame whose ratio differs from the box's is letterboxed).
  const measureImage = useCallback(() => {
    if (!imgRef.current || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const imgRect = imgRef.current.getBoundingClientRect();

    setImageInfo({
      width: imgRect.width,
      height: imgRect.height,
      offsetX: imgRect.left - containerRect.left,
      offsetY: imgRect.top - containerRect.top,
    });
  }, []);

  // Re-measure once a newly locked aspect has actually been applied to the
  // box. `handleImageLoad` below measures synchronously, before the resize
  // commits, so its numbers describe the old box — for a 4:3 frame in the
  // 16:9 default that is 25% too narrow and offset. A multi-frame alert would
  // paper over it on the next frame's onLoad, but a single-frame alert never
  // fires one (the loop needs two decoded frames to start), so without this
  // the overlays would stay wrong for as long as the card is open.
  useLayoutEffect(() => {
    if (aspect === null) return;
    measureImage();
  }, [aspect, measureImage]);

  // Handle image load to get dimensions for bbox positioning
  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      // Lock the reserved box to the first decoded frame's own ratio. The
      // layout effect above re-measures once that lock lands.
      if (aspect === null && imgRef.current.naturalWidth > 0 && imgRef.current.naturalHeight > 0) {
        setAspect(imgRef.current.naturalWidth / imgRef.current.naturalHeight);
      }

      measureImage();
    }
  };

  // Render bounding box overlay (same pattern as SequencePlayer)
  const renderBoundingBox = () => {
    if (!imageInfo || currentIndex >= bboxes.length) return null;

    const currentBbox = bboxes[currentIndex];
    // A frame the object has no box on renders box-less rather than being skipped.
    if (!currentBbox.xyxyn) return null;
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
        data-testid="full-own-box"
        className="absolute border-2 pointer-events-none"
        style={{
          left: `${bboxLeft}px`,
          top: `${bboxTop}px`,
          width: `${bboxWidth}px`,
          height: `${bboxHeight}px`,
          borderColor: color ?? DEFAULT_OWN_BOX_COLOR,
        }}
      />
    );
  };

  // Render other objects' boxes, dimmed, on this same frame (matched by
  // `recorded_at`) — "which plume is mine" context for this card.
  const renderSiblingOverlays = () => {
    if (!imageInfo || !siblingOverlays || siblingOverlays.length === 0) return null;

    const recordedAt = frameRecordedAt?.[currentIndex];
    if (!recordedAt) return null;

    const imageWidth = imageInfo.width;
    const imageHeight = imageInfo.height;

    return siblingOverlays
      .map(overlay => {
        const box = overlay.boxesByRecordedAt[recordedAt];
        if (!box) return null;

        const [x1, y1, x2, y2] = box;
        if (x2 <= x1 || y2 <= y1) return null;

        const left = imageInfo.offsetX + x1 * imageWidth;
        const top = imageInfo.offsetY + y1 * imageHeight;
        const width = (x2 - x1) * imageWidth;
        const height = (y2 - y1) * imageHeight;

        return (
          <div
            key={`full-sibling-overlay-${overlay.label}`}
            data-testid={`full-sibling-overlay-${overlay.label}`}
            className="absolute border-2 pointer-events-none opacity-40"
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
              borderColor: overlay.color,
            }}
          />
        );
      })
      .filter(Boolean);
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
        data-testid="full-image-viewport"
        className="relative mx-auto flex items-center justify-center overflow-hidden rounded border border-gray-300 bg-char shadow-sm"
        style={{
          width: '1280px',
          maxWidth: '100%',
          // Reserve the height. Deriving it from the image (the old
          // `height: 'auto'` here plus `w-full h-auto` on the <img>) collapsed
          // this box to nothing on every frame the browser had not decoded
          // yet, which resized the whole cockpit 5x a second.
          aspectRatio: aspect ?? 16 / 9,
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
              className="max-w-full max-h-full object-contain"
            />

            {/* Bounding Box Overlay */}
            {renderBoundingBox()}
            {renderSiblingOverlays()}
          </>
        )}
      </div>
    </div>
  );
}
