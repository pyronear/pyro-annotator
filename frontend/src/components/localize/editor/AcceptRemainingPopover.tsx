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
 *
 * Below the loop, a bare single-object status strip shows the object's frames
 * as they stand NOW — committed solid, acceptable faded, gaps outlined — so
 * the faded segments are exactly what the button will fill. The frame counter
 * and the strip's playhead follow the loop's reported position; the loop only
 * plays frames that have boxes, so the counter visibly skips gap frames and
 * the playhead never lands on an outlined segment.
 */

import { useState, type CSSProperties } from 'react';
import { AlertCircle, X } from 'lucide-react';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import {
  ObjectStatusStrip,
  UNDETECTED_OUTLINE,
  type ObjectStatusStripStatus,
} from '@/components/sequence-annotation/ObjectStatusStrip';
import type { FilmstripEntry } from '@/utils/annotation/objectFilmstrip';
import type { BoundingBox } from '@/types/api';

export interface AcceptRemainingPopoverProps {
  objectLabel: string;
  objectColor: string;
  sequenceId: number;
  /** The lane's boxes as they would stand after accepting. */
  previewBoxes: BoundingBox[];
  /** One entry per alert frame (chronological) — drives the status strip, the frame counter and the playhead. */
  entries: FilmstripEntry[];
  /** Frames that will gain a box. */
  acceptCount: number;
  /** Frames that will still have none, because no source offers one. */
  gapCount: number;
  isAccepting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Pre-accept status of one alert frame, in ObjectStatusStrip's vocabulary.
 * A frame inside the object's run that the object was never detected on is
 * `undetected` — a potential hole in the track (the importer only creates
 * lane detections above threshold, and fainter smoke hides exactly there) —
 * while frames before/after the run are plain `absent`.
 */
function entryStatus(entry: FilmstripEntry): ObjectStatusStripStatus {
  if (!entry.inObject) return entry.run === 'object' ? 'undetected' : 'absent';
  if (entry.committedSource) return 'confirmed';
  if (entry.availableSource) return 'pending';
  return 'empty';
}

export function AcceptRemainingPopover({
  objectLabel,
  objectColor,
  sequenceId,
  previewBoxes,
  entries,
  acceptCount,
  gapCount,
  isAccepting,
  onConfirm,
  onCancel,
}: AcceptRemainingPopoverProps) {
  // The frame the crop loop is showing, as reported by onFrameChange. Held
  // as the detection id (not the loop index): the loop iterates only frames
  // that have boxes, while the strip and counter span every alert frame.
  const [loopDetectionId, setLoopDetectionId] = useState<number | null>(null);

  const currentEntryIndex = entries.findIndex(e => e.inObject && e.detectionId === loopDetectionId);
  const currentEntry = currentEntryIndex >= 0 ? entries[currentEntryIndex] : null;

  const statusByTimestamp: Record<string, ObjectStatusStripStatus> = {};
  for (const entry of entries) statusByTimestamp[entry.recordedAt] = entryStatus(entry);

  // Legend under the strip, mirroring each status's segment styling — but
  // only for statuses actually on the strip: a "no box" chip over a gapless
  // track would name a problem the object does not have.
  const present = new Set(Object.values(statusByTimestamp));
  const legendItems: { label: string; swatchStyle: CSSProperties }[] = [];
  if (present.has('confirmed')) {
    legendItems.push({ label: 'committed', swatchStyle: { backgroundColor: objectColor } });
  }
  if (present.has('pending')) {
    legendItems.push({
      label: 'model box to accept',
      swatchStyle: { backgroundColor: objectColor, opacity: 0.4 },
    });
  }
  if (present.has('empty')) {
    legendItems.push({
      label: 'no box',
      swatchStyle: { boxShadow: `inset 0 0 0 1px ${objectColor}` },
    });
  }
  if (present.has('undetected')) {
    legendItems.push({
      label: 'potential gap',
      swatchStyle: { boxShadow: `inset 0 0 0 1px ${UNDETECTED_OUTLINE}` },
    });
  }

  // Frames of the alert this object has no box on — before it first appears,
  // holes inside its run, after it last appears. None of them block, but all
  // of them are where missed smoke lives, so the nudge lists each stretch.
  const beforeCount = entries.filter(e => !e.inObject && e.run === 'before').length;
  const holeCount = entries.filter(e => !e.inObject && e.run === 'object').length;
  const afterCount = entries.filter(e => !e.inObject && e.run === 'after').length;
  const unboxedParts = [
    beforeCount > 0 ? `${beforeCount} before it first appears` : null,
    holeCount > 0 ? `${holeCount} inside its run it was never detected on` : null,
    afterCount > 0 ? `${afterCount} after it last appears` : null,
  ].filter((part): part is string => part !== null);
  const unboxedTotal = beforeCount + holeCount + afterCount;

  return (
    <div
      className="absolute left-1/2 top-full z-20 mt-2 w-[32rem] -translate-x-1/2 rounded-card border border-line bg-paper p-5 shadow-[0_8px_24px_rgba(32,38,31,0.12)]"
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
      {/* The preview leads: it is the point of the dialog — the reader sees
          the finished track first and the sentence then explains the deal. */}
      {/* The loop and its timeline sit side by side: a grid with a definite
          15rem track for the crop (never a flex row — the loop's root
          shrink-fits to zero there), the counter/strip/legend column filling
          the rest, anchored to the crop's bottom edge. */}
      <div className="mt-4">
        <div className="grid grid-cols-[15rem,1fr] items-end gap-4">
          <CroppedImageSequence
            bboxes={previewBoxes}
            sequenceId={sequenceId}
            accentColor={objectColor}
            // The boxes are the whole point of this preview: it answers "will
            // these track the plume?", and without them it only shows that the
            // plume is there. `showBoxes` arrived on main while this branch was
            // in flight.
            showBoxes
            maxSize="min(100%, 15rem)"
            onFrameChange={(_index, detectionId) => setLoopDetectionId(detectionId ?? null)}
          />
          <div>
            {currentEntry && (
              <div className="mb-1 text-right">
                <span
                  data-testid="accept-remaining-frame-counter"
                  className="whitespace-nowrap font-data text-detail tabular-nums text-haze"
                >
                  Frame {currentEntryIndex + 1} of {entries.length}
                </span>
              </div>
            )}
            <ObjectStatusStrip
              variant="bare"
              objects={[{ label: objectLabel, color: objectColor, statusByTimestamp }]}
              playhead={
                currentEntry ? { objectIndex: 0, timestamp: currentEntry.recordedAt } : undefined
              }
            />
            {legendItems.length > 0 && (
              <div data-testid="accept-remaining-legend" className="mt-2 space-y-1">
                {legendItems.map(item => (
                  <div
                    key={item.label}
                    className="flex items-center gap-1.5 font-data text-detail text-haze"
                  >
                    <span aria-hidden className="h-1.5 w-4 rounded-full" style={item.swatchStyle} />
                    {item.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 font-body text-sm text-char">
        {acceptCount === 1
          ? 'One frame has a model box you have not accepted.'
          : `${acceptCount} frames have a model box you have not accepted.`}{' '}
        Take them all, exactly as the loop above shows. Boxes you picked or drew yourself stay as
        they are.
      </p>

      {unboxedTotal > 0 && (
        <div
          data-testid="accept-remaining-coverage-warning"
          className="mt-4 flex items-start gap-2 rounded-lg bg-ash px-3 py-2 font-body text-detail text-char"
        >
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-haze" />
          <p>
            {objectLabel} has no box on{' '}
            {unboxedTotal === 1 ? 'one other frame' : `${unboxedTotal} other frames`} of the alert:{' '}
            {unboxedParts.join(', ')}. Check them, smoke may be visible there too.
          </p>
        </div>
      )}

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
          className="inline-flex items-center gap-2 rounded-lg bg-pine px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:opacity-40"
        >
          {isAccepting ? (
            'Accepting…'
          ) : (
            <>
              Accept
              <kbd className="rounded border border-white/40 px-1 py-0.5 font-data text-[11px] font-medium leading-none">
                Enter
              </kbd>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
