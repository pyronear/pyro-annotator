import { useState } from 'react';
import GuideModulePage from '@/components/guide/GuideModulePage';
import { StartAnnotating } from '@/components/guide/NextSteps';
import TrainingVideo from '@/components/guide/TrainingVideo';
import { CLASSIFICATION_MODULE } from '@/components/guide/guideModules';
import { ROUTES } from '@/utils/routes';

/** YouTube id of the classification training video. */
export const CLASSIFICATION_VIDEO_ID = '3WAWzFRFzzQ';

/**
 * /guide/classification — the classification training: a video to watch to
 * the end before the "I have read it" button unlocks.
 */
export default function GuideClassificationPage() {
  const [videoWatched, setVideoWatched] = useState(false);

  return (
    <GuideModulePage
      module={CLASSIFICATION_MODULE}
      requirement={{ met: videoWatched, hint: 'Watch the whole video to confirm.' }}
      afterConfirm={
        <StartAnnotating
          message="You're ready — go start classifying!"
          label="Start classifying"
          to={ROUTES.CLASSIFY}
          tone="ember"
        />
      }
    >
      <p className="mb-6 font-body text-body leading-relaxed text-char">
        {CLASSIFICATION_MODULE.summary}
      </p>
      <TrainingVideo
        videoId={CLASSIFICATION_VIDEO_ID}
        title="Classification training video"
        watched={videoWatched}
        onWatched={() => setVideoWatched(true)}
      />
    </GuideModulePage>
  );
}
