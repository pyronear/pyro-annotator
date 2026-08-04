/**
 * The media column's control bar, lifted out of the frames card into a panel
 * of its own: what you're looking at (left), what to do about it (centre),
 * and how to render it (right).
 *
 * The actions used to sit inside the frames card's header, competing with the
 * column's name, the frame count and the view controls — where they read as
 * chrome. On their own line, centred and full-size, they read as the step to
 * take, and the card below goes back to being only the frames.
 *
 * Three flex tracks rather than a grid: `.grid` is a class the page's tests
 * use to find the frame grid itself, and a second grid above it would answer
 * to that name first. Equal `flex-1` ends keep the centre track centred on
 * the panel regardless of how wide the label or the toolbar are.
 */

import React from 'react';

export interface LocalizeActionPanelProps {
  /** Names what the frames below show, e.g. "Frames — Object 2". */
  title: string;
  /** Stable per-object color (hex) for the active object — omitted when nothing is active. */
  color?: string;
  /** The active object's buttons. Absent when no object is active. */
  actions?: React.ReactNode;
  /** Frame count and the view controls — always present, they belong to the grid, not the object. */
  controls: React.ReactNode;
}

export const LocalizeActionPanel: React.FC<LocalizeActionPanelProps> = ({
  title,
  color,
  actions,
  controls,
}) => (
  // Same card surface as the Objects rail beside it — paper on a hairline,
  // per DESIGN.md. A tinted bar would have made the controls read as a
  // toolbar bolted onto the page rather than one of its cards.
  // Padding is tighter than the rail's card beside it: this one is a control
  // bar that never scrolls away, so every row of it is a row the grid below
  // doesn't get. The buttons keep the view toolbar's height — shrinking them
  // instead would make the panel twitch as objects are selected.
  <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border border-line bg-paper px-4 py-1.5">
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {color && (
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-char/10"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      )}
      <span className="truncate font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
        {title}
      </span>
    </span>

    {actions && (
      <span
        data-testid="localize-active-object-actions"
        className="flex shrink-0 flex-wrap items-center justify-center gap-2"
      >
        {actions}
      </span>
    )}

    <span className="flex flex-1 shrink-0 items-center justify-end gap-2.5">{controls}</span>
  </div>
);
