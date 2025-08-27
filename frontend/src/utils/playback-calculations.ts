/**
 * Pure utility functions for media playback calculations
 *
 * These functions provide mathematical operations for media player functionality
 * without any side effects or dependencies on React state or DOM elements.
 */

/**
 * Speed options for playback control
 *
 * @pure Constant array of supported playback speeds
 */
export const DEFAULT_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type PlaybackSpeed = (typeof DEFAULT_SPEED_OPTIONS)[number];

/**
 * Playback state interface for pure calculations
 */
export interface PlaybackState {
  readonly currentIndex: number;
  readonly totalFrames: number;
  readonly isPlaying: boolean;
  readonly playbackSpeed: PlaybackSpeed;
}

/**
 * Progress information for playback display
 */
export interface PlaybackProgress {
  readonly percentage: number;
  readonly currentTime: string;
  readonly totalTime: string;
  readonly remainingTime: string;
  readonly currentFrame: number;
  readonly totalFrames: number;
}

/**
 * Formats frame index to MM:SS time display
 *
 * @pure Function converts frame index to time string
 * @param frameIndex - Zero-based frame index
 * @param frameRate - Frames per second (defaults to 1 for sequence players)
 * @returns Time string in MM:SS format
 *
 * @example
 * formatFrameTime(125) // "2:05"
 * formatFrameTime(45) // "0:45"
 * formatFrameTime(0) // "0:00"
 */
