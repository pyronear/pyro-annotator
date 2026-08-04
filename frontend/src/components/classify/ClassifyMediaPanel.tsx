/**
 * The classify cockpit's media column: always shows "the active thing".
 * Detections section -> the active object's full-frame player (own box
 * solid, siblings dimmed) and the object's cropped loop. Sequence section
 * -> the primary lane's whole-alert player with every object's overlay,
 * review controls hidden (the decision rail owns yes/no).
 */

import React from 'react';
import { BoundingBox } from '@/types/api';
import { ObjectOverlay } from '@/utils/annotation/objectColors';
import FullImageSequence from '@/components/annotation/FullImageSequence';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import SequenceReviewer from '@/components/sequence/SequenceReviewer';

export interface ClassifyMediaPanelProps {
  activeSection: 'detections' | 'sequence';
  /** Null when the alert has no cards at all (placeholder-only). */
  activeObject: {
    label: string;
    bboxes: BoundingBox[];
    sequenceId: number;
    color?: string;
    siblingOverlays: ObjectOverlay[];
    frameRecordedAt: (string | undefined)[];
  } | null;
  primarySequenceId: number;
  missedSmokeReview: 'yes' | 'no' | null;
  onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
  annotationLoading: boolean;
  objectOverlays: ObjectOverlay[];
}

const eyebrow = 'font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze';

export const ClassifyMediaPanel: React.FC<ClassifyMediaPanelProps> = ({
  activeSection,
  activeObject,
  primarySequenceId,
  missedSmokeReview,
  onMissedSmokeReviewChange,
  annotationLoading,
  objectOverlays,
}) => (
  <div
    data-testid="classify-media-panel"
    className="rounded-card border border-line bg-paper px-[22px] py-5"
  >
    {activeSection === 'sequence' ? (
      <div className="space-y-3">
        <div className={eyebrow}>Whole alert — watch for smoke the model missed</div>
        <SequenceReviewer
          sequenceId={primarySequenceId}
          missedSmokeReview={missedSmokeReview}
          onMissedSmokeReviewChange={onMissedSmokeReviewChange}
          annotationLoading={annotationLoading}
          objectOverlays={objectOverlays}
          hideReviewControls
        />
      </div>
    ) : activeObject ? (
      <div className="space-y-4">
        <FullImageSequence
          bboxes={activeObject.bboxes}
          sequenceId={activeObject.sequenceId}
          color={activeObject.color}
          siblingOverlays={activeObject.siblingOverlays}
          frameRecordedAt={activeObject.frameRecordedAt}
        />
        <div>
          <div className={`${eyebrow} mb-2`}>Cropped · {activeObject.label}</div>
          <CroppedImageSequence bboxes={activeObject.bboxes} sequenceId={activeObject.sequenceId} />
        </div>
      </div>
    ) : (
      <p className="py-16 text-center font-body text-sm text-haze">No objects to review yet</p>
    )}
  </div>
);
