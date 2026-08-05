/**
 * One object's row in the localize cockpit's rail — the localize counterpart
 * of classify's `ObjectRow`. Where classify's row carries a per-object
 * *classification*, this one carries a per-object *localization progress*:
 * how many of the frames the object appears on already have a committed box.
 *
 * Like classify's row, the actions hide behind activation — but they appear
 * on the header line's right rather than expanding the row, taking the place
 * of the progress count and status chip. The selected row is the one being
 * worked, so its right side turns into what you can DO to it; every other row
 * keeps saying where it stands. The buttons are wider than the metadata they
 * replace, so the name and subtitle truncate to absorb the difference. The
 * trade is deliberate: reaching Accept boxes costs the click that selects the
 * row (which also points the media column at the object), and in exchange the
 * rail stops showing a wall of buttons for lanes nobody is looking at. The
 * same pair of actions also sits above the media column, where the object's
 * frames are — see `LocalizeActiveObjectBar`.
 *
 * Rows past localization lose Accept boxes but keep Reclassify — a finished
 * lane can still have been classified wrong — and stay clickable: activating
 * one points the media column at its frames, which is the whole reason
 * they're on screen. Whether they also fade back is the caller's call
 * (`dimmed`) — that only reads as "context" when there is live work beside
 * them.
 */

import React from 'react';
import { LocalizeObjectActions } from './LocalizeObjectActions';

export interface LocalizeObjectRowProps {
  /** e.g. "Object 2" — the object's own label, shared with the timeline and grid overlays. */
  label: string;
  /** Stable per-object color (hex) — matches the timeline swatch and the grid's box color. */
  color: string;
  /** Frames this object appears on that already carry a committed box. */
  confirmedCount: number;
  /** Frames this object appears on at all (confirmed + pending). */
  presentCount: number;
  /** False for lanes already past localization — read-only context. */
  workable: boolean;
  /** What classify decided this is (wildfire / industrial / other) — omitted on false-positive rows. */
  smokeType?: string;
  /** Read-only false-positive context, surfaced by the opt-in toggle. */
  isFalsePositive?: boolean;
  /**
   * Fade the row back as context. The caller decides, because "already
   * localized" only reads as context when there is live work beside it — on
   * a fully localized alert those rows ARE the subject, and dimming every
   * one of them just made the page look disabled.
   */
  dimmed?: boolean;
  /** The false-positive types classify recorded, shown in place of a smoke type. */
  falsePositiveTypes?: string[];
  /** True when this object drives the media column (focus mode). */
  isActive: boolean;
  onActivate: () => void;
  /** Bulk-accepts the winning model boxes for this lane's pending frames. Omit on context rows. */
  onAcceptBoxes?: () => void;
  isAccepting?: boolean;
  /**
   * Opens this object's classification for correction (classify's done mode).
   * Withheld on false-positive rows — promoting an FP back to smoke needs an
   * auto-review pass first (issue #275).
   */
  onReclassify?: () => void;
}

// forwardRef so the page's Tab cycle can move real DOM focus onto the row it
// lands on — see the cycle effect in `LocalizeAlertPage`.
export const LocalizeObjectRow = React.forwardRef<HTMLDivElement, LocalizeObjectRowProps>(
  function LocalizeObjectRow(
    {
      label,
      color,
      confirmedCount,
      presentCount,
      workable,
      smokeType,
      isFalsePositive = false,
      falsePositiveTypes,
      dimmed = false,
      isActive,
      onActivate,
      onAcceptBoxes,
      isAccepting = false,
      onReclassify,
    },
    ref
  ) {
    const pendingCount = presentCount - confirmedCount;

    // The right-hand swap. A row the page gave no actions (a false positive)
    // has nothing to swap in, so selecting it must not blank the one thing it
    // says about itself.
    const showActions = isActive && !!(onAcceptBoxes || onReclassify);

    const status = isFalsePositive
      ? { label: 'False positive', tone: 'bg-ash text-haze' }
      : !workable
        ? // Past localization: say what it is rather than "Context", which
          // described its role beside live work rather than its own state.
          { label: 'Localized', tone: 'bg-pine-soft text-pine' }
        : pendingCount === 0
          ? { label: 'Done', tone: 'bg-pine-soft text-pine' }
          : { label: `${pendingCount} left`, tone: 'bg-ember-soft text-ember' };

    // What this object is, under its name: the smoke type classify chose, or
    // the false-positive types it was rejected as.
    const subtitle = isFalsePositive
      ? (falsePositiveTypes ?? []).map(t => t.replace(/_/g, ' ')).join(', ') || null
      : (smokeType ?? null);

    // Selection is checked BEFORE dimming. A non-workable row (a false
    // positive, or an already-localized context lane) is still clickable and
    // still drives the media column, so it needs the same "this is what
    // you're looking at" feedback — and leaving it dimmed while it is the
    // active object contradicts the selection. Its accent is neutral rather
    // than pine, which on this page means workable / positive / in progress —
    // a claim a settled object shouldn't make.
    const frame = isActive
      ? `border border-line border-l-[3px] bg-paper ${workable ? 'border-l-pine' : 'border-l-char'}`
      : dimmed
        ? 'border border-line bg-paper opacity-60'
        : 'border border-line bg-paper hover:bg-ash';

    return (
      <div
        ref={ref}
        data-testid={`localize-object-row-${label.replace(/\s+/g, '-').toLowerCase()}`}
        data-active={isActive ? 'true' : undefined}
        data-dimmed={dimmed ? 'true' : undefined}
        // role="group" rather than a button: workable rows contain their own
        // action buttons, and nesting interactive controls is invalid HTML.
        // Keyboard reach comes from the page's Tab cycle, which activates each
        // row it lands on and moves real DOM focus here (via the forwarded
        // ref) — focus, selection and the media column stay one thing. The
        // Enter/Space handling remains for anything else that focuses the row
        // (a click, assistive tech), where Enter must act on THIS row rather
        // than whichever one the cycle last left.
        role="group"
        aria-label={label}
        tabIndex={0}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        }}
        className={`cursor-pointer rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-pine ${frame}`}
        onClick={onActivate}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-char/10"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            {/* Name and what-it-is on one line: the row is a one-line summary,
              and stacking them made it two lines tall for a word. Both
              truncate rather than push: the selected row's buttons are wider
              than the metadata they replace, and at the narrow end of the
              rail something has to give — better a clipped word than a row
              that overflows into a horizontal scrollbar. */}
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate font-body text-sm font-semibold text-char">{label}</span>
              {subtitle && (
                <>
                  {/* Same separator the alert header uses between organisation
                    and camera. Hidden from screen readers, which get the two
                    spans as separate phrases already. */}
                  <span className="shrink-0 font-body text-detail text-haze" aria-hidden="true">
                    ·
                  </span>
                  <span className="truncate font-body text-detail capitalize text-haze">
                    {subtitle}
                  </span>
                </>
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {showActions ? (
              <LocalizeObjectActions
                label={label}
                onAcceptBoxes={onAcceptBoxes}
                isAccepting={isAccepting}
                onReclassify={onReclassify}
              />
            ) : (
              <>
                {/* A false positive has no localization work, so a progress
                  fraction over its frames would be meaningless. */}
                {!isFalsePositive && (
                  <span className="font-data text-detail text-haze">
                    {confirmedCount}/{presentCount}
                  </span>
                )}
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 font-body text-xs font-semibold ${status.tone}`}
                >
                  {status.label}
                </span>
              </>
            )}
          </span>
        </div>
      </div>
    );
  }
);
