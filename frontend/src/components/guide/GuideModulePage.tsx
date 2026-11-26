import { Link } from 'react-router-dom';
import ComingSoonBadge from '@/components/guide/ComingSoonBadge';
import ReadConfirmation, { type ReadConfirmationProps } from '@/components/guide/ReadConfirmation';
import { TONE_TEXT, type GuideModule } from '@/components/guide/guideModules';
import { useMarkModuleCompleted } from '@/store/useGuideProgressStore';
import { ROUTES } from '@/utils/routes';

interface GuideModulePageProps extends Partial<Omit<ReadConfirmationProps, 'onConfirm'>> {
  module: GuideModule;
  children: React.ReactNode;
  /**
   * Rendered below the reading column at full content width — for content
   * that needs the room, like the classification exercise's cockpit replica.
   */
  wide?: React.ReactNode;
}

/**
 * Shared frame of a guide module page: back link, header, body, confirmation.
 * Without `afterConfirm` there is no "I have read it" button: the page's own
 * content decides when the training is done (the localization exercise).
 */
export default function GuideModulePage({
  module,
  afterConfirm,
  requirement,
  children,
  wide,
}: GuideModulePageProps) {
  const markCompleted = useMarkModuleCompleted(module.href);
  return (
    <>
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
        {afterConfirm !== undefined && (
          <ReadConfirmation
            afterConfirm={afterConfirm}
            requirement={requirement}
            onConfirm={markCompleted}
          />
        )}
      </div>
      {wide && <div className="mx-auto mt-8 max-w-7xl">{wide}</div>}
    </>
  );
}
