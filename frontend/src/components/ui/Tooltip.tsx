/**
 * A hover/focus tooltip for a single control — the styled counterpart of the
 * browser's `title`, which arrives after a delay, can't be themed, and never
 * shows up for keyboard users at all.
 *
 * CSS-only, like the table headers' bubble it generalizes
 * (`sequences/ColumnHeader`): no timers, no positioning library, no state.
 * `group-focus-within` earns the tooltip its keyboard path, and
 * `aria-describedby` (wired onto the trigger, so the trigger keeps its own
 * accessible name) gives screen readers the same sentence sighted users hover
 * for.
 *
 * The bubble hangs below the trigger and grows leftward from its right edge:
 * both current callers sit at the right edge of a narrow rail, where a
 * centered bubble would overhang the panel. Flat and dark per DESIGN.md —
 * hairlines and ink, no drop shadow.
 */

import React from 'react';

export interface TooltipProps {
  /** The sentence to show. Plain text — this is a description, not a layout slot. */
  tip: string;
  /** The control being described. Receives `aria-describedby`. */
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
}

export const Tooltip: React.FC<TooltipProps> = ({ tip, children }) => {
  const id = React.useId();

  return (
    <span className="group relative inline-flex">
      {React.cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 hidden w-max max-w-[15rem] whitespace-normal rounded-lg bg-char px-2.5 py-1.5 font-body text-xs font-normal normal-case leading-snug tracking-normal text-white group-hover:block group-focus-within:block"
      >
        {tip}
      </span>
    </span>
  );
};
