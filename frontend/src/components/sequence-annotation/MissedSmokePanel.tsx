/**
 * Missed smoke review panel component.
 * Wraps the SequenceReviewer for missed smoke detection review.
 */

import React from 'react';
import SequenceReviewer from '@/components/sequence/SequenceReviewer';

interface MissedSmokePanelProps {
  sequenceId: number;
  missedSmokeReview: 'yes' | 'no' | null;
  onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
  annotationLoading: boolean;
  activeSection: string;
  sequenceReviewerRef: React.RefObject<HTMLDivElement>;
}

export const MissedSmokePanel: React.FC<MissedSmokePanelProps> = ({
  sequenceId,
  missedSmokeReview,
  onMissedSmokeReviewChange,
  annotationLoading,
  activeSection,
  sequenceReviewerRef
}) => {
  return (
    <div 
      ref={sequenceReviewerRef}
      className={`${activeSection === 'sequence' ? 'ring-2 ring-blue-500 ring-offset-2 rounded-lg' : ''}`}
    >
      <SequenceReviewer
        sequenceId={sequenceId}
        missedSmokeReview={missedSmokeReview}
        onMissedSmokeReviewChange={onMissedSmokeReviewChange}
        annotationLoading={annotationLoading}
      />
    </div>
  );
};