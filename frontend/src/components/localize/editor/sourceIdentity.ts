/**
 * Visual identity for a box's SOURCE (who proposed it), shared by the rail
 * rows, the box on the stage, the ghost outlines and the filmstrip badges, so
 * one source reads the same everywhere on this screen.
 *
 * The three sources are not peers — they are a priority ladder, manual > auto
 * > engine, and the screen's whole job is deciding where on it this frame
 * sits. So they are encoded ORDINALLY, as descending strength in DESIGN.md's
 * own neutrals plus the Localize accent, rather than as three unrelated hues:
 *
 *   manual  char  the human's own answer, the strongest claim
 *   auto    pine  Localize's accent
 *   engine  haze  muted, the weakest claim
 *
 * This also keeps the source vocabulary clear of `objectColors.ts`, whose
 * categorical palette distinguishes objects from each other. An earlier
 * categorical scheme collided with it badly — engine's blue sat next to
 * Object 1's blue, so a dashed blue box was ambiguous between "the engine's
 * proposal for your object" and "Object 1's box".
 */

import type { BoxSource } from '@/utils/annotation/objectBoxCandidates';

export const SOURCE_ORDER: BoxSource[] = ['manual', 'auto', 'engine'];

export const SOURCE_LABEL: Record<BoxSource, string> = {
  manual: 'Manual',
  auto: 'Auto',
  engine: 'Engine',
};

/** DESIGN.md tokens, as literals for the canvas overlays that style inline. */
export const SOURCE_COLOR: Record<BoxSource, string> = {
  manual: '#20261F', // char
  auto: '#166A5D', // pine
  engine: '#767B72', // haze
};

/** Tailwind text colour for the same ladder, for markup that can use classes. */
export const SOURCE_TEXT: Record<BoxSource, string> = {
  manual: 'text-char',
  auto: 'text-pine',
  engine: 'text-haze',
};

/** Filmstrip badge letter; lowercased when the source is available but uncommitted. */
export const SOURCE_LETTER: Record<BoxSource, string> = {
  manual: 'M',
  auto: 'A',
  engine: 'E',
};
