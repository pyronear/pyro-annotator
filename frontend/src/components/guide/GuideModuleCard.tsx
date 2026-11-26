import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import ComingSoonBadge from '@/components/guide/ComingSoonBadge';
import { TONE_TEXT, type GuideModule } from '@/components/guide/guideModules';

function CardHeader({ module }: { module: GuideModule }) {
  return (
    <>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span
          className={`font-data text-eyebrow font-medium uppercase tracking-eyebrow ${TONE_TEXT[module.tone]}`}
        >
          {module.eyebrow}
        </span>
        {module.comingSoon && <ComingSoonBadge />}
      </div>
      <h2 className="font-display text-heading font-semibold text-char">{module.title}</h2>
    </>
  );
}

function CardDetails({ module }: { module: GuideModule }) {
  return (
    <>
      <p className="mt-1 flex-1 font-body text-detail leading-relaxed text-haze">
        {module.summary}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <span className="font-data text-eyebrow text-haze">{module.duration}</span>
        <span className="font-body text-detail text-haze group-hover:text-char">Open →</span>
      </div>
    </>
  );
}

/**
 * One module card on the user guide hub. A locked card is not clickable: its
 * eyebrow and title stay sharp, so the user sees what classifying unlocks,
 * and the rest is blurred under a lock icon.
 */
export default function GuideModuleCard({
  module,
  locked = false,
}: {
  module: GuideModule;
  locked?: boolean;
}) {
  if (locked) {
    return (
      <div
        role="group"
        aria-label={`${module.title} (locked)`}
        aria-disabled="true"
        className="flex h-full cursor-not-allowed flex-col rounded-card border border-line bg-paper px-[22px] py-5"
      >
        <CardHeader module={module} />
        <div className="relative flex flex-1 flex-col">
          <div aria-hidden="true" className="flex flex-1 select-none flex-col blur-sm">
            <CardDetails module={module} />
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Lock className="h-6 w-6 text-haze" aria-hidden="true" />
            <span className="font-body text-detail font-semibold text-haze">
              Keep classifying to unlock
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Link
      to={module.href}
      className="group flex h-full flex-col rounded-card border border-line bg-paper px-[22px] py-5 transition-colors hover:border-haze focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
    >
      <CardHeader module={module} />
      <CardDetails module={module} />
    </Link>
  );
}
