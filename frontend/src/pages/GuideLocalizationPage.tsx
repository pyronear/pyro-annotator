import GuideModulePage from '@/components/guide/GuideModulePage';
import LocalizationExercise from '@/components/guide/LocalizationExercise';
import { StartAnnotating } from '@/components/guide/NextSteps';
import { LOCALIZATION_MODULE } from '@/components/guide/guideModules';
import { LOCALIZATION_EXERCISES, PASS_MARK } from '@/components/guide/localizationExercises';
import { useAuthStore } from '@/store/useAuthStore';
import { ROUTES } from '@/utils/routes';

/**
 * /guide/localization — the localization training: draw a box on five
 * reference frames, pass with at least `PASS_MARK` matches. Passing is the
 * confirmation, so this page has no "I have read it" button.
 */
export default function GuideLocalizationPage() {
  const { canLocalize } = useAuthStore();

  return (
    <GuideModulePage module={LOCALIZATION_MODULE}>
      <p className="font-body text-body leading-relaxed text-char">{LOCALIZATION_MODULE.summary}</p>
      <p className="mb-6 mt-2 font-body text-detail text-haze">
        Draw one box around the smoke on each of the {LOCALIZATION_EXERCISES.length} images, then
        check it against the expected box. Get {PASS_MARK} of them right to pass.
      </p>
      <LocalizationExercise
        afterPass={
          // The Localize queue is gated by can_localize; send the others to Classify.
          canLocalize() ? (
            <StartAnnotating
              message="Go start localizing!"
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
      />
    </GuideModulePage>
  );
}
