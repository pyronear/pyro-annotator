import { useState } from 'react';
import ClassificationExercise from '@/components/guide/ClassificationExercise';
import GuideModulePage from '@/components/guide/GuideModulePage';
import { StartAnnotating } from '@/components/guide/NextSteps';
import TrainingVideo from '@/components/guide/TrainingVideo';
import { CLASSIFICATION_MODULE } from '@/components/guide/guideModules';
import { CLASSIFICATION_EXERCISES, PASS_MARK } from '@/components/guide/classificationExercises';
import { useIsModuleCompleted, useMarkModuleCompleted } from '@/store/useGuideProgressStore';
import { ROUTES } from '@/utils/routes';

/** Served from frontend/public/guide/. */
export const CLASSIFICATION_VIDEO_SRC = '/guide/classification-training.mp4';

/**
 * /guide/classification — the classification training: a video, then five
 * reference alerts to classify in a replica of the classify cockpit. The
 * exercise unlocks once the video has been watched to the end (or straight
 * away for someone who already passed). Passing it (`PASS_MARK` validated
 * alerts) is the confirmation, so this page has no "I have read it" button.
 */
export default function GuideClassificationPage() {
  const [videoWatched, setVideoWatched] = useState(false);
  const markCompleted = useMarkModuleCompleted(CLASSIFICATION_MODULE.href);
  const alreadyPassed = useIsModuleCompleted(CLASSIFICATION_MODULE.href);
  const unlocked = videoWatched || alreadyPassed;

  return (
    <GuideModulePage
      module={CLASSIFICATION_MODULE}
      wide={
        unlocked && (
          <ClassificationExercise
            onPass={markCompleted}
            afterPass={
              <StartAnnotating
                message="Go start classifying!"
                label="Start classifying"
                to={ROUTES.CLASSIFY}
                tone="ember"
              />
            }
          />
        )
      }
    >
      <p className="mb-6 font-body text-body leading-relaxed text-char">
        {CLASSIFICATION_MODULE.summary}
      </p>
      <TrainingVideo
        src={CLASSIFICATION_VIDEO_SRC}
        title="Classification training video"
        watched={videoWatched}
        onWatched={() => setVideoWatched(true)}
      />
      <h2 className="mt-10 font-display text-heading font-semibold text-char">Your turn</h2>
      <p className="mt-2 font-body text-detail text-haze">
        Classify the {CLASSIFICATION_EXERCISES.length} alerts below just as you would in the
        Classify queue. An alert is validated when every object and the missed-smoke answer are
        right. Validate {PASS_MARK} of them to pass.
      </p>
    </GuideModulePage>
  );
}
