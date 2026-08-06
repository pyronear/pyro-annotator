/**
 * The two things you can do to one localize object: bulk-accept the model's
 * boxes, or send it back to classify. They live in one place — the bar above
 * the media column, on the active object. (They used to also sit on the
 * selected rail row, which showed every button twice on one screen.)
 *
 * Accept no longer explains itself in a tooltip: it opens the editor's
 * confirm popover (`acceptPopover`), which shows what accepting will do —
 * and a hover tooltip would paint over the open dialog. Reclassify keeps its
 * tooltip; it is still a one-click action.
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
  /** Toggles the accept-remaining popover; the popover itself arrives via `acceptPopover`. */
  onAcceptBoxes?: () => void;
  isAccepting?: boolean;
  /** Opens this object's classification for correction (classify's done mode). */
  onReclassify?: () => void;
  /** Passed through to the tooltips — `above` where the panel edge is below the buttons. */
  tooltipPlacement?: 'below' | 'above';
  /** Anchor for the popover's outside-click detection — wraps the Accept button. */
  acceptAnchorRef?: React.Ref<HTMLDivElement>;
  /** The page-configured AcceptRemainingPopover, present only while open. */
  acceptPopover?: React.ReactNode;
}

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
const PRIMARY =
  'inline-flex items-center whitespace-nowrap rounded-lg bg-pine px-3 py-1 font-body text-xs font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY =
  'inline-flex items-center whitespace-nowrap rounded-lg border border-line bg-paper px-3 py-1 font-body text-xs font-medium text-char hover:bg-ash';

export const LocalizeObjectActions: React.FC<LocalizeObjectActionsProps> = ({
  label,
  onAcceptBoxes,
  isAccepting = false,
  onReclassify,
  tooltipPlacement = 'below',
  acceptAnchorRef,
  acceptPopover,
}) => (
  <>
    {onAcceptBoxes && (
      <div ref={acceptAnchorRef} className="relative">
        <button
          type="button"
          // The visible label stays short; the accessible name keeps naming
          // the object, so "accept THIS object's boxes" is unambiguous to a
          // screen reader (and to the page tests, which address the actions
          // by object).
          aria-label={`Accept ${label}'s boxes`}
          aria-haspopup="dialog"
          aria-expanded={acceptPopover != null}
          onClick={onAcceptBoxes}
          disabled={isAccepting}
          className={PRIMARY}
        >
          {isAccepting ? 'Accepting…' : 'Accept boxes'}
        </button>
        {acceptPopover}
      </div>
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
          onClick={onReclassify}
          className={SECONDARY}
        >
          Reclassify
        </button>
      </Tooltip>
    )}
  </>
);
