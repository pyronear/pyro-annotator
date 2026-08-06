/**
 * The localize cockpit's right-hand column: the whole alert's localization
 * state, mirroring classify's `DecisionRail`. Object rows come in as
 * children (the page owns their ordering and wiring); the rail owns only the
 * frame, the missed-smoke slot below the rows, and the submit footer.
 */

import React from 'react';

export interface LocalizeRailProps {
  /** Rendered top-right of the Objects header. */
  headerAction?: React.ReactNode;
  /** The shared timeline legend — rendered below the rows, above the missed-smoke divider. */
  legend?: React.ReactNode;
  /** The missed-smoke question — rendered below the rows. */
  missedSmoke?: React.ReactNode;
  /** The page's submit button. */
  footer?: React.ReactNode;
  /** Object rows, already ordered. */
  children: React.ReactNode;
}

export const LocalizeRail: React.FC<LocalizeRailProps> = ({
  headerAction,
  legend,
  missedSmoke,
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

    {legend && <div className="mt-3">{legend}</div>}

    {missedSmoke && (
      <>
        <hr className="my-4 border-0 border-t border-line" />
        {missedSmoke}
      </>
    )}

    {footer && <div className="mt-4">{footer}</div>}
  </div>
);
