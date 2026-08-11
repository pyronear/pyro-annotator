/**
 * The localize rail's missed-smoke question — the counterpart of classify's
 * `DecisionRail` row.
 *
 * Localize used to READ `has_missed_smoke` without ever showing it: the flag
 * classify set only surfaced at submit time, in the "you flagged missed smoke"
 * dialog. Here it is visible up front and answerable in place.
 *
 * Binary rather than classify's tri-state: classify's own submit already
 * requires the question to be answered, so by the time an alert reaches
 * localize `has_missed_smoke` is a real answer, not "not asked yet".
 *
 * A Yes answer records the flag AND unlocks the work: it reveals "+ Add
 * object", which opens the two-phase overlay where the missed plume's range
 * is chosen and boxed. Between PR #312 and this, Yes pointed at the Skip
 * alert escape hatch instead, because drawing a missed object wasn't
 * supported — that nudge is gone now that it is.
 *
 * The flag itself is NOT cleared once an object is added: it records that the
 * DETECTOR missed a plume, which is the false-negative signal worth keeping,
 * not a to-do item.
 */

import React from 'react';

export interface LocalizeMissedSmokeRowProps {
  /** Current answer for this alert. */
  hasMissedSmoke: boolean;
  onChange: (hasMissedSmoke: boolean) => void;
  /** True while the PATCH is in flight. */
  isSaving?: boolean;
  /** No lane can carry the flag (nothing annotated yet) — render read-only. */
  disabled?: boolean;
  /**
   * Opens the add-object overlay. Omitted where adding isn't offered (done
   * mode), in which case a Yes answer just records the flag.
   */
  onAddObject?: () => void;
}

const chip = (selected: boolean, selectedClasses: string, disabled: boolean) =>
  `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-body text-xs font-medium transition-colors ${
    selected ? selectedClasses : 'border-line bg-paper text-char hover:bg-ash'
  } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`;

export const LocalizeMissedSmokeRow: React.FC<LocalizeMissedSmokeRowProps> = ({
  hasMissedSmoke,
  onChange,
  isSaving = false,
  disabled = false,
  onAddObject,
}) => (
  <div
    data-testid="localize-missed-smoke-row"
    className="rounded-lg border border-line px-3.5 py-2.5"
  >
    <div className="flex items-center justify-between gap-2">
      <span className="font-body text-sm font-semibold text-char">Missed smoke?</span>
      <span role="radiogroup" aria-label="Missed smoke" className="flex items-center gap-1.5">
        <button
          type="button"
          role="radio"
          aria-checked={hasMissedSmoke}
          aria-label="Yes"
          disabled={disabled || isSaving}
          onClick={() => onChange(true)}
          className={chip(hasMissedSmoke, 'border-ember bg-ember-soft text-ember', disabled)}
        >
          Yes
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!hasMissedSmoke}
          aria-label="No"
          disabled={disabled || isSaving}
          onClick={() => onChange(false)}
          className={chip(!hasMissedSmoke, 'border-pine bg-pine text-white', disabled)}
        >
          No
        </button>
      </span>
    </div>
    {hasMissedSmoke && onAddObject && (
      <>
        <p className="mt-1.5 font-body text-detail text-haze">
          Add the object the model missed, and box it across the frames it appears on.
        </p>
        <button
          type="button"
          onClick={onAddObject}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-pine px-3 py-1.5 font-body text-xs font-semibold text-white transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
        >
          + Add object
          <kbd className="rounded border border-white/40 px-1 py-0.5 font-data text-[11px] font-medium leading-none">
            N
          </kbd>
        </button>
      </>
    )}
  </div>
);
