import SequencesPage from './SequencesPage';
import { ProcessingStageStatus } from '@/types/api';
import { ALL_CLASSIFIED_STAGES } from '@/utils/processingStage';

interface SequencesPageWrapperProps {
  defaultProcessingStage?: ProcessingStageStatus;
}

export default function SequencesPageWrapper({
  defaultProcessingStage,
}: SequencesPageWrapperProps) {
  if (defaultProcessingStage !== 'annotated') {
    return <SequencesPage defaultProcessingStage={defaultProcessingStage} />;
  }

  // Done list: membership (fully classified alerts) lives in the
  // classify-done endpoint; the stage list here only keeps the
  // annotated-view filter controls visible.
  return <SequencesPage defaultProcessingStage={ALL_CLASSIFIED_STAGES} isReviewPage />;
}
