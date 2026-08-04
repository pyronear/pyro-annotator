/**
 * Missed smoke review panel component.
 * Wraps the SequenceReviewer for missed smoke detection review.
 */

import React from 'react';
import SequenceReviewer from '@/components/sequence/SequenceReviewer';
import { ObjectOverlay } from '@/utils/annotation/objectColors';

interface MissedSmokePanelProps {
  sequenceId: number;
  missedSmokeReview: 'yes' | 'no' | null;
  onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
  annotationLoading: boolean;
  activeSection: string;
  sequenceReviewerRef: React.RefObject<HTMLDivElement>;
  /** Every classified object's track boxes, color-coded per object — see SequencePlayer. */
  objectOverlays?: ObjectOverlay[];
}

export const MissedSmokePanel: React.FC<MissedSmokePanelProps> = ({
  sequenceId,
  missedSmokeReview,
  onMissedSmokeReviewChange,
  annotationLoading,
  activeSection,
  sequenceReviewerRef,
  objectOverlays,
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
        objectOverlays={objectOverlays}
      />
    </div>
  );
};
