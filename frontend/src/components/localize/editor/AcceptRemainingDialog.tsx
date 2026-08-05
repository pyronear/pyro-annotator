/**
 * Confirms accepting the model's boxes on every frame of this object where one
 * is on offer but has not been accepted.
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

import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import type { BoundingBox } from '@/types/api';

export interface AcceptRemainingDialogProps {
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

export function AcceptRemainingDialog({
  objectLabel,
  objectColor,
  sequenceId,
  previewBoxes,
  acceptCount,
  gapCount,
  isAccepting,
  onConfirm,
  onCancel,
}: AcceptRemainingDialogProps) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-char/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Accept the model's boxes for ${objectLabel}`}
      data-testid="accept-remaining-dialog"
      onClick={onCancel}
    >
      <div
        className="w-[22rem] rounded-card border border-line bg-paper p-5"
        onClick={event => event.stopPropagation()}
      >
        <p className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
          Accept the model&apos;s boxes
        </p>
        <p className="mt-2 font-body text-sm text-char">
          {acceptCount === 1
            ? 'One frame carries a model box you have not accepted yet.'
            : `${acceptCount} frames carry a model box you have not accepted yet.`}{' '}
          Accepting commits them exactly as shown below. Frames you have already decided are left
          alone.
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
              ? 'One frame will still have no box — no model found smoke there.'
              : `${gapCount} frames will still have no box — no model found smoke there.`}{' '}
            Draw on them yourself, or the alert stays unsubmittable.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="accept-remaining-cancel"
            onClick={onCancel}
            className="inline-flex items-center rounded-lg border border-line bg-paper px-3 py-2 font-body text-sm font-medium text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
          >
            Cancel
          </button>
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
    </div>
  );
}
