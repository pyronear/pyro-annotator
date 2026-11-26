import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi, YT_STATE, type YouTubePlayer } from '@/components/guide/youtube';

interface TrainingVideoProps {
  /** The YouTube video id, e.g. `3WAWzFRFzzQ`. */
  videoId: string;
  title: string;
  watched: boolean;
  onWatched: () => void;
}

/** How far past the furthest watched point a jump counts as skipping ahead. */
const SKIP_TOLERANCE_S = 2;

/**
 * A YouTube training video that has to be watched to the end.
 *
 * Embedded through the IFrame Player API (privacy-enhanced youtube-nocookie
 * host) so the page can follow playback: while it plays, the furthest point
 * reached is tracked, and a jump ahead of it is snapped back. Rewinding is
 * free. Reaching the end that way marks the video as watched.
 */
export default function TrainingVideo({ videoId, title, watched, onWatched }: TrainingVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onWatchedRef = useRef(onWatched);
  onWatchedRef.current = onWatched;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let player: YouTubePlayer | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let furthest = 0;
    let done = false;
    let cancelled = false;

    // Called while playing and on every state change: either the playhead
    // moved forward normally (extend `furthest`) or it jumped ahead.
    const check = (p: YouTubePlayer) => {
      if (done) return;
      const current = p.getCurrentTime();
      if (current > furthest + SKIP_TOLERANCE_S) {
        p.seekTo(furthest, true);
      } else if (current > furthest) {
        furthest = current;
      }
    };

    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };

    loadYouTubeApi()
      .then(YT => {
        if (cancelled) return;
        // The API replaces the element it is given, so hand it a child.
        const mount = document.createElement('div');
        container.appendChild(mount);
        player = new YT.Player(mount, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: { rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onStateChange: ({ data, target }) => {
              if (data === YT_STATE.PLAYING) {
                stopPolling();
                poll = setInterval(() => check(target), 500);
              } else {
                stopPolling();
              }
              if (data === YT_STATE.ENDED && !done) {
                const duration = target.getDuration();
                if (furthest >= duration - SKIP_TOLERANCE_S - 1) {
                  done = true;
                  onWatchedRef.current();
                } else {
                  // Reached the end by jumping there: back to where they were.
                  target.seekTo(furthest, true);
                }
              }
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      stopPolling();
      player?.destroy();
      container.replaceChildren();
    };
  }, [videoId]);

  return (
    <figure>
      <div className="aspect-video w-full overflow-hidden rounded-card border border-line bg-char">
        {loadFailed ? (
          <div className="flex h-full items-center justify-center p-6 text-center font-body text-detail text-white">
            The video could not load. Check your connection, or open it on YouTube:&nbsp;
            <a
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {title}
            </a>
          </div>
        ) : (
          <div
            ref={containerRef}
            data-testid="training-video"
            aria-label={title}
            className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full"
          />
        )}
      </div>
      <figcaption
        className={`mt-2 font-body text-detail ${watched ? 'text-pine' : 'text-haze'}`}
        aria-live="polite"
      >
        {watched
          ? '✓ Video watched — you can now confirm below.'
          : 'Watch the whole video to unlock the confirmation. You can rewind, but not skip ahead.'}
      </figcaption>
    </figure>
  );
}
