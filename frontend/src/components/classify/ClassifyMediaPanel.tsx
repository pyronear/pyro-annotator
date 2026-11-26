/**
 * The classify cockpit's media column: always shows "the active thing".
 * Detections section -> the active object's full-frame player (own box
 * solid, siblings dimmed) and the object's cropped loop. Sequence section
 * -> the primary lane's whole-alert player with every object's overlay,
 * the player's embedded review controls hidden in favor of the guidance
 * copy + Yes/No CTAs below the strip (mirroring the rail chips' state),
 * with a fullscreen toggle for easier missed-smoke assessment.
 */

import React, { useEffect, useRef, useState } from 'react';
import { BoundingBox } from '@/types/api';
import { ObjectOverlay } from '@/utils/annotation/objectColors';
import FullImageSequence, {
  FullImageFrame,
  SeekRequest,
} from '@/components/annotation/FullImageSequence';
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
  /** True while an object exists but hasn't activated yet (initial load / alert switch) — renders a skeleton instead of the empty state. */
  loading?: boolean;
  primarySequenceId: number;
  missedSmokeReview: 'yes' | 'no' | null;
  onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
  annotationLoading: boolean;
  objectOverlays: ObjectOverlay[];
  /** A row-timeline segment click's jump-and-hold, forwarded to the full-frame player only. */
  seekRequest?: SeekRequest | null;
}

export const ClassifyMediaPanel: React.FC<ClassifyMediaPanelProps> = ({
  activeSection,
  activeObject,
  loading = false,
  primarySequenceId,
  missedSmokeReview,
  onMissedSmokeReviewChange,
  annotationLoading,
  objectOverlays,
  seekRequest,
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

  // Browsers exit native fullscreen on Escape themselves; this handler
  // makes the exit explicit. stopImmediatePropagation keeps other
  // same-node capture listeners (the page's shortcut handlers) from also
  // reacting — best-effort only, since it can't suppress listeners
  // registered before this one.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.fullscreenElement) {
        e.stopImmediatePropagation();
        void document.exitFullscreen?.();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isFullscreen]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void sequenceViewRef.current?.requestFullscreen?.();
    }
  };

  return (
    // No card chrome — the players are the panel, and every saved vertical
    // pixel helps the object view (full frame + crop) fit without scrolling.
    <div data-testid="classify-media-panel">
      {activeSection === 'sequence' ? (
        <div
          ref={sequenceViewRef}
          className={
            isFullscreen ? 'flex h-full flex-col justify-center overflow-hidden bg-char p-6' : ''
          }
        >
          <SequenceReviewer
            sequenceId={primarySequenceId}
            missedSmokeReview={missedSmokeReview}
            onMissedSmokeReviewChange={onMissedSmokeReviewChange}
            annotationLoading={annotationLoading}
            objectOverlays={objectOverlays}
            hideReviewControls
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
          />
        </div>
      ) : activeObject ? (
        // Untitled on purpose: the active rail row already names the object,
        // and the saved rows keep the crop above the fold.
        <div
          className="space-y-3"
          data-testid="object-media"
          data-object-label={activeObject.label}
        >
          <FullImageSequence
            bboxes={activeObject.bboxes}
            sequenceId={activeObject.sequenceId}
            color={activeObject.color}
            siblingOverlays={activeObject.siblingOverlays}
            frameRecordedAt={activeObject.frameRecordedAt}
            seekRequest={seekRequest}
          />
          <CroppedImageSequence
            bboxes={activeObject.croppedBboxes}
            sequenceId={activeObject.sequenceId}
            accentColor={activeObject.color}
          />
        </div>
      ) : loading ? (
        <div data-testid="media-panel-skeleton" className="space-y-4">
          <div className="aspect-video w-full animate-pulse rounded bg-ash" />
          <div className="h-28 w-full animate-pulse rounded bg-ash" />
        </div>
      ) : (
        <p className="py-16 text-center font-body text-sm text-haze">No objects to review yet</p>
      )}
    </div>
  );
};
