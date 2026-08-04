import { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  Eye,
  Loader2,
  Info,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Detection, AlgoPrediction } from '@/types/api';
import { useImagePreloader } from '@/hooks/useImagePreloader';
import { ObjectOverlay } from '@/utils/annotation/objectColors';
import MissedSmokeInstructionsModal from './MissedSmokeInstructionsModal';

interface SequencePlayerProps {
  detections: Detection[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onPreloadComplete?: () => void;
  missedSmokeReview: 'yes' | 'no' | null;
  onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
  /** Every classified object's track boxes, color-coded per object and aligned to frames by `recorded_at`. The active card's object renders full-strength, others dimmed. */
  objectOverlays?: ObjectOverlay[];
  // Player controls props
  isPlaying: boolean;
  playbackSpeed: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: number) => void;
  /** Hide the embedded "Did the model miss any smoke?" overlay — used by the classify cockpit, where the decision rail owns the yes/no controls. */
  hideReviewControls?: boolean;
  /** When set, a fullscreen toggle renders in the control strip (the owner fullscreens its own container). */
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  className?: string;
}

export default function SequencePlayer({
  detections,
  currentIndex,
  // onIndexChange,
  onPreloadComplete,
  missedSmokeReview,
  onMissedSmokeReviewChange,
  // Player controls props
  isPlaying,
  playbackSpeed,
  onPlay,
  onPause,
  onSeek,
  onSpeedChange,
  objectOverlays,
  hideReviewControls = false,
  onToggleFullscreen,
  isFullscreen = false,
  className = '',
}: SequencePlayerProps) {
  const [imageInfo, setImageInfo] = useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  // Sibling boxes (Detection.others_bboxes) help spot missed smoke; ON by
  // default but can be hidden if they clutter the frame.
  const [showSiblingBboxes, setShowSiblingBboxes] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Player controls state
  // const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef<HTMLInputElement>(null);

  // Loop detection for smooth transitions
  const isLoopingBack = useRef(false);
  const prevIndex = useRef(currentIndex);

  // Use the image preloader hook
  const {
    currentImage,
    // imageCache,
    isInitialLoading,
    // isImageReady,
    getPreloadProgress,
  } = useImagePreloader(detections, currentIndex, {
    preloadAhead: 10,
    preloadBehind: 5,
  });

  const currentDetection = detections[currentIndex];
  const preloadProgress = getPreloadProgress();

  // Trigger preload complete callback when initial loading is done
  useEffect(() => {
    if (!isInitialLoading && onPreloadComplete) {
      onPreloadComplete();
    }
  }, [isInitialLoading, onPreloadComplete]);

  // Detect loop-back transitions for smooth handling
  useEffect(() => {
    // Detect loop-back: jumping from near-end to beginning
    if (prevIndex.current >= detections.length - 2 && currentIndex === 0) {
      isLoopingBack.current = true;
    } else {
      isLoopingBack.current = false;
    }
    prevIndex.current = currentIndex;
  }, [currentIndex, detections.length]);

  // Update image when index changes
  useEffect(() => {
    if (currentImage?.loaded && imgRef.current) {
      // Set the new image source
      if (imgRef.current.src !== currentImage.url) {
        imgRef.current.src = currentImage.url;
      }
    }
  }, [currentImage]);

  // Player controls keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not focused on input elements
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          isPlaying ? onPause() : onPlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onSeek(Math.max(0, currentIndex - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          onSeek(Math.min(detections.length - 1, currentIndex + 1));
          break;
        case ',':
          e.preventDefault();
          onSeek(Math.max(0, currentIndex - 1));
          break;
        case '.':
          e.preventDefault();
          onSeek(Math.min(detections.length - 1, currentIndex + 1));
          break;
        case '0':
        case 'Home':
          e.preventDefault();
          onSeek(0);
          break;
        case 'End':
          e.preventDefault();
          onSeek(detections.length - 1);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, currentIndex, detections.length, onPlay, onPause, onSeek]);

  // Local time in an ISO-like layout, easy to scan across frames.
  const formatRecordedAt = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newIndex = parseInt(e.target.value);
    onSeek(newIndex);
  };

  const handleSliderMouseDown = () => {
    // setIsDragging(true);
    if (isPlaying) {
      onPause();
    }
  };

  const handleSliderMouseUp = () => {
    // setIsDragging(false);
  };

  const speedOptions = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

  if (!currentDetection) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-lg p-8 ${className}`}>
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-900 mb-2">No Detections Found</p>
          <p className="text-gray-600">This sequence doesn't contain any detections to review.</p>
        </div>
      </div>
    );
  }

  // Handle image load to get dimensions and position using DOM positioning
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

      setImageInfo({
        width: width,
        height: height,
        offsetX: offsetX,
        offsetY: offsetY,
      });
    }
  };

  // Render bounding boxes overlay
  const renderBoundingBoxes = () => {
    if (!imageInfo || !currentDetection?.algo_predictions?.predictions) return null;

    return currentDetection.algo_predictions.predictions
      .map((prediction: AlgoPrediction, index: number) => {
        // Convert normalized coordinates (xyxyn) to pixel coordinates
        const [x1, y1, x2, y2] = prediction.xyxyn;

        // Ensure x2 > x1 and y2 > y1
        if (x2 <= x1 || y2 <= y1) {
          return null;
        }

        // Calculate pixel coordinates relative to the actual image position
        const left = imageInfo.offsetX + x1 * imageInfo.width;
        const top = imageInfo.offsetY + y1 * imageInfo.height;
        const width = (x2 - x1) * imageInfo.width;
        const height = (y2 - y1) * imageInfo.height;

        return (
          <div
            key={`bbox-${currentDetection.id}-${index}`}
            className="absolute border-2 border-red-500 pointer-events-none"
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
      })
      .filter(Boolean); // Remove null entries from invalid boxes
  };

  // Render sibling bbox overlay (Detection.others_bboxes — read-only hint
  // for missed smoke). Dashed gray to clearly distinguish from primary
  // predictions.
  const renderSiblingBoxes = () => {
    const siblings = currentDetection?.others_bboxes?.predictions;
    if (!imageInfo || !siblings || siblings.length === 0) return null;

    return siblings
      .map((prediction: AlgoPrediction, index: number) => {
        const [x1, y1, x2, y2] = prediction.xyxyn;
        if (x2 <= x1 || y2 <= y1) return null;

        const left = imageInfo.offsetX + x1 * imageInfo.width;
        const top = imageInfo.offsetY + y1 * imageInfo.height;
        const width = (x2 - x1) * imageInfo.width;
        const height = (y2 - y1) * imageInfo.height;

        return (
          <div
            key={`sibling-${currentDetection.id}-${index}`}
            className="absolute border-2 border-dashed border-gray-300 pointer-events-none opacity-80"
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
            }}
          >
            <div className="absolute -top-5 left-0 bg-gray-500/90 text-white text-[10px] px-1 rounded whitespace-nowrap">
              sibling {(prediction.confidence * 100).toFixed(0)}%
            </div>
          </div>
        );
      })
      .filter(Boolean);
  };

  // Render per-object track box overlays (ClassifyAlertPage's objectOverlays
  // — one color-coded box per object, aligned to this frame by
  // `recorded_at`). The active card's object renders full-strength, others
  // dimmed so the highlighted object still stands out.
  const renderObjectOverlays = () => {
    if (!imageInfo || !objectOverlays || objectOverlays.length === 0) return null;

    const recordedAt = currentDetection.recorded_at;

    return objectOverlays
      .map(overlay => {
        const box = overlay.boxesByRecordedAt[recordedAt];
        if (!box) return null;

        const [x1, y1, x2, y2] = box;
        if (x2 <= x1 || y2 <= y1) return null;

        const left = imageInfo.offsetX + x1 * imageInfo.width;
        const top = imageInfo.offsetY + y1 * imageInfo.height;
        const width = (x2 - x1) * imageInfo.width;
        const height = (y2 - y1) * imageInfo.height;

        return (
          <div
            key={`object-overlay-${overlay.label}-${currentDetection.id}`}
            data-testid={`object-overlay-${overlay.label}`}
            className={`absolute border-2 pointer-events-none transition-opacity ${
              overlay.isActive ? 'opacity-100' : 'opacity-40'
            }`}
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
              borderColor: overlay.color,
            }}
          >
            <div
              className="absolute -top-5 left-0 text-white text-[10px] px-1 rounded whitespace-nowrap"
              style={{ backgroundColor: overlay.color }}
            >
              {overlay.label}
            </div>
          </div>
        );
      })
      .filter(Boolean);
  };

  // Only show loading spinner when image isn't loaded
  const showLoadingState = !currentImage?.loaded;
  const hasError = currentImage?.error;

  // With object-track overlays present (the classify whole-alert view), the
  // raw prediction and sibling layers would only duplicate them.
  const hasObjectOverlays = !!objectOverlays && objectOverlays.length > 0;

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Preload Progress Bar (only visible during initial load) */}
      {isInitialLoading && preloadProgress.percentage < 100 && (
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
            <span>Preloading images...</span>
            <span>
              {preloadProgress.loaded} / {preloadProgress.total}
            </span>
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
          willChange: 'contents',
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
              alt={`Frame ${currentIndex + 1} of ${detections.length}`}
              className="max-w-full max-h-full object-contain"
              style={{
                opacity: showLoadingState && !isLoopingBack.current ? 0 : 1,
                transition: isLoopingBack.current ? 'none' : 'opacity 200ms ease-in-out',
                transform: 'translateZ(0)', // Force GPU layer
              }}
              onLoad={handleImageLoad}
            />

            {/* Bounding Boxes Overlay. The object-track overlays are derived
                from the raw algo predictions at import, and sibling boxes
                are just the other objects' predictions — with overlays
                present both layers would duplicate them exactly, so the
                overlays render alone. */}
            {imageInfo && !showLoadingState && (
              <div className="absolute inset-0 pointer-events-none z-20">
                {!hasObjectOverlays && renderBoundingBoxes()}
                {!hasObjectOverlays && showSiblingBboxes && renderSiblingBoxes()}
                {renderObjectOverlays()}
              </div>
            )}
          </>
        )}

        {/* Detection Info & Controls Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 z-25">
          <div className="space-y-3 text-white">
            {/* Row 1 - Detection Info & Missed Smoke Review */}
            <div className="flex items-end justify-between">
              {/* Left - frame timestamp (the control strip already counts frames) */}
              <div className="flex-1">
                <p className="text-sm font-medium font-mono">
                  {formatRecordedAt(currentDetection.recorded_at)}
                </p>
              </div>

              {/* Center - Missed Smoke Review */}
              {!hideReviewControls && (
                <div className="flex items-center space-x-4 bg-black/40 px-4 py-2 rounded-lg border border-white/20">
                  <span className="text-sm font-medium text-white">
                    Did the model miss any smoke?
                  </span>
                  <label className="flex items-center cursor-pointer hover:bg-white/10 px-2 py-1 rounded transition-colors">
                    <input
                      type="radio"
                      name="missedSmokeOverlay"
                      value="yes"
                      checked={missedSmokeReview === 'yes'}
                      onChange={() => onMissedSmokeReviewChange('yes')}
                      className="w-4 h-4 text-orange-500 focus:ring-orange-500 border-gray-300 bg-white/20 mr-2"
                    />
                    <span className="text-sm font-medium text-white">
                      Yes{' '}
                      <kbd className="ml-1 px-1 py-0.5 bg-white/20 rounded text-xs font-mono">
                        Y
                      </kbd>
                    </span>
                  </label>
                  <label className="flex items-center cursor-pointer hover:bg-white/10 px-2 py-1 rounded transition-colors">
                    <input
                      type="radio"
                      name="missedSmokeOverlay"
                      value="no"
                      checked={missedSmokeReview === 'no'}
                      onChange={() => onMissedSmokeReviewChange('no')}
                      className="w-4 h-4 text-green-500 focus:ring-green-500 border-gray-300 bg-white/20 mr-2"
                    />
                    <span className="text-sm font-medium text-white">
                      No{' '}
                      <kbd className="ml-1 px-1 py-0.5 bg-white/20 rounded text-xs font-mono">
                        N
                      </kbd>
                    </span>
                  </label>
                  <button
                    onClick={() => setShowInstructionsModal(true)}
                    className="p-1.5 hover:bg-white/20 rounded transition-colors"
                    title="Show review instructions"
                  >
                    <Info className="w-4 h-4 text-white" />
                  </button>
                </div>
              )}

              {/* Right - Predictions + sibling toggle */}
              <div className="flex-1 flex items-center justify-end space-x-3">
                <div className="flex items-center space-x-2">
                  <Eye className="w-4 h-4" />
                  {hasObjectOverlays ? (
                    <span className="text-xs">
                      {objectOverlays!.length} object{objectOverlays!.length !== 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="text-xs">
                      {currentDetection.algo_predictions?.predictions?.length || 0} prediction
                      {currentDetection.algo_predictions?.predictions?.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {!hasObjectOverlays &&
                  (currentDetection.others_bboxes?.predictions?.length || 0) > 0 && (
                    <label className="flex items-center cursor-pointer hover:bg-white/10 px-2 py-1 rounded transition-colors">
                      <input
                        type="checkbox"
                        checked={showSiblingBboxes}
                        onChange={e => setShowSiblingBboxes(e.target.checked)}
                        className="w-3.5 h-3.5 mr-2 accent-gray-300"
                      />
                      <span className="text-xs">
                        {currentDetection.others_bboxes?.predictions?.length} sibling
                        {(currentDetection.others_bboxes?.predictions?.length || 0) > 1 ? 's' : ''}
                      </span>
                    </label>
                  )}
              </div>
            </div>

            {/* Row 2 - Player Controls */}
            <div className="flex items-center space-x-4">
              {/* Play/Pause Button */}
              <button
                onClick={isPlaying ? onPause : onPlay}
                className="flex-shrink-0 p-2 bg-white/20 text-white rounded-full hover:bg-white/30 transition-colors border border-white/30"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>

              {/* Frame Navigation */}
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => onSeek(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  className="p-1 text-white hover:text-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  title="Previous frame (←)"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onSeek(Math.min(detections.length - 1, currentIndex + 1))}
                  disabled={currentIndex === detections.length - 1}
                  className="p-1 text-white hover:text-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  title="Next frame (→)"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>

              {/* Progress Slider */}
              <div className="flex-1 flex items-center space-x-3">
                <div className="flex-1 relative">
                  <input
                    ref={sliderRef}
                    type="range"
                    min="0"
                    max={detections.length - 1}
                    value={currentIndex}
                    onChange={handleSliderChange}
                    onMouseDown={handleSliderMouseDown}
                    onMouseUp={handleSliderMouseUp}
                    className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                    style={{
                      background: `linear-gradient(to right, #ffffff 0%, #ffffff ${(currentIndex / (detections.length - 1)) * 100}%, rgba(255,255,255,0.2) ${(currentIndex / (detections.length - 1)) * 100}%, rgba(255,255,255,0.2) 100%)`,
                    }}
                  />
                </div>
              </div>

              {/* Frame Counter */}
              <div className="text-xs text-white/80">
                <span className="font-mono">
                  {currentIndex + 1} / {detections.length}
                </span>
              </div>

              {/* Speed Control */}
              <div className="flex items-center space-x-2">
                <span className="text-xs text-white/70">Speed:</span>
                <select
                  value={playbackSpeed}
                  onChange={e => onSpeedChange(parseFloat(e.target.value))}
                  className="text-xs border border-white/30 rounded px-2 py-1 bg-black/40 text-white"
                >
                  {speedOptions.map(speed => (
                    <option key={speed} value={speed} className="bg-black text-white">
                      {speed}x
                    </option>
                  ))}
                </select>
              </div>

              {/* Fullscreen Toggle */}
              {onToggleFullscreen && (
                <button
                  onClick={onToggleFullscreen}
                  className="flex-shrink-0 p-2 text-white hover:text-gray-300 border border-white/30 rounded-md hover:bg-white/10"
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen the player'}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Instructions Modal */}
      <MissedSmokeInstructionsModal
        isOpen={showInstructionsModal}
        onClose={() => setShowInstructionsModal(false)}
      />

      {/* Custom slider styles */}
      <style>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          border: 2px solid rgba(0,0,0,0.2);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }
        
        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          border: 2px solid rgba(0,0,0,0.2);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }
      `}</style>
    </div>
  );
}
