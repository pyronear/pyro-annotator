import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import ComingSoonBadge from '@/components/guide/ComingSoonBadge';
import { TONE_TEXT, type GuideModule } from '@/components/guide/guideModules';
import { useIsModuleCompleted } from '@/store/useGuideProgressStore';

/**
 * One clickable module card on the user guide hub. A training the user has
 * finished shows a pine tick in its corner.
 */
export default function GuideModuleCard({ module }: { module: GuideModule }) {
  const completed = useIsModuleCompleted(module.href);
  return (
    <Link
      to={module.href}
      className="group flex h-full flex-col rounded-card border border-line bg-paper px-[22px] py-5 transition-colors hover:border-haze focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span
          className={`font-data text-eyebrow font-medium uppercase tracking-eyebrow ${TONE_TEXT[module.tone]}`}
        >
          {module.eyebrow}
        </span>
        {module.comingSoon && <ComingSoonBadge />}
        {completed && <CompletedTick />}
      </div>
      <h2 className="font-display text-heading font-semibold text-char">{module.title}</h2>
      <p className="mt-1 flex-1 font-body text-detail leading-relaxed text-haze">
        {module.summary}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <span className="font-data text-eyebrow text-haze">{module.duration}</span>
        <span className="font-body text-detail text-haze group-hover:text-char">Open →</span>
      </div>
    </Link>
  );
}

function CompletedTick() {
  return (
    <span
      data-testid="module-completed"
      className="inline-flex shrink-0 items-center gap-1.5 font-body text-detail font-semibold text-pine"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pine">
        <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden />
      </span>
      Done
    </span>
  );
}
