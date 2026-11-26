import { Link } from 'react-router-dom';
import GuideModuleCard from '@/components/guide/GuideModuleCard';
import {
  BASICS_MODULE,
  CLASSIFICATION_MODULE,
  LOCALIZATION_MODULE,
} from '@/components/guide/guideModules';
import { useAuthStore } from '@/store/useAuthStore';
import { guideAccessForUser } from '@/utils/guideAccess';
import { ROUTES } from '@/utils/routes';

/**
 * /guide — the user guide hub (the Pyronear training module): the basics
 * full width, then the two advanced trainings side by side. Each card opens
 * its own page under /guide/*. A training whose right is locked is blurred
 * with a lock icon; see utils/guideAccess.ts for the rules.
 */
export default function GuidePage() {
  const { user } = useAuthStore();
  const access = guideAccessForUser(user);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-title font-semibold tracking-tight text-char">
            Welcome to the Pyronear training module
          </h1>
          <p className="mb-8 mt-1 font-body text-body text-haze">
            Start with the basics, then go deeper on classifying or localizing smoke.
          </p>
        </div>
        {access.showSkip && (
          <Link
            to={ROUTES.CLASSIFY}
            className="inline-flex shrink-0 items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
          >
            Skip to classification →
          </Link>
        )}
      </div>

      <GuideModuleCard module={BASICS_MODULE} />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GuideModuleCard module={CLASSIFICATION_MODULE} locked={access.classifyLocked} />
        <GuideModuleCard module={LOCALIZATION_MODULE} locked={access.localizeLocked} />
      </div>
    </div>
  );
}
