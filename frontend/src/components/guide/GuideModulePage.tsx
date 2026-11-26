import { Link } from 'react-router-dom';
import ComingSoonBadge from '@/components/guide/ComingSoonBadge';
import ReadConfirmation, { type ReadConfirmationProps } from '@/components/guide/ReadConfirmation';
import { TONE_TEXT, type GuideModule } from '@/components/guide/guideModules';
import { ROUTES } from '@/utils/routes';

interface GuideModulePageProps {
  module: GuideModule;
  next: ReadConfirmationProps['next'];
  children: React.ReactNode;
}

/** Shared frame of a guide module page: back link, header, body, confirmation. */
export default function GuideModulePage({ module, next, children }: GuideModulePageProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <Link to={ROUTES.GUIDE} className="font-body text-detail text-haze hover:text-char">
        ← Back to user guide
      </Link>
      <div className="mt-4 flex items-center gap-3">
        <span
          className={`font-data text-eyebrow font-medium uppercase tracking-eyebrow ${TONE_TEXT[module.tone]}`}
        >
          {module.eyebrow}
        </span>
        {module.comingSoon && <ComingSoonBadge />}
      </div>
      <h1 className="mt-1 font-display text-title font-semibold tracking-tight text-char">
        {module.title}
      </h1>
      <p className="mb-8 mt-1 font-data text-eyebrow text-haze">{module.duration}</p>
      {children}
      <ReadConfirmation next={next} />
    </div>
  );
}
