/**
 * A hover/focus tooltip for a single control — the styled counterpart of the
 * browser's `title`, which arrives after a delay, can't be themed, and never
 * shows up for keyboard users at all.
 *
 * CSS-only, like the hand-rolled bubble in `sequences/ColumnHeader` it takes
 * its look from: no timers, no positioning library, no state. That one (and
 * the two in the sequence-group pages) still carries its own copy — this is
 * the version worth migrating them onto, not a migration that happened.
 * `group-focus-within` earns the tooltip its keyboard path, and
 * `aria-describedby` (wired onto the trigger, so the trigger keeps its own
 * accessible name) gives screen readers the same sentence sighted users hover
 * for.
 *
 * The bubble grows leftward from the trigger's right edge: its callers sit in
 * a narrow rail, where a centered bubble would overhang the panel. Flat and
 * dark per DESIGN.md — hairlines and ink, no drop shadow.
 */

import React from 'react';

export interface TooltipProps {
  /** The sentence to show. Plain text — this is a description, not a layout slot. */
  tip: string;
  /**
   * Which side of the trigger the bubble hangs off. The caller decides
   * because the panel edge decides: a control at the bottom of the rail
   * needs `above`, or its bubble is clipped by the rail's own scroll box.
   */
  placement?: 'below' | 'above';
  /** The control being described. Receives `aria-describedby`. */
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
  /**
   * Extra classes for the wrapper. The root is `inline-flex`, which shrinks
   * to its trigger — a full-width control inside one needs the wrapper to be
   * told it is full width too, or it collapses to its content.
   */
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  tip,
  placement = 'below',
  children,
  className = '',
}) => {
  const id = React.useId();

  return (
    <span className={`group relative inline-flex ${className}`}>
      {React.cloneElement(children, {
        // Appended, not assigned: a trigger that already points at its own
        // description keeps it, and gains this one.
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      })}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute right-0 z-20 hidden w-max max-w-[15rem] whitespace-normal rounded-lg bg-char px-2.5 py-1.5 font-body text-xs font-normal normal-case leading-snug tracking-normal text-white group-hover:block group-focus-within:block ${
          placement === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
        }`}
      >
        {tip}
      </span>
    </span>
  );
};
