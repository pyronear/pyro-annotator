/**
 * The localize rail's missed-smoke question — the counterpart of classify's
 * `DecisionRail` row, and the context for "+ Add object" sitting directly
 * below it.
 *
 * Localize used to READ `has_missed_smoke` without ever showing it: the flag
 * classify set only surfaced at submit time, in the "you flagged missed smoke
 * but added no object" dialog. Here it is visible up front and answerable in
 * place, so the reason to add an object is on screen before you need it.
 *
 * Binary rather than classify's tri-state: classify's own submit already
 * requires the question to be answered, so by the time an alert reaches
 * localize `has_missed_smoke` is a real answer, not "not asked yet".
 *
 * The answer gates adding an object, and the control lives INSIDE this row
 * rather than beside it: "+ Add object" only exists once the answer is Yes,
 * so the question and the only action it authorizes read as one unit instead
 * of a button that is mysteriously dead until something above it is answered.
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
  /** The "+ Add object" control, rendered inside the row and only while the answer is Yes. */
  addObject?: React.ReactNode;
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
  addObject,
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
    {hasMissedSmoke && (
      <>
        <p className="mt-1.5 font-body text-detail text-haze">
          Add the object the AI missed, so it gets its own row to localize.
        </p>
        {addObject && <div className="mt-2 flex flex-wrap items-center gap-2">{addObject}</div>}
      </>
    )}
  </div>
);
