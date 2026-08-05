/**
 * Confirms accepting the model's boxes on every frame of this object where one
 * is on offer but has not been accepted.
 *
 * A popover under its button rather than a modal: the decision is small, it is
 * about the object the screen is already about, and the frame behind it stays
 * useful context. It closes on an outside click, on a second press of its
 * button, or on Escape.
 *
 * The distinction matters in the copy: those frames are not empty — a model
 * found smoke and drew a box, it just has not been committed. "No box" is
 * reserved for the frames in the warning below, where no source found
 * anything at all.
 *
 * The preview is the point of the dialog. `collectLaneBoxes` returns the
 * lane's boxes as they WOULD stand after accepting — committed boxes where
 * the annotator already decided, the winning model box everywhere else — so
 * the cropped loop shows the object's finished track rather than a count of
 * writes. If the model drifts off the plume halfway through, that is visible
 * here and nowhere else short of stepping every frame.
 *
 * Frames where no source offers a box at all are called out but never block:
 * accepting cannot invent a box for them, and they are what will keep the
 * alert off the submit gate afterwards, so the annotator should know before
 * rather than after.
 */

import { X } from 'lucide-react';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import type { BoundingBox } from '@/types/api';

export interface AcceptRemainingPopoverProps {
  objectLabel: string;
  objectColor: string;
  sequenceId: number;
  /** The lane's boxes as they would stand after accepting. */
  previewBoxes: BoundingBox[];
  /** Frames that will gain a box. */
  acceptCount: number;
  /** Frames that will still have none, because no source offers one. */
  gapCount: number;
  isAccepting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AcceptRemainingPopover({
  objectLabel,
  objectColor,
  sequenceId,
  previewBoxes,
  acceptCount,
  gapCount,
  isAccepting,
  onConfirm,
  onCancel,
}: AcceptRemainingPopoverProps) {
  return (
    <div
      className="absolute left-1/2 top-full z-20 mt-2 w-[22rem] -translate-x-1/2 rounded-card border border-line bg-paper p-5 shadow-[0_8px_24px_rgba(32,38,31,0.12)]"
      role="dialog"
      aria-label={`Accept the model's boxes for ${objectLabel}`}
      data-testid="accept-remaining-popover"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
          Accept the model&apos;s boxes
        </p>
        <button
          type="button"
          data-testid="accept-remaining-close"
          onClick={onCancel}
          aria-label="Close"
          className="-mr-1 -mt-1 rounded-md p-1 text-haze hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 font-body text-sm text-char">
        {acceptCount === 1
          ? 'One frame has a model box you have not accepted.'
          : `${acceptCount} frames have a model box you have not accepted.`}{' '}
        Take them all, exactly as the loop below shows. Boxes you picked or drew yourself stay as
        they are.
      </p>

      <div className="mt-4">
        <p className="mb-2 font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
          What {objectLabel} ends up with
        </p>
        <CroppedImageSequence
          bboxes={previewBoxes}
          sequenceId={sequenceId}
          accentColor={objectColor}
          maxSize="min(100%, 15rem)"
          className="mx-auto"
        />
      </div>

      {gapCount > 0 && (
        <p
          data-testid="accept-remaining-gap-warning"
          className="mt-4 rounded-lg bg-signal-soft px-3 py-2 font-body text-detail text-signal"
        >
          {gapCount === 1
            ? 'One frame has no box at all — no model found smoke there. Draw on it yourself;'
            : `${gapCount} frames have no box at all — no model found smoke there. Draw on them yourself;`}{' '}
          the alert cannot be submitted until every frame has one.
        </p>
      )}

      {/* Only the affirmative action here: leaving is what the cross, a click
          outside, the button itself and Escape already do, and a Cancel button
          beside Accept gives equal weight to doing nothing. Centred, since it
          is the only one — an edge-aligned lone button reads as the smaller
          half of a pair that is not there. */}
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          data-testid="accept-remaining-confirm"
          onClick={onConfirm}
          disabled={isAccepting}
          className="inline-flex items-center rounded-lg bg-pine px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:opacity-40"
        >
          {isAccepting ? 'Accepting…' : `Accept ${acceptCount}`}
        </button>
      </div>
    </div>
  );
}
