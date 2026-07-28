import SequencesPage from './SequencesPage';
import { ProcessingStage, ProcessingStageFilter, ProcessingStageStatus } from '@/types/api';
import { usePersistedTabState } from '@/hooks/usePersistedTabState';
import { ALL_CLASSIFIED_STAGES, getProcessingStageLabel } from '@/utils/processingStage';

interface SequencesPageWrapperProps {
  defaultProcessingStage?: ProcessingStageStatus;
}

const REVIEW_STAGES: ProcessingStage[] = ['seq_annotation_done', 'annotated'];

// 'all_classified' is a UI-only pseudo-stage mapping to ALL_CLASSIFIED_STAGES
type ReviewStageSelection = ProcessingStage | 'all_classified';

export default function SequencesPageWrapper({
  defaultProcessingStage,
}: SequencesPageWrapperProps) {
  const isReview = defaultProcessingStage === 'annotated';

  const [storedStage, setStage] = usePersistedTabState<ReviewStageSelection>(
    'sequences-review-stage-v2',
    'all_classified'
  );
  // localStorage may hold a stage that no longer exists (e.g. one retired
  // after being persisted); an unknown value would silently unfilter the list.
  const stage: ReviewStageSelection =
    storedStage === 'all_classified' || REVIEW_STAGES.includes(storedStage)
      ? storedStage
      : 'all_classified';

  if (!isReview) {
    return <SequencesPage defaultProcessingStage={defaultProcessingStage} />;
  }

  const effectiveStage: ProcessingStageFilter =
    stage === 'all_classified' ? ALL_CLASSIFIED_STAGES : stage;

  return (
    <SequencesPage
      defaultProcessingStage={effectiveStage}
      isReviewPage
      stageSelector={
        <div className="flex items-center space-x-2">
          <label htmlFor="review-stage" className="text-sm text-gray-700">
            Stage:
          </label>
          <select
            id="review-stage"
            value={stage}
            onChange={e => setStage(e.target.value as ReviewStageSelection)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="all_classified">All classified</option>
            {REVIEW_STAGES.map(s => (
              <option key={s} value={s}>
                {getProcessingStageLabel(s)}
              </option>
            ))}
          </select>
        </div>
      }
    />
  );
}
