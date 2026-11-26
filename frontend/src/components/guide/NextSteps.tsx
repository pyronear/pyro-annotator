import { Link } from 'react-router-dom';
import { TONE_TEXT, type GuideModule } from '@/components/guide/guideModules';

const PRIMARY_BUTTON = {
  ember: 'bg-ember',
  pine: 'bg-pine',
} as const;

/** After a training module: "now go do it" with a single primary button. */
export function StartAnnotating({
  message,
  label,
  to,
  tone,
}: {
  message: string;
  label: string;
  to: string;
  tone: keyof typeof PRIMARY_BUTTON;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-pine-soft px-4 py-3 text-left">
      <span className="font-body text-body font-semibold text-pine">{message}</span>
      <Link
        to={to}
        className={`inline-flex items-center rounded-lg ${PRIMARY_BUTTON[tone]} px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2`}
      >
        {label} →
      </Link>
    </div>
  );
}

/** After the basics: point the reader to the advanced trainings. */
export function ExploreModules({ modules }: { modules: GuideModule[] }) {
  return (
    <div className="rounded-card border border-line bg-paper px-[22px] py-5 text-left">
      <p className="font-body text-body text-char">
        You know the basics. Keep going with the advanced trainings:
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {modules.map(module => (
          <Link
            key={module.href}
            to={module.href}
            className="group flex items-center justify-between rounded-lg border border-line px-4 py-3 transition-colors hover:border-haze hover:bg-ash"
          >
            <span>
              <span
                className={`block font-data text-eyebrow font-medium uppercase tracking-eyebrow ${TONE_TEXT[module.tone]}`}
              >
                {module.eyebrow}
              </span>
              <span className="block font-body text-sm font-semibold text-char">
                {module.title}
              </span>
              <span className="font-data text-eyebrow text-haze">{module.duration}</span>
            </span>
            <span className="pl-3 font-body text-detail text-haze group-hover:text-char">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
