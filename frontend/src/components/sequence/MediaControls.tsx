import { Play, Pause, SkipBack, SkipForward, RotateCcw } from 'lucide-react';
import {
  PlaybackSpeed,
  DEFAULT_SPEED_OPTIONS,
  calculateSliderGradient,
  calculatePlaybackProgress,
  PlaybackState,
} from '@/utils/playback-calculations';

/**
 * Props for the MediaControls component
 */
interface MediaControlsProps {
  // Playback state
  readonly playbackState: PlaybackState;

  // Control handlers
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onSeek: (index: number) => void;
  readonly onSpeedChange: (speed: PlaybackSpeed) => void;
  readonly onReset: () => void;

  // Configuration
  readonly speedOptions?: readonly PlaybackSpeed[];
  readonly showFrameCounter?: boolean;
  readonly showTimeDisplay?: boolean;
  readonly showSpeedControl?: boolean;
  readonly showResetButton?: boolean;
  readonly frameRate?: number;

  // Styling
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/**
 * Pure media controls component for sequence playback
 *
 * Provides complete playback controls with:
 * - Play/pause toggle
 * - Frame navigation (previous/next)
 * - Progress slider with visual feedback
 * - Speed control dropdown
 * - Reset to beginning
 * - Time and frame counter displays
 *
 * @pure Component renders consistently for same props
 * @param props - Media control configuration
 * @returns JSX element for media controls
 *
 * @example
 * <MediaControls
 *   playbackState={{
 *     currentIndex: 45,
 *     totalFrames: 120,
 *     isPlaying: true,
 *     playbackSpeed: 1
 *   }}
 *   onPlay={handlePlay}
 *   onPause={handlePause}
 *   onSeek={handleSeek}
 *   onSpeedChange={handleSpeedChange}
 *   onReset={handleReset}
 * />
 */
export default function MediaControls({
  playbackState,
  onPlay,
  onPause,
  onSeek,
  onSpeedChange,
  onReset,
  speedOptions = DEFAULT_SPEED_OPTIONS,
  showFrameCounter = true,
  showTimeDisplay = true,
  showSpeedControl = true,
  showResetButton = true,
  frameRate = 1,
  className = '',
  'data-testid': testId,
}: MediaControlsProps) {
  const { currentIndex, totalFrames, isPlaying, playbackSpeed } = playbackState;

  // Calculate progress information using pure utility
  const progress = calculatePlaybackProgress(playbackState, frameRate);

  // Calculate slider background using pure utility
  const sliderBackground = calculateSliderGradient(progress.percentage);

  /**
   * Handles slider change events
   *
   * @pure Function processes slider input events
   */
  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newIndex = parseInt(event.target.value, 10);
    onSeek(newIndex);
  };

  /**
   * Handles slider mouse down to pause during scrubbing
   */
  const handleSliderMouseDown = () => {
    if (isPlaying) {
      onPause();
    }
  };

