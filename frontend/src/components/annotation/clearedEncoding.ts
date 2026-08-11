/**
 * The `cleared` encoding — a frame committed with no box, "object not
 * visible here" — as a 45° hatch in the object's own colour.
 *
 * Its own module rather than an export from one of the components that draws
 * it: four surfaces share this one visual, and a component file may not
 * export non-components (react-refresh). Today the accept popover's segments
 * and legend swatch import it; `ObjectRowTimeline` and `TimelineLegend`, in
 * this same directory, still carry copies written before it existed and are
 * the obvious next callers.
 *
 * Hatched rather than solid on purpose: a cleared frame is settled like a
 * confirmed one, but a solid fill would show a box the frame does not have.
 */

import type { CSSProperties } from 'react';

export function clearedHatch(color: string): CSSProperties {
  return {
    backgroundImage: `repeating-linear-gradient(45deg, ${color} 0px, ${color} 2px, transparent 2px, transparent 4px)`,
  };
}