export const formatFrameTime = (frameIndex: number, frameRate: number = 1): string => {
  const totalSeconds = Math.floor(frameIndex / frameRate);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Calculates playback progress information
 *
 * @pure Function computes all progress-related values
 * @param state - Current playback state
 * @param frameRate - Frames per second for time calculations
 * @returns Complete progress information
 *
 * @example
 * const progress = calculatePlaybackProgress({
 *   currentIndex: 30,
 *   totalFrames: 120,
 *   isPlaying: true,
 *   playbackSpeed: 1
 * });
 * // Returns: { percentage: 25, currentTime: "0:30", totalTime: "2:00", ... }
 */
export const calculatePlaybackProgress = (
  state: PlaybackState,
  frameRate: number = 1
): PlaybackProgress => {
  const { currentIndex, totalFrames } = state;

  // Calculate percentage (handle edge case of empty sequence)
  const percentage = totalFrames > 0 ? (currentIndex / (totalFrames - 1)) * 100 : 0;

  // Format time strings
  const currentTime = formatFrameTime(currentIndex, frameRate);
  const totalTime = formatFrameTime(totalFrames - 1, frameRate);

  // Calculate remaining time
  const remainingFrames = Math.max(0, totalFrames - 1 - currentIndex);
  const remainingTime = formatFrameTime(remainingFrames, frameRate);

  return {
    percentage,
    currentTime,
    totalTime,
    remainingTime,
    currentFrame: currentIndex + 1, // 1-based for display
    totalFrames,
  };
};

/**
 * Calculates next frame index for automatic playback
 *
 * @pure Function determines next playback position
 * @param currentIndex - Current frame index
 * @param totalFrames - Total number of frames
 * @param shouldLoop - Whether to loop back to start when reaching end
 * @returns Next frame index or null if playback should stop
 *
 * @example
 * calculateNextFrame(5, 10, false) // 6
 * calculateNextFrame(9, 10, false) // null (reached end)
 * calculateNextFrame(9, 10, true) // 0 (loop back)
 */
export const calculateNextFrame = (
  currentIndex: number,
  totalFrames: number,
  shouldLoop: boolean = true
): number | null => {
  if (totalFrames <= 1) return null;

  const nextIndex = currentIndex + 1;

  if (nextIndex >= totalFrames) {
    return shouldLoop ? 0 : null;
  }

  return nextIndex;
};

/**
 * Calculates previous frame index for navigation
 *
 * @pure Function determines previous playback position
 * @param currentIndex - Current frame index
 * @param totalFrames - Total number of frames
 * @param shouldLoop - Whether to loop to end when at beginning
 * @returns Previous frame index or null if at beginning without looping
 *
 * @example
 * calculatePreviousFrame(5, 10, false) // 4
 * calculatePreviousFrame(0, 10, false) // null (at beginning)
 * calculatePreviousFrame(0, 10, true) // 9 (loop to end)
 */
export const calculatePreviousFrame = (
  currentIndex: number,
  totalFrames: number,
  shouldLoop: boolean = false
): number | null => {
  if (totalFrames <= 1) return null;

  if (currentIndex <= 0) {
    return shouldLoop ? totalFrames - 1 : null;
  }

  return currentIndex - 1;
};

/**
 * Calculates frame interval in milliseconds based on playback speed
 *
 * @pure Function computes timing for playback intervals
 * @param speed - Playback speed multiplier
 * @param baseInterval - Base interval in milliseconds (default 100ms = 10 FPS)
 * @returns Interval in milliseconds for the given speed
 *
 * @example
 * calculatePlaybackInterval(1) // 100ms (normal speed)
 * calculatePlaybackInterval(2) // 50ms (double speed)
 * calculatePlaybackInterval(0.5) // 200ms (half speed)
 */
export const calculatePlaybackInterval = (
  speed: PlaybackSpeed,
  baseInterval: number = 100
): number => {
  return Math.round(baseInterval / speed);
};

/**
 * Validates and constrains frame index to valid range
 *
 * @pure Function ensures frame index is within bounds
 * @param frameIndex - Frame index to validate
 * @param totalFrames - Total number of frames
 * @returns Constrained frame index within valid range
 *
 * @example
 * constrainFrameIndex(5, 10) // 5 (valid)
 * constrainFrameIndex(-1, 10) // 0 (constrained to minimum)
 * constrainFrameIndex(15, 10) // 9 (constrained to maximum)
 */
export const constrainFrameIndex = (frameIndex: number, totalFrames: number): number => {
  if (totalFrames <= 0) return 0;
  return Math.max(0, Math.min(frameIndex, totalFrames - 1));
};

/**
 * Calculates playback speed from interval timing
 *
 * @pure Function reverse-calculates speed from timing
 * @param interval - Interval in milliseconds
 * @param baseInterval - Base interval in milliseconds
 * @returns Playback speed multiplier
 *
 * @example
 * calculateSpeedFromInterval(100, 100) // 1.0 (normal speed)
 * calculateSpeedFromInterval(50, 100) // 2.0 (double speed)
 */
export const calculateSpeedFromInterval = (
  interval: number,
  baseInterval: number = 100
): number => {
  if (interval <= 0) return 1;
  return baseInterval / interval;
};

/**
 * Finds the closest valid playback speed from available options
 *
 * @pure Function selects best matching speed option
 * @param targetSpeed - Desired speed value
 * @param availableOptions - Array of available speed options
 * @returns Closest available speed option
 *
 * @example
 * findClosestSpeed(1.3, DEFAULT_SPEED_OPTIONS) // 1.25
 * findClosestSpeed(0.6, DEFAULT_SPEED_OPTIONS) // 0.5
 */
export const findClosestSpeed = (
  targetSpeed: number,
  availableOptions: readonly PlaybackSpeed[] = DEFAULT_SPEED_OPTIONS
): PlaybackSpeed => {
  if (availableOptions.length === 0) return 1;

  return availableOptions.reduce((closest, current) => {
    const currentDiff = Math.abs(current - targetSpeed);
    const closestDiff = Math.abs(closest - targetSpeed);
    return currentDiff < closestDiff ? current : closest;
  });
};

/**
 * Calculates slider background gradient for progress visualization
 *
 * @pure Function creates CSS gradient string
 * @param progress - Progress percentage (0-100)
 * @param activeColor - Color for completed portion
 * @param inactiveColor - Color for remaining portion
 * @returns CSS linear-gradient string
 *
 * @example
 * calculateSliderGradient(25, '#ffffff', 'rgba(255,255,255,0.2)')
 * // "linear-gradient(to right, #ffffff 0%, #ffffff 25%, rgba(255,255,255,0.2) 25%, rgba(255,255,255,0.2) 100%)"
 */
export const calculateSliderGradient = (
  progress: number,
  activeColor: string = '#ffffff',
  inactiveColor: string = 'rgba(255,255,255,0.2)'
): string => {
  const constrainedProgress = Math.max(0, Math.min(100, progress));

  return `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${constrainedProgress}%, ${inactiveColor} ${constrainedProgress}%, ${inactiveColor} 100%)`;
};

/**
 * Calculates estimated playback duration at different speeds
 *
 * @pure Function estimates total playback time
 * @param totalFrames - Total number of frames
 * @param speed - Playback speed multiplier
 * @param frameRate - Frames per second
 * @returns Duration in milliseconds
 *
 * @example
 * calculatePlaybackDuration(120, 1, 1) // 120000ms (2 minutes at normal speed)
 * calculatePlaybackDuration(120, 2, 1) // 60000ms (1 minute at double speed)
 */
export const calculatePlaybackDuration = (
  totalFrames: number,
  speed: PlaybackSpeed,
  frameRate: number = 1
): number => {
  if (totalFrames <= 0 || speed <= 0) return 0;

  const baseInterval = 1000 / frameRate; // ms per frame
  const adjustedInterval = baseInterval / speed;

  return totalFrames * adjustedInterval;
};

/**
 * Detects if playback is looping back from end to beginning
 *
 * @pure Function identifies loop-back transitions
 * @param previousIndex - Previous frame index
 * @param currentIndex - Current frame index
 * @param totalFrames - Total number of frames
 * @returns True if this appears to be a loop-back transition
 *
 * @example
 * isLoopingBack(119, 0, 120) // true (jumped from near end to beginning)
 * isLoopingBack(5, 6, 120) // false (normal forward progression)
 */
export const isLoopingBack = (
  previousIndex: number,
  currentIndex: number,
  totalFrames: number
): boolean => {
  if (totalFrames <= 2) return false;

  // Consider it a loop-back if we jump from the last few frames to near the beginning
  const isNearEnd = previousIndex >= totalFrames - 2;
  const isNearBeginning = currentIndex <= 1;

  return isNearEnd && isNearBeginning;
};

/**
 * Calculates buffer progress for preloading visualization
 *
 * @pure Function computes buffer visualization data
 * @param loadedFrames - Number of frames loaded
 * @param totalFrames - Total number of frames
 * @param currentIndex - Current playback position
 * @returns Buffer progress information
 *
 * @example
 * calculateBufferProgress(50, 100, 25)
 * // { bufferPercentage: 50, isCurrentBuffered: true, bufferAhead: 25 }
 */
export const calculateBufferProgress = (
  loadedFrames: number,
  totalFrames: number,
  currentIndex: number
): {
  readonly bufferPercentage: number;
  readonly isCurrentBuffered: boolean;
  readonly bufferAhead: number;
} => {
  const bufferPercentage = totalFrames > 0 ? (loadedFrames / totalFrames) * 100 : 0;
  const isCurrentBuffered = currentIndex < loadedFrames;
  const bufferAhead = Math.max(0, loadedFrames - currentIndex - 1);

  return {
    bufferPercentage,
    isCurrentBuffered,
    bufferAhead,
  };
};
