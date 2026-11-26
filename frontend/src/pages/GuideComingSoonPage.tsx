import GuideModulePage from '@/components/guide/GuideModulePage';
import { CLASSIFICATION_MODULE, LOCALIZATION_MODULE } from '@/components/guide/guideModules';
import { useAuthStore } from '@/store/useAuthStore';
import { ROUTES } from '@/utils/routes';

interface GuideComingSoonPageProps {
  module: 'classification' | 'localization';
}

/**
 * /guide/classification and /guide/localization — placeholders for the
 * advanced trainings (pyronear/pyro-annotator#414 and #421). Each describes
 * what is coming and still carries the "I have read it" confirmation.
 */
export default function GuideComingSoonPage({ module }: GuideComingSoonPageProps) {
  const { canLocalize } = useAuthStore();
  const guideModule = module === 'classification' ? CLASSIFICATION_MODULE : LOCALIZATION_MODULE;
  // The Localize queue is gated by can_localize; send the others to Classify.
  const next =
    module === 'localization' && canLocalize()
      ? { label: 'Start localizing', to: ROUTES.LOCALIZE }
      : { label: 'Start classifying', to: ROUTES.CLASSIFY };

  return (
    <GuideModulePage module={guideModule} next={next}>
      <p className="font-body text-body leading-relaxed text-char">{guideModule.summary}</p>
      <div className="mt-6 rounded-card border border-line bg-paper px-[22px] py-5">
        <h2 className="font-display text-heading font-semibold text-char">Coming soon</h2>
        <p className="mt-1 font-body text-detail text-haze">
          This training is being written. Until then, the basics cover everything you need to start.
        </p>
      </div>
    </GuideModulePage>
  );
}
