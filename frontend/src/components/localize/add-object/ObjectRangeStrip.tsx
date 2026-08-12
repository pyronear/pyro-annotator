/**
 * The add-object flow's frame strip: one cell per frame of the alert, in two
 * states — inside the object's range or outside it — plus the two anchors the
 * human draws on, and the frame currently on the stage.
 *
 * Deliberately not `ObjectFilmstrip`. That strip's whole encoding names box
 * SOURCES (solid = committed from that source, dashed = that source offers a
 * box, hatched = no source found anything), and a brand-new object has none of
 * them, so nearly every state it can draw is unreachable here. A mode prop
 * would mean switching off most of a component the editor depends on; a
 * separate strip leaves the editor untouched.
 *
 * Once both anchors are boxed, each in-range cell crops to its interpolated
 * box, so the strip IS the propagation preview — there is no separate confirm
 * step to show what will be written.
 *
 * The frame on the stage grows rather than gaining an outline: colour here is
 * spent entirely on range membership, and the anchors already take a heavier
 * border of the same hue. Size is the channel still free — the same reasoning
 * `ObjectFilmstrip` uses for its own current cell.
 */

import { FilmstripThumbnail } from '@/components/localize/editor/FilmstripThumbnail';
import { formatTime } from '@/utils/datetime';
import type { RangeStripEntry } from '@/utils/annotation/objectRangeStripEntries';

export interface ObjectRangeStripProps {
  entries: RangeStripEntry[];
  /** The frame the stage is showing. */
  currentRecordedAt: string;
  /** The colour the new object will get, from `getObjectColor`. */
  objectColor: string;
  /**
   * Clicking any cell — in range or not — reports it. Out-of-range cells stay
   * clickable on purpose: that is how the range gets widened.
   */
  onSelect: (entry: RangeStripEntry) => void;
  /**
   * True while the range is being chosen, when this strip is the thing the
   * annotator has to act on. Cells then arm visibly on hover, so the row reads
   * as a set of targets rather than a row of thumbnails.
   */
  selecting?: boolean;
  /**
   * Preview a frame without choosing it. Supplied only while the range is
   * being chosen: there a click COMMITS an anchor, so without hover the only
   * way to look before leaping is the arrow keys. Deliberately absent once
   * drawing starts — swapping the stage out from under a drag would be a way
   * to lose a box.
   */
  onHoverPreview?: (entry: RangeStripEntry) => void;
}

export function ObjectRangeStrip({
  entries,
  currentRecordedAt,
  objectColor,
  onSelect,
  selecting = false,
  onHoverPreview,
}: ObjectRangeStripProps) {
  return (
    <div className="flex items-end gap-1 overflow-x-auto px-2 py-2">
      {entries.map(entry => {
        const isCurrent = entry.recordedAt === currentRecordedAt;
        return (
          <button
            key={entry.recordedAt}
            type="button"
            data-testid={`range-strip-cell-${entry.recordedAt}`}
            data-in-range={entry.inRange ? 'true' : undefined}
            data-anchor={entry.isAnchor ? 'true' : undefined}
            data-current={isCurrent ? 'true' : undefined}
            aria-label={`Frame at ${formatTime(entry.recordedAt)}`}
            aria-pressed={entry.inRange}
            onClick={() => onSelect(entry)}
            onMouseEnter={onHoverPreview ? () => onHoverPreview(entry) : undefined}
            // Keyboard parity: tabbing through the strip previews too, rather
            // than leaving the stage on whatever the mouse last touched.
            onFocus={onHoverPreview ? () => onHoverPreview(entry) : undefined}
            className={`relative aspect-square w-12 shrink-0 rounded-sm transition-transform focus:outline-none focus:ring-1 focus:ring-ember ${
              isCurrent ? 'z-10 scale-110 shadow-md' : ''
            } ${entry.inRange ? '' : 'opacity-40 saturate-50'} ${
              // Armed on hover while choosing: a thumbnail that lifts and rings
              // under the cursor says "click me" in a way a tinted row does not.
              selecting
                ? 'cursor-pointer ring-pine hover:z-10 hover:scale-110 hover:opacity-100 hover:ring-2 hover:saturate-100'
                : ''
            }`}
            style={{
              outline: entry.inRange
                ? `${entry.isAnchor ? 2.5 : 1.5}px solid ${objectColor}`
                : undefined,
              outlineOffset: '-1px',
            }}
          >
            <FilmstripThumbnail detectionId={entry.detectionId} xyxyn={entry.xyxyn} />
          </button>
        );
      })}
    </div>
  );
}
