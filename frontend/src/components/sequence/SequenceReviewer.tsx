import { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
// import { Detection } from '@/types/api';
import { useSequenceDetections } from '@/hooks/useSequenceDetections';
import SequencePlayer from './SequencePlayer';

interface SequenceReviewerProps {
  sequenceId: number;
  missedSmokeReview: 'yes' | 'no' | null;
  onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
  className?: string;
}

export default function SequenceReviewer({
  sequenceId,
  missedSmokeReview,
  onMissedSmokeReviewChange,
  className = ''
}: SequenceReviewerProps) {
  // Playback state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutoStarted = useRef(false);

  // Fetch sequence detections
  const { data: detections, isLoading, error } = useSequenceDetections(sequenceId);
  
  // Track if images are preloaded (we'll get this from the player)
  const [imagesPreloaded, setImagesPreloaded] = useState(false);

  // Auto-start playing once images are preloaded (only once)
  useEffect(() => {
    if (imagesPreloaded && detections && detections.length > 0 && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      setIsPlaying(true);
    }
  }, [imagesPreloaded, detections]);

  // Reset auto-start flag when sequence changes
  useEffect(() => {
    hasAutoStarted.current = false;
    setImagesPreloaded(false);
    setIsPlaying(false);
    setCurrentIndex(0);
  }, [sequenceId]);

  // Auto-play functionality with looping
  useEffect(() => {
    if (isPlaying && detections && detections.length > 0) {
      playIntervalRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          // Loop back to start when reaching the end
          if (prev >= detections.length - 1) {
            return 0;
          }
          return prev + 1;
        });
      }, 1000 / playbackSpeed);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, detections]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  const handlePlay = () => {
    if (!detections || detections.length === 0) return;
    if (currentIndex >= detections.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleSeek = (index: number) => {
    if (!detections) return;
    // Pause auto-play when manually seeking
    setIsPlaying(false);
    const clampedIndex = Math.max(0, Math.min(detections.length - 1, index));
    setCurrentIndex(clampedIndex);
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
  };

  if (isLoading) {
    return (
      <div className={`bg-white border border-gray-200 rounded-lg p-8 ${className}`}>
        <div className="flex items-center justify-center">
          <div className="flex items-center space-x-3">
            <div className="animate-spin w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full"></div>
            <span className="text-sm text-gray-600">Loading sequence detections...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-white border border-gray-200 rounded-lg p-8 ${className}`}>
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-900 mb-2">
            Failed to Load Sequence
          </p>
          <p className="text-gray-600">
            Could not fetch detections for this sequence. Please try again.
          </p>
          <p className="text-xs text-red-600 mt-2">
            Error: {String(error)}
          </p>
        </div>
      </div>
    );
  }

  if (!detections || detections.length === 0) {
    return (
      <div className={`bg-white border border-gray-200 rounded-lg p-8 ${className}`}>
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-900 mb-2">
            No Detections Found
          </p>
          <p className="text-gray-600">
            This sequence doesn't contain any detections to review for missed smoke.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Integrated Player with Controls */}
      <SequencePlayer
        detections={detections}
        currentIndex={currentIndex}
        onIndexChange={setCurrentIndex}
        onPreloadComplete={() => setImagesPreloaded(true)}
        missedSmokeReview={missedSmokeReview}
        onMissedSmokeReviewChange={onMissedSmokeReviewChange}
        // Player controls props
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeek={handleSeek}
        onSpeedChange={handleSpeedChange}
        onReset={handleReset}
      />
    </div>
  );
}