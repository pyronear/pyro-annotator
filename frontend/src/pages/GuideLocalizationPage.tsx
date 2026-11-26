import GuideModulePage from '@/components/guide/GuideModulePage';
import { StartAnnotating } from '@/components/guide/NextSteps';
import { LOCALIZATION_MODULE } from '@/components/guide/guideModules';
import { useAuthStore } from '@/store/useAuthStore';
import { ROUTES } from '@/utils/routes';

/**
 * /guide/localization — placeholder for the localization training
 * (pyronear/pyro-annotator#421). Confirming sends the reader to localize.
 */
export default function GuideLocalizationPage() {
  const { canLocalize } = useAuthStore();

  return (
    <GuideModulePage
      module={LOCALIZATION_MODULE}
      afterConfirm={
        // The Localize queue is gated by can_localize; send the others to Classify.
        canLocalize() ? (
          <StartAnnotating
            message="You're ready — go start localizing!"
            label="Start localizing"
            to={ROUTES.LOCALIZE}
            tone="pine"
          />
        ) : (
          <StartAnnotating
            message="Localizing isn't enabled on your account yet — classify in the meantime."
            label="Start classifying"
            to={ROUTES.CLASSIFY}
            tone="ember"
          />
        )
      }
    >
      <p className="font-body text-body leading-relaxed text-char">{LOCALIZATION_MODULE.summary}</p>
      <div className="mt-6 rounded-card border border-line bg-paper px-[22px] py-5">
        <h2 className="font-display text-heading font-semibold text-char">Coming soon</h2>
        <p className="mt-1 font-body text-detail text-haze">
          This training is being written. Until then, the basics cover everything you need to start.
        </p>
      </div>
    </GuideModulePage>
  );
}
