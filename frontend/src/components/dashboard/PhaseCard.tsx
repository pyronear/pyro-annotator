import { Link } from 'react-router-dom';

export interface PhaseCardProps {
  pass: '01' | '02';
  tone: 'ember' | 'pine';
  passLabel: string;
  title: string;
  description: string;
  todo: number;
  done: number;
  doneNoun: string;
  ctaLabel: string;
  ctaTo: string;
  reviewLabel: string;
  reviewTo: string;
  isLoading: boolean;
  /** Optional alternate entry point (e.g. group labeling); hidden when count is 0. */
  secondaryLink?: { label: string; to: string; count: number };
}

const TONE = {
  ember: { text: 'text-ember', bg: 'bg-ember', dot: 'bg-ember' },
  pine: { text: 'text-pine', bg: 'bg-pine', dot: 'bg-pine' },
} as const;

export default function PhaseCard({
  pass,
  tone,
  passLabel,
  title,
  description,
  todo,
  done,
  doneNoun,
  ctaLabel,
  ctaTo,
  reviewLabel,
  reviewTo,
  isLoading,
  secondaryLink,
}: PhaseCardProps) {
  const t = TONE[tone];
  const total = todo + done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex-1 rounded-[10px] border border-line bg-paper px-[22px] py-5">
      <div
        className={`mb-2.5 flex items-center gap-2 font-data text-[10.5px] font-medium uppercase tracking-[0.14em] ${t.text}`}
      >
        <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden />
        Pass {pass} — {passLabel}
      </div>
      <h2 className="font-display text-[18.5px] font-semibold text-char">{title}</h2>
      <p className="mb-4 font-body text-[12.5px] text-haze">{description}</p>
      {isLoading ? (
        <div className="h-10 w-24 animate-pulse rounded bg-ash" />
      ) : (
        <div className={`font-data text-[38px] font-semibold leading-none ${t.text}`}>
          {todo.toLocaleString()}
          <span className="ml-1.5 font-body text-xs font-normal text-haze">to do</span>
        </div>
      )}
      <div
        className="mb-1.5 mt-3.5 h-1 overflow-hidden rounded-sm bg-ash"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${passLabel} progress`}
      >
        <div className={`h-full ${t.bg}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mb-3.5 font-body text-[11.5px] text-haze">
        {done.toLocaleString()} {doneNoun} so far
      </p>
      <Link
        to={ctaTo}
        className={`block w-full rounded-lg ${t.bg} py-2.5 text-center font-body text-[13.5px] font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2`}
      >
        {ctaLabel}
      </Link>
      {secondaryLink && secondaryLink.count > 0 && (
        <Link
          to={secondaryLink.to}
          className="mt-2.5 block text-center font-body text-[12.5px] text-haze hover:text-char"
        >
          {secondaryLink.label} ·{' '}
          <span className="font-semibold text-char">{secondaryLink.count.toLocaleString()}</span> →
        </Link>
      )}
      {/* No count on the review link: the review page opens on its own persisted
          stage tab, so any single number here would disagree with what it shows. */}
      <Link
        to={reviewTo}
        className="mt-2.5 block text-center font-body text-[12.5px] text-haze hover:text-char"
      >
        {reviewLabel} →
      </Link>
    </div>
  );
}
