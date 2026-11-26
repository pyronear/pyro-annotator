import { Check, X } from 'lucide-react';

/**
 * Pieces shared by the guide's exercises (localization, classification):
 * the progress dots above the stage and the tick or cross badge.
 */

export function ProgressDots({
  total,
  current,
  results,
  itemLabel = 'Image',
  rightWord = 'match',
  wrongWord = 'miss',
}: {
  total: number;
  current: number;
  results: { matched: boolean }[];
  /** e.g. "Image" → "Image 2: match". */
  itemLabel?: string;
  rightWord?: string;
  wrongWord?: string;
}) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {Array.from({ length: total }, (_, i) => {
        const r = results[i];
        const label = r
          ? `${itemLabel} ${i + 1}: ${r.matched ? rightWord : wrongWord}`
          : `${itemLabel} ${i + 1}: ${i === current ? 'current' : 'to do'}`;
        return (
          <li
            key={i}
            aria-label={label}
            className={`flex h-5 w-5 items-center justify-center rounded-full ${
              r
                ? r.matched
                  ? 'bg-pine text-white'
                  : 'bg-signal text-white'
                : i === current
                  ? 'border-2 border-pine bg-paper'
                  : 'border border-line bg-paper'
            }`}
          >
            {r &&
              (r.matched ? (
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
              ) : (
                <X className="h-3 w-3" strokeWidth={3} aria-hidden />
              ))}
          </li>
        );
      })}
    </ol>
  );
}

/** The big tick or cross over the corner of the stage once an answer is checked. */
export function VerdictBadge({
  matched,
  small = false,
  rightLabel = 'Match',
  wrongLabel = 'Not a match',
}: {
  matched: boolean;
  small?: boolean;
  rightLabel?: string;
  wrongLabel?: string;
}) {
  const Icon = matched ? Check : X;
  return (
    <span
      data-testid={matched ? 'verdict-tick' : 'verdict-cross'}
      aria-label={matched ? rightLabel : wrongLabel}
      role="img"
      className={`absolute z-40 flex items-center justify-center rounded-full text-white ring-2 ring-paper animate-tick-pop motion-reduce:animate-none ${
        matched ? 'bg-pine' : 'bg-signal'
      } ${small ? 'right-1.5 top-1.5 h-6 w-6' : 'left-5 top-5 h-11 w-11'}`}
    >
      <Icon className={small ? 'h-3.5 w-3.5' : 'h-6 w-6'} strokeWidth={3} aria-hidden />
    </span>
  );
}
