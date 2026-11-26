import { forwardRef, useEffect, useRef, useState } from 'react';
import { celebrate } from '@/components/guide/celebrate';

/**
 * A finished training: a pine tick that pops in and draws itself, a message,
 * then the next step fading up below. Shared by the "I have read it" button
 * and the localization exercise's pass screen.
 */
export const TrainingDone = forwardRef<
  HTMLDivElement,
  { message: string; children: React.ReactNode }
>(function TrainingDone({ message, children }, ref) {
  return (
    <div ref={ref} role="status" className="flex flex-col items-center gap-4 pb-2 text-center">
      <div className="flex items-center gap-3">
        <span
          data-testid="read-tick"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-pine animate-tick-pop motion-reduce:animate-none"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden>
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="white"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={24}
              className="animate-tick-draw motion-reduce:animate-none"
            />
          </svg>
        </span>
        <span className="font-body text-body font-semibold text-pine">{message}</span>
      </div>
      <div className="w-full animate-fade-up motion-reduce:animate-none">{children}</div>
    </div>
  );
});

export interface ReadConfirmationProps {
  /** What the reader sees once they have confirmed: the next step(s). */
  afterConfirm: React.ReactNode;
  /**
   * An extra condition on top of reaching the end of the page, e.g. having
   * watched the page's video. `hint` says what is still missing.
   */
  requirement?: { met: boolean; hint: string };
  /** Called once, when the reader confirms: records the module as done. */
  onConfirm?: () => void;
}

/**
 * The "I have read it" button at the end of a guide page.
 *
 * It only enables once the end of the page has been on screen: a sentinel
 * just above the button is watched with an IntersectionObserver against the
 * viewport, which also accounts for the app's own scroll container (the
 * layout's <main>), so this works without knowing which element scrolls. A
 * page short enough to need no scroll shows the sentinel straight away. A
 * page can add its own `requirement` (the classification video).
 *
 * The click fires confetti and turns the button into a pine tick, then shows
 * `afterConfirm`, and calls `onConfirm` (the module page records the module
 * as done there, for the tick on the guide hub).
 */
export default function ReadConfirmation({
  afterConfirm,
  requirement,
  onConfirm,
}: ReadConfirmationProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || reachedEnd) return;
    if (typeof IntersectionObserver === 'undefined') {
      setReachedEnd(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setReachedEnd(true);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [reachedEnd]);

  const requirementMet = requirement?.met ?? true;
  const canConfirm = reachedEnd && requirementMet;
  const hint = !requirementMet
    ? requirement?.hint
    : !reachedEnd
      ? 'Scroll to the end of the page to confirm.'
      : null;

  const handleConfirm = () => {
    celebrate(buttonRef.current);
    setConfirmed(true);
    onConfirm?.();
  };

  // The next step renders below the fold on long pages: bring it into view.
  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => {
      statusRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }, 450);
    return () => clearTimeout(timer);
  }, [confirmed]);

  return (
    <div className="mt-10 border-t border-line pt-6">
      <div ref={sentinelRef} aria-hidden />
      {confirmed ? (
        <TrainingDone ref={statusRef} message="Done — nice work!">
          {afterConfirm}
        </TrainingDone>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {hint && <span className="font-body text-detail text-haze">{hint}</span>}
          <button
            ref={buttonRef}
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
          >
            I have read it
          </button>
        </div>
      )}
    </div>
  );
}
