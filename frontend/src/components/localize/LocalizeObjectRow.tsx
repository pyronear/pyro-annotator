/**
 * One object's row in the localize cockpit's rail — the localize counterpart
 * of classify's `ObjectRow`. Where classify's row carries a per-object
 * *classification*, this one carries a per-object *localization progress*:
 * how many of the frames the object appears on already have a committed box.
 *
 * Unlike classify's row, the action doesn't hide behind activation: Accept
 * boxes is a one-click bulk action on the row's own lane, so it stays visible
 * on every workable row (matching the pre-cockpit strip's behavior).
 * Activation therefore shows up purely as the accent treatment — the media
 * column follows the active object, so the row doesn't need to expand.
 *
 * Context rows (lanes already localized) render dimmed and action-less, but
 * stay clickable: activating one points the media column at its frames,
 * which is the whole reason they're on screen.
 */

import React from 'react';

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
  /** The false-positive types classify recorded, shown in place of a smoke type. */
  falsePositiveTypes?: string[];
  /** True when this object drives the media column (focus mode). */
  isActive: boolean;
  onActivate: () => void;
  /** Bulk-accepts the winning model boxes for this lane's pending frames. Omit on context rows. */
  onAcceptBoxes?: () => void;
  isAccepting?: boolean;
}

export const LocalizeObjectRow: React.FC<LocalizeObjectRowProps> = ({
  label,
  color,
  confirmedCount,
  presentCount,
  workable,
  smokeType,
  isFalsePositive = false,
  falsePositiveTypes,
  isActive,
  onActivate,
  onAcceptBoxes,
  isAccepting = false,
}) => {
  const pendingCount = presentCount - confirmedCount;

  const status = isFalsePositive
    ? { label: 'False positive', tone: 'bg-ash text-haze' }
    : !workable
      ? { label: 'Context', tone: 'bg-ash text-haze' }
      : pendingCount === 0
        ? { label: 'Done', tone: 'bg-pine-soft text-pine' }
        : { label: `${pendingCount} left`, tone: 'bg-ember-soft text-ember' };

  // What this object is, under its name: the smoke type classify chose, or
  // the false-positive types it was rejected as.
  const subtitle = isFalsePositive
    ? (falsePositiveTypes ?? []).map(t => t.replace(/_/g, ' ')).join(', ') || null
    : (smokeType ?? null);

  const frame = !workable
    ? 'border border-line bg-paper opacity-60'
    : isActive
      ? 'border border-line border-l-[3px] border-l-pine bg-paper'
      : 'border border-line bg-paper hover:bg-ash';

  return (
    <div
      data-testid={`localize-object-row-${label.replace(/\s+/g, '-').toLowerCase()}`}
      data-active={isActive ? 'true' : undefined}
      // role="group" rather than a button: workable rows contain their own
      // action buttons, and nesting interactive controls is invalid HTML.
      role="group"
      aria-label={label}
      className={`cursor-pointer rounded-lg px-3.5 py-2.5 transition-colors ${frame}`}
      onClick={onActivate}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-char/10"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block truncate font-body text-sm font-semibold text-char">
              {label}
            </span>
            {subtitle && (
              <span className="block truncate font-body text-detail capitalize text-haze">
                {subtitle}
              </span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
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
        </span>
      </div>

      {onAcceptBoxes && (
        <div className="mt-2">
          <button
            type="button"
            // The visible label stays short for the rail's width; the
            // accessible name keeps naming the object, so "accept THIS
            // object's boxes" is unambiguous to a screen reader (and to the
            // page tests, which address rows by object).
            aria-label={`Accept ${label}'s boxes`}
            onClick={e => {
              e.stopPropagation();
              onAcceptBoxes();
            }}
            disabled={isAccepting}
            title={`Accept ${label}'s predicted boxes for all pending frames`}
            className="rounded-lg border border-line bg-paper px-2 py-1 font-body text-xs font-medium text-char hover:bg-ash disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAccepting ? 'Accepting…' : 'Accept boxes'}
          </button>
        </div>
      )}
    </div>
  );
};
