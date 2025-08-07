import { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { Detection } from '@/types/api';
import { useSequenceDetections } from '@/hooks/useSequenceDetections';
import SequencePlayer from './SequencePlayer';
import PlayerControls from './PlayerControls';
import MissedSmokePanel from './MissedSmokePanel';

interface SequenceReviewerProps {
  sequenceId: number;
  hasMissedSmoke: boolean;
  onMissedSmokeChange: (hasMissedSmoke: boolean) => void;
  className?: string;
}

export default function SequenceReviewer({
  sequenceId,
  hasMissedSmoke,
  onMissedSmokeChange,
  className = ''
}: SequenceReviewerProps) {
  // Playback state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isReviewComplete, setIsReviewComplete] = useState(false);
  
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch sequence detections
  const { data: detections, isLoading, error } = useSequenceDetections(sequenceId);

  // Auto-play functionality
  useEffect(() => {
    if (isPlaying && detections && detections.length > 0) {
      playIntervalRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= detections.length - 1) {
            setIsPlaying(false);
            return prev;
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

  const handleMarkReviewComplete = () => {
    setIsReviewComplete(true);
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
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              Sequence Review for Missed Smoke Detection
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Review all {detections.length} detection{detections.length !== 1 ? 's' : ''} in sequence to identify any missed smoke
            </p>
          </div>
          
          <div className="text-right">
            <div className="text-sm font-medium text-gray-900">
              {Math.round(((currentIndex + 1) / detections.length) * 100)}% Complete
            </div>
            <div className="text-xs text-gray-500">
              {currentIndex + 1} of {detections.length}
            </div>
          </div>
        </div>
        
        <div className="mt-3">
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div 
              className="bg-primary-600 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / detections.length) * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Player */}
      <SequencePlayer
        detections={detections}
        currentIndex={currentIndex}
        onIndexChange={setCurrentIndex}
      />

      {/* Controls */}
      <PlayerControls
        totalFrames={detections.length}
        currentIndex={currentIndex}
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeek={handleSeek}
        onSpeedChange={handleSpeedChange}
        onReset={handleReset}
      />

      {/* Missed Smoke Review Panel */}
      <MissedSmokePanel
        hasMissedSmoke={hasMissedSmoke}
        onMissedSmokeChange={onMissedSmokeChange}
        isReviewComplete={isReviewComplete}
        onMarkReviewComplete={handleMarkReviewComplete}
      />
    </div>
  );
}