import SequencesPage from './SequencesPage';
import { ProcessingStage, ProcessingStageStatus } from '@/types/api';
import { usePersistedTabState } from '@/hooks/usePersistedTabState';
import { getProcessingStageLabel } from '@/utils/processingStage';

interface SequencesPageWrapperProps {
  defaultProcessingStage?: ProcessingStageStatus;
}

const REVIEW_STAGES: ProcessingStage[] = ['seq_annotation_done', 'annotated'];

export default function SequencesPageWrapper({
  defaultProcessingStage,
}: SequencesPageWrapperProps) {
  const isReview = defaultProcessingStage === 'annotated';

  const [storedStage, setStage] = usePersistedTabState<ProcessingStage>(
    'classify-done-stage',
    'seq_annotation_done'
  );
  // localStorage may hold a stage that no longer exists (e.g. the retired
  // in_review/needs_manual); an unknown value would silently unfilter the list.
  const stage = REVIEW_STAGES.includes(storedStage) ? storedStage : 'seq_annotation_done';

  if (!isReview) {
    return <SequencesPage defaultProcessingStage={defaultProcessingStage} />;
  }

  return (
    <SequencesPage
      defaultProcessingStage={stage}
      isReviewPage
      stageSelector={
        <div className="flex items-center space-x-2">
          <label htmlFor="review-stage" className="text-sm text-gray-700">
            Stage:
          </label>
          <select
            id="review-stage"
            value={stage}
            onChange={e => setStage(e.target.value as ProcessingStage)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
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
