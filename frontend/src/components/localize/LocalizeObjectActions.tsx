/**
 * The two things you can do to one localize object: bulk-accept the model's
 * boxes, or send it back to classify. Shared, because they appear in two
 * places at once — the object's rail row and the media column's CTA bar —
 * and a second copy of the buttons would mean a second copy of the tooltip
 * copy, which is where the explanation of what each one does actually lives.
 *
 * Either action can be withheld by omitting its handler: false positives get
 * neither, and a lane past localization (or one with nothing left pending)
 * keeps only Reclassify.
 */

import React from 'react';
import { Tooltip } from '@/components/ui/Tooltip';

export interface LocalizeObjectActionsProps {
  /** e.g. "Object 2" — names both buttons, so a screen reader hears which object it acts on. */
  label: string;
  /** Bulk-accepts the winning model boxes for this lane's pending frames. */
  onAcceptBoxes?: () => void;
  isAccepting?: boolean;
  /** Opens this object's classification for correction (classify's done mode). */
  onReclassify?: () => void;
  /** Passed through to the tooltips — `above` where the panel edge is below the buttons. */
  tooltipPlacement?: 'below' | 'above';
  /**
   * `compact` fits the rail row's line, where these are one of several things
   * competing for a narrow strip. `prominent` is the media column's call to
   * action: the same height, so the control panel doesn't grow when an object
   * is selected, but Accept carries the primary fill since it is the one that
   * moves the work on.
   */
  size?: 'compact' | 'prominent';
}

const COMPACT =
  'whitespace-nowrap rounded-lg border border-line bg-paper px-2 py-1 font-body text-xs font-medium text-char hover:bg-ash disabled:cursor-not-allowed disabled:opacity-50';
// Prominence comes from fill and placement, not from size: these sit on the
// control panel's line, and anything taller than the view toolbar beside them
// would grow the panel the moment an object is selected — the page would
// twitch on every selection. So they match the toolbar's height and earn
// their weight from colour.
//
// Pine rather than ember: on this page pine is the colour of work moving
// forward — it is what Submit wears — and accepting an object's boxes is the
// same motion, one object at a time. Ember would read as the alert's headline
// action and compete with Submit for it.
const PROMINENT_PRIMARY =
  'inline-flex items-center whitespace-nowrap rounded-lg bg-pine px-3 py-1 font-body text-xs font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const PROMINENT_SECONDARY =
  'inline-flex items-center whitespace-nowrap rounded-lg border border-line bg-paper px-3 py-1 font-body text-xs font-medium text-char hover:bg-ash';

export const LocalizeObjectActions: React.FC<LocalizeObjectActionsProps> = ({
  label,
  onAcceptBoxes,
  isAccepting = false,
  onReclassify,
  tooltipPlacement = 'below',
  size = 'compact',
}) => (
  <>
    {onAcceptBoxes && (
      // Says what it commits and what it leaves alone: the action is bulk,
      // and the object it belongs to is the only thing it touches.
      <Tooltip
        placement={tooltipPlacement}
        tip={`Commits the model's predicted box on every frame of ${label} that still needs one. No other object is affected.`}
      >
        <button
          type="button"
          // The visible label stays short for the rail's width; the accessible
          // name keeps naming the object, so "accept THIS object's boxes" is
          // unambiguous to a screen reader (and to the page tests, which
          // address rows by object).
          aria-label={`Accept ${label}'s boxes`}
          onClick={e => {
            e.stopPropagation();
            onAcceptBoxes();
          }}
          disabled={isAccepting}
          className={size === 'prominent' ? PROMINENT_PRIMARY : COMPACT}
        >
          {isAccepting ? 'Accepting…' : 'Accept boxes'}
        </button>
      </Tooltip>
    )}
    {onReclassify && (
      // Warns that it leaves the page — and that you come back, which is the
      // part that makes clicking it feel safe.
      <Tooltip
        placement={tooltipPlacement}
        tip={`Opens ${label} in classify to correct its smoke type or mark it a false positive, then returns you here.`}
      >
        <button
          type="button"
          aria-label={`Reclassify ${label}`}
          onClick={e => {
            e.stopPropagation();
            onReclassify();
          }}
          className={size === 'prominent' ? PROMINENT_SECONDARY : COMPACT}
        >
          Reclassify
        </button>
      </Tooltip>
    )}
  </>
);
