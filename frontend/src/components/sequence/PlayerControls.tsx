import { useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, RotateCcw } from 'lucide-react';

interface PlayerControlsProps {
  totalFrames: number;
  currentIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: number) => void;
  onReset: () => void;
  className?: string;
}

export default function PlayerControls({
  totalFrames,
  currentIndex,
  isPlaying,
  playbackSpeed,
  onPlay,
  onPause,
  onSeek,
  onSpeedChange,
  onReset,
  className = ''
}: PlayerControlsProps) {
  // const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef<HTMLInputElement>(null);

  // Handle keyboard shortcuts
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
          onSeek(Math.min(totalFrames - 1, currentIndex + 1));
          break;
        case ',':
          e.preventDefault();
          onSeek(Math.max(0, currentIndex - 1));
          break;
        case '.':
          e.preventDefault();
          onSeek(Math.min(totalFrames - 1, currentIndex + 1));
          break;
        case '0':
        case 'Home':
          e.preventDefault();
          onSeek(0);
          break;
        case 'End':
          e.preventDefault();
          onSeek(totalFrames - 1);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, currentIndex, totalFrames, onPlay, onPause, onSeek]);

  const formatTime = (index: number) => {
    const minutes = Math.floor(index / 60);
    const seconds = index % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

  return (
    <div className={`bg-gray-50 border-t border-gray-200 p-4 ${className}`}>
      <div className="flex items-center space-x-4">
        {/* Play/Pause Button */}
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="flex-shrink-0 p-2 bg-primary-600 text-white rounded-full hover:bg-primary-700 transition-colors"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5" />
          ) : (
            <Play className="w-5 h-5 ml-0.5" />
          )}
        </button>

        {/* Frame Navigation */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => onSeek(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="p-1 text-gray-600 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed"
            title="Previous frame (←)"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() => onSeek(Math.min(totalFrames - 1, currentIndex + 1))}
            disabled={currentIndex === totalFrames - 1}
            className="p-1 text-gray-600 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed"
            title="Next frame (→)"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Progress Slider */}
        <div className="flex-1 flex items-center space-x-3">
          <span className="text-sm text-gray-600 font-mono min-w-[3rem]">
            {formatTime(currentIndex)}
          </span>
          
          <div className="flex-1 relative">
            <input
              ref={sliderRef}
              type="range"
              min="0"
              max={totalFrames - 1}
              value={currentIndex}
              onChange={handleSliderChange}
              onMouseDown={handleSliderMouseDown}
              onMouseUp={handleSliderMouseUp}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, #2563eb 0%, #2563eb ${(currentIndex / (totalFrames - 1)) * 100}%, #e5e7eb ${(currentIndex / (totalFrames - 1)) * 100}%, #e5e7eb 100%)`
              }}
            />
          </div>
          
          <span className="text-sm text-gray-600 font-mono min-w-[3rem]">
            {formatTime(totalFrames - 1)}
          </span>
        </div>

        {/* Frame Counter */}
        <div className="flex items-center space-x-2 text-sm text-gray-600">
          <span className="font-mono">
            {currentIndex + 1} / {totalFrames}
          </span>
        </div>

        {/* Speed Control */}
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-500">Speed:</span>
          <select
            value={playbackSpeed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
          >
            {speedOptions.map(speed => (
              <option key={speed} value={speed}>
                {speed}x
              </option>
            ))}
          </select>
        </div>

        {/* Reset Button */}
        <button
          onClick={onReset}
          className="flex-shrink-0 p-2 text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50"
          title="Reset to beginning"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Keyboard Shortcuts Hint */}
      <div className="mt-2 text-xs text-gray-500 text-center">
        <span>Space: Play/Pause • ←/→: Frame by frame • Home/End: First/Last frame</span>
      </div>

      {/* Custom slider styles */}
      <style>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #2563eb;
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #2563eb;
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
      `}</style>
    </div>
  );
}