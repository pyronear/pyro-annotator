/**
 * The classify cockpit's right-hand column: the whole alert's decision
 * state. Object rows come in as children (the page owns their ordering and
 * wiring); the rail itself owns only the frame and the alert-level
 * missed-smoke row. Clicking the row body activates the missed-smoke
 * section (the page swaps the media column to the whole-alert player);
 * the Yes/No chips are always answerable directly.
 */

import React from 'react';

export interface DecisionRailProps {
  missedSmokeReview: 'yes' | 'no' | null;
  onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
  /** True when the missed-smoke section is the active one (activeSection === 'sequence'). */
  missedSmokeActive: boolean;
  /** Called when the row is clicked — the page sets activeSection to 'sequence' (swaps the player). */
  onMissedSmokeActivate: () => void;
  /** Disables Yes/No (e.g. no open lane to carry the flag). */
  missedSmokeDisabled?: boolean;
  missedSmokeRowRef?: React.RefObject<HTMLDivElement>;
  /** Rendered top-right of the Objects header (e.g. the keyboard-shortcuts button). */
  headerAction?: React.ReactNode;
  /** Rendered after the missed-smoke row — the page passes its rail-level Submit button here. */
  footer?: React.ReactNode;
  /** Object rows / placeholders, already ordered. */
  children: React.ReactNode;
}

const chip = (selected: boolean, selectedClasses: string, disabled: boolean) =>
  `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-body text-xs font-medium transition-colors ${
    selected ? selectedClasses : 'border-line bg-paper text-char hover:bg-ash'
  } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;

export const DecisionRail: React.FC<DecisionRailProps> = ({
  missedSmokeReview,
  onMissedSmokeReviewChange,
  missedSmokeActive,
  onMissedSmokeActivate,
  missedSmokeDisabled = false,
  missedSmokeRowRef,
  headerAction,
  footer,
  children,
}) => (
  <div className="rounded-card border border-line bg-paper px-[22px] py-5">
    <div className="mb-3 flex items-center justify-between">
      <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
        Objects
      </div>
      {headerAction}
    </div>
    <div className="space-y-2">{children}</div>

    <hr className="border-0 border-t border-line my-4" />

    <div
      ref={missedSmokeRowRef}
      data-testid="missed-smoke-row"
      // Tab stop: tabbing to the row activates the missed-smoke section
      // (media swaps to the whole-alert player). Guarded to direct focus so
      // tabbing/clicking onto the Yes/No chips answers without swapping.
      tabIndex={0}
      onFocus={e => {
        if (e.target === e.currentTarget) onMissedSmokeActivate();
      }}
      onClick={onMissedSmokeActivate}
      className={`rounded-lg border border-line px-3.5 py-2.5 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-ember ${
        missedSmokeActive ? 'border-l-[3px] border-l-ember' : 'hover:bg-ash'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-body text-sm font-semibold text-char">Missed smoke?</span>
        <span
          role="radiogroup"
          aria-label="Missed smoke review"
          className="flex items-center gap-1.5"
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            tabIndex={-1}
            role="radio"
            aria-checked={missedSmokeReview === 'yes'}
            aria-label="Yes"
            disabled={missedSmokeDisabled}
            onClick={() => onMissedSmokeReviewChange('yes')}
            className={chip(
              missedSmokeReview === 'yes',
              'border-ember bg-ember-soft text-ember',
              missedSmokeDisabled
            )}
          >
            Yes
            <kbd
              aria-hidden="true"
              className="px-1 py-0.5 rounded bg-ash font-data text-[10px] font-medium text-haze"
            >
              Y
            </kbd>
          </button>
          <button
            type="button"
            tabIndex={-1}
            role="radio"
            aria-checked={missedSmokeReview === 'no'}
            aria-label="No"
            disabled={missedSmokeDisabled}
            onClick={() => onMissedSmokeReviewChange('no')}
            className={chip(
              missedSmokeReview === 'no',
              'border-pine bg-pine text-white',
              missedSmokeDisabled
            )}
          >
            No
            <kbd
              aria-hidden="true"
              className="px-1 py-0.5 rounded bg-ash font-data text-[10px] font-medium text-haze"
            >
              N
            </kbd>
          </button>
        </span>
      </div>
      {missedSmokeActive && (
        <p className="mt-1.5 font-body text-detail text-haze">
          The player is showing the whole alert sequence — answer once you've watched it.
        </p>
      )}
    </div>

    {footer && <div className="mt-4">{footer}</div>}
  </div>
);
