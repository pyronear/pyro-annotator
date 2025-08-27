import SequencesPage from './SequencesPage';
import { ProcessingStageStatus } from '@/types/api';

interface SequencesPageWrapperProps {
  defaultProcessingStage?: ProcessingStageStatus;
}

export default function SequencesPageWrapper({
  defaultProcessingStage,
}: SequencesPageWrapperProps) {
  return <SequencesPage defaultProcessingStage={defaultProcessingStage} />;
}
