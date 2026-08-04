/**
 * The classify cockpit's media column: always shows "the active thing".
 * Detections section -> the active object's full-frame player (own box
 * solid, siblings dimmed) and the object's cropped loop. Sequence section
 * -> the primary lane's whole-alert player with every object's overlay,
 * review controls hidden (the decision rail owns yes/no), with a
 * fullscreen toggle for easier missed-smoke assessment.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { BoundingBox } from '@/types/api';
import { ObjectOverlay } from '@/utils/annotation/objectColors';
import FullImageSequence, { FullImageFrame } from '@/components/annotation/FullImageSequence';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import SequenceReviewer from '@/components/sequence/SequenceReviewer';

export interface ClassifyMediaPanelProps {
  activeSection: 'detections' | 'sequence';
  /** Null when the alert has no cards at all (placeholder-only). */
  activeObject: {
    label: string;
    /** Frames for the full-frame player — the alert's frame union; `xyxyn: null` frames render box-less. */
    bboxes: FullImageFrame[];
    /** The object's own track boxes — the cropped loop needs real boxes to crop around. */
    croppedBboxes: BoundingBox[];
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
}) => {
  // Fullscreen for the whole-alert (missed-smoke) view. Tracks the browser
  // state so Esc / browser chrome exits stay in sync with the toggle icon.
  const sequenceViewRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === sequenceViewRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void sequenceViewRef.current?.requestFullscreen?.();
    }
  };

  return (
    <div
      data-testid="classify-media-panel"
      className="rounded-card border border-line bg-paper px-[22px] py-5"
    >
      {activeSection === 'sequence' ? (
        <div
          ref={sequenceViewRef}
          className={
            isFullscreen ? 'flex h-full flex-col justify-center overflow-auto bg-char p-6' : ''
          }
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className={isFullscreen ? `${eyebrow} !text-paper` : eyebrow}>
              Whole alert — watch for smoke the model missed
            </div>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen the player'}
              className={`inline-flex items-center rounded-lg border p-1.5 transition-colors ${
                isFullscreen
                  ? 'border-paper/30 bg-transparent text-paper hover:bg-paper/10'
                  : 'border-line bg-paper text-haze hover:bg-ash'
              }`}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
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
            <CroppedImageSequence
              bboxes={activeObject.croppedBboxes}
              sequenceId={activeObject.sequenceId}
            />
          </div>
        </div>
      ) : (
        <p className="py-16 text-center font-body text-sm text-haze">No objects to review yet</p>
      )}
    </div>
  );
};
