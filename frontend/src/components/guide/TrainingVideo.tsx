import { useRef } from 'react';

interface TrainingVideoProps {
  src: string;
  title: string;
  watched: boolean;
  onWatched: () => void;
}

/**
 * A training video that has to be watched to the end.
 *
 * Seeking back is free, seeking forward is capped at the furthest point
 * already played, so "watched" means the video reached its end by playing
 * through it, not by dragging the playhead there.
 */
export default function TrainingVideo({ src, title, watched, onWatched }: TrainingVideoProps) {
  const furthestRef = useRef(0);

  const handleTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!video.seeking && video.currentTime > furthestRef.current) {
      furthestRef.current = video.currentTime;
    }
  };

  const handleSeeking = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!watched && video.currentTime > furthestRef.current + 0.5) {
      video.currentTime = furthestRef.current;
    }
  };

  return (
    <figure>
      <video
        src={src}
        title={title}
        aria-label={title}
        controls
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onSeeking={handleSeeking}
        onEnded={onWatched}
        className="w-full rounded-card border border-line bg-char"
      />
      <figcaption
        className={`mt-2 font-body text-detail ${watched ? 'text-pine' : 'text-haze'}`}
        aria-live="polite"
      >
        {watched
          ? '✓ Video watched — the exercise is unlocked below.'
          : 'Watch the whole video to unlock the exercise. You can rewind, but not skip ahead.'}
      </figcaption>
    </figure>
  );
}
