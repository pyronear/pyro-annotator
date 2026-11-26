import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import GuideModulePage from '@/components/guide/GuideModulePage';
import { LOCALIZATION_MODULE } from '@/components/guide/guideModules';
import {
  LOCALIZE_TRAINING_ALERTS,
  TRAINING_PASS_MARK,
} from '@/components/guide/localize-training/trainingAlerts';
import { ROUTES } from '@/utils/routes';

const STEPS = [
  {
    title: 'Check the model’s boxes',
    body: 'Each alert opens like in Localize: every frame of the plume, with the box the model proposes drawn dashed.',
  },
  {
    title: 'Accept them, or fix the wrong ones',
    body: 'If they are right, Accept boxes. If not, open the frame: pick another box, draw a tight one yourself, or choose None where there is no smoke.',
  },
  {
    title: 'Submit and see if you were right',
    body: 'Each frame is checked against the validated answer: a tick or a cross, the expected box, and what to change.',
  },
];

/**
 * /guide/localization — what the localization training is, then into it.
 * Passing the training is the confirmation, so this page has no "I have read
 * it" button; the training itself lives at /guide/localization/practice.
 */
export default function GuideLocalizationPage() {
  return (
    <GuideModulePage module={LOCALIZATION_MODULE}>
      <p className="font-body text-body leading-relaxed text-char">{LOCALIZATION_MODULE.summary}</p>

      <div className="mt-6 rounded-card border border-line bg-paper px-[22px] py-5">
        <h2 className="font-display text-heading font-semibold text-char">How it works</h2>
        <ol className="mt-4 space-y-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pine-soft font-data text-xs font-semibold text-pine">
                {i + 1}
              </span>
              <div>
                <p className="font-body text-body font-semibold text-char">{step.title}</p>
                <p className="mt-0.5 font-body text-detail leading-relaxed text-haze">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 border-t border-line pt-4 font-body text-detail text-char">
          {LOCALIZE_TRAINING_ALERTS.length} real alerts. The model is not always right — get{' '}
          {TRAINING_PASS_MARK} of them right to pass.
        </p>
      </div>

      <div className="mt-6 flex justify-end">
        <Link
          to={ROUTES.GUIDE_LOCALIZATION_PRACTICE}
          className="inline-flex items-center gap-1.5 rounded-lg bg-pine px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
        >
          Start the training
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </GuideModulePage>
  );
}
