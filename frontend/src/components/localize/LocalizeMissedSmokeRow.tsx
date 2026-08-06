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
 * A Yes answer records the flag — it no longer gates an add control. Drawing
 * the missed object isn't supported yet, so the page points the annotator at
 * its Skip alert escape hatch instead (the nudge rendered under the question).
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
  </div>
);
