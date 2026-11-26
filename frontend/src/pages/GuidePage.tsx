import GuideModuleCard from '@/components/guide/GuideModuleCard';
import {
  BASICS_MODULE,
  CLASSIFICATION_MODULE,
  LOCALIZATION_MODULE,
} from '@/components/guide/guideModules';

/**
 * /guide — the user guide hub (the Pyronear training module): the basics
 * full width, then the two advanced trainings side by side. Each card opens
 * its own page under /guide/*.
 */
export default function GuidePage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-title font-semibold tracking-tight text-char">
        Welcome to the Pyronear training module
      </h1>
      <p className="mb-8 mt-1 font-body text-body text-haze">
        Start with the basics, then go deeper on classifying or localizing smoke.
      </p>

      <GuideModuleCard module={BASICS_MODULE} />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GuideModuleCard module={CLASSIFICATION_MODULE} />
        <GuideModuleCard module={LOCALIZATION_MODULE} />
      </div>
    </div>
  );
}
