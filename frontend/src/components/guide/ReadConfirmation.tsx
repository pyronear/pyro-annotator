import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

export interface ReadConfirmationProps {
  /** Where the reader goes once they have confirmed, e.g. the Classify queue. */
  next: { label: string; to: string };
}

/**
 * The "I have read it" button at the end of a guide page.
 *
 * It only enables once the end of the page has been on screen: a sentinel
 * just above the button is watched with an IntersectionObserver against the
 * viewport, which also accounts for the app's own scroll container (the
 * layout's <main>), so this works without knowing which element scrolls. A
 * page short enough to need no scroll shows the sentinel straight away, so
 * the button is enabled at once.
 *
 * Nothing is persisted yet: the click only swaps the button for a "you're
 * all set" message. Recording the training (pyronear/pyro-annotator#413) is
 * meant to hook into `handleConfirm`.
 */
export default function ReadConfirmation({ next }: ReadConfirmationProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
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

  const handleConfirm = () => setConfirmed(true);

  return (
    <div className="mt-10 border-t border-line pt-6">
      <div ref={sentinelRef} aria-hidden />
      {confirmed ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-pine-soft px-4 py-3"
        >
          <span className="font-body text-body font-semibold text-pine">
            You're all set — start annotating
          </span>
          <Link
            to={next.to}
            className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
          >
            {next.label} →
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!reachedEnd && (
            <span className="font-body text-detail text-haze">
              Scroll to the end of the page to confirm.
            </span>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!reachedEnd}
            className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
          >
            I have read it
          </button>
        </div>
      )}
    </div>
  );
}