  /**
   * Handles speed selection changes
   */
  const handleSpeedChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newSpeed = parseFloat(event.target.value) as PlaybackSpeed;
    onSpeedChange(newSpeed);
  };

  /**
   * Handles navigation button clicks with bounds checking
   */
  const handlePrevious = () => {
    onSeek(Math.max(0, currentIndex - 1));
  };

  const handleNext = () => {
    onSeek(Math.min(totalFrames - 1, currentIndex + 1));
  };

  // Disable navigation at boundaries
  const isPreviousDisabled = currentIndex <= 0;
  const isNextDisabled = currentIndex >= totalFrames - 1;

  return (
    <div className={`flex items-center space-x-4 ${className}`} data-testid={testId}>
      {/* Play/Pause Button */}
      <button
        onClick={isPlaying ? onPause : onPlay}
        disabled={totalFrames <= 1}
        className="flex-shrink-0 p-2 bg-white/20 text-white rounded-full hover:bg-white/30 transition-colors border border-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
      >
        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
      </button>

      {/* Frame Navigation */}
      <div className="flex items-center space-x-1">
        <button
          onClick={handlePrevious}
          disabled={isPreviousDisabled}
          className="p-1 text-white hover:text-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
          title="Previous frame (←)"
          aria-label="Go to previous frame"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={handleNext}
          disabled={isNextDisabled}
          className="p-1 text-white hover:text-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
          title="Next frame (→)"
          aria-label="Go to next frame"
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>

      {/* Progress Slider */}
      <div className="flex-1 flex items-center space-x-3">
        {showTimeDisplay && (
          <span className="text-xs text-white/80 font-mono min-w-[3rem]">
            {progress.currentTime}
          </span>
        )}

        <div className="flex-1 relative">
          <input
            type="range"
            min="0"
            max={totalFrames - 1}
            value={currentIndex}
            onChange={handleSliderChange}
            onMouseDown={handleSliderMouseDown}
            disabled={totalFrames <= 1}
            className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: sliderBackground,
            }}
            aria-label="Playback progress"
            aria-valuemin={0}
            aria-valuemax={totalFrames - 1}
            aria-valuenow={currentIndex}
            aria-valuetext={`Frame ${progress.currentFrame} of ${progress.totalFrames}`}
          />
        </div>

        {showTimeDisplay && (
          <span className="text-xs text-white/80 font-mono min-w-[3rem]">{progress.totalTime}</span>
        )}
      </div>

      {/* Frame Counter */}
      {showFrameCounter && (
        <div className="text-xs text-white/80">
          <span className="font-mono">
            {progress.currentFrame} / {progress.totalFrames}
          </span>
        </div>
      )}

      {/* Speed Control */}
      {showSpeedControl && (
        <div className="flex items-center space-x-2">
          <span className="text-xs text-white/70">Speed:</span>
          <select
            value={playbackSpeed}
            onChange={handleSpeedChange}
            className="text-xs border border-white/30 rounded px-2 py-1 bg-black/40 text-white focus:ring-1 focus:ring-white/50"
            aria-label="Playback speed"
          >
            {speedOptions.map(speed => (
              <option key={speed} value={speed} className="bg-black text-white">
                {speed}x
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Reset Button */}
      {showResetButton && (
        <button
          onClick={onReset}
          disabled={currentIndex === 0}
          className="flex-shrink-0 p-2 text-white hover:text-gray-300 border border-white/30 rounded-md hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Reset to beginning"
          aria-label="Reset to first frame"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      )}

      {/* Custom slider styles - embedded for component isolation */}
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
        
        .slider:disabled::-webkit-slider-thumb {
          cursor: not-allowed;
          opacity: 0.5;
        }
        
        .slider:disabled::-moz-range-thumb {
          cursor: not-allowed;
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}

/**
 * Minimal media controls variant with only essential controls
 *
 * @pure Component renders minimal control set
 * @param props - Subset of MediaControlsProps
 * @returns JSX element for minimal controls
 *
 * @example
 * <MinimalMediaControls
 *   playbackState={playbackState}
 *   onPlay={onPlay}
 *   onPause={onPause}
 *   onSeek={onSeek}
 * />
 */
export function MinimalMediaControls(
  props: Pick<
    MediaControlsProps,
    'playbackState' | 'onPlay' | 'onPause' | 'onSeek' | 'className' | 'data-testid'
  >
) {
  return (
    <MediaControls
      {...props}
      onSpeedChange={() => {}} // No-op
      onReset={() => {}} // No-op
      speedOptions={[1]} // Only normal speed
      showFrameCounter={false}
      showTimeDisplay={false}
      showSpeedControl={false}
      showResetButton={false}
    />
  );
}

/**
 * Full-featured media controls with all options enabled
 *
 * @pure Component renders complete control set
 * @param props - Complete MediaControlsProps
 * @returns JSX element for full controls
 *
 * @example
 * <FullMediaControls
 *   playbackState={playbackState}
 *   onPlay={onPlay}
 *   onPause={onPause}
 *   onSeek={onSeek}
 *   onSpeedChange={onSpeedChange}
 *   onReset={onReset}
 * />
 */
export function FullMediaControls(props: MediaControlsProps) {
  return (
    <MediaControls
      {...props}
      showFrameCounter={true}
      showTimeDisplay={true}
      showSpeedControl={true}
      showResetButton={true}
    />
  );
}
