/**
 * Visual identity for a box's SOURCE (who proposed it), shared by the rail
 * rows, the box on the stage, the ghost outlines and the filmstrip badges, so
 * one source reads the same everywhere on this screen.
 *
 * TWO palettes, because these marks live on two very different surfaces.
 *
 * `SOURCE_STROKE` draws on the PHOTOGRAPH. Wildfire frames are sky (light
 * grey-blue), smoke (white to mid grey) and terrain (dark green-brown), so
 * anything neutral disappears into one of them — an earlier ordinal ramp in
 * the app's own neutrals (char / pine / haze) was unreadable for exactly that
 * reason: char vanished into terrain, haze into smoke. These are high-chroma
 * hues chosen because they do NOT occur in the scene, and every box is drawn
 * with `HALO_SHADOW` so the stroke survives even against bright sky.
 *
 * `SOURCE_TEXT` draws on PAPER, where the same hues would fail WCAG. These
 * are darkened counterparts of the same three, each clearing 4.5:1 on white.
 *
 * Deliberately outside DESIGN.md's semantic tokens, on the same reasoning
 * `objectColors.ts` gives: ember/pine/signal mark action, positive state and
 * error, and a box's provenance is none of those. Legibility over a
 * photograph is a different problem from chrome, and it wins here.
 *
 * The manual > auto > engine hierarchy is carried by STROKE WEIGHT AND STYLE
 * rather than by colour — see `SOURCE_WEIGHT`. Weight reads on any
 * background; a lightness ramp does not.
 */

import type { BoxSource } from '@/utils/annotation/objectBoxCandidates';

export const SOURCE_ORDER: BoxSource[] = ['manual', 'auto', 'engine'];

export const SOURCE_LABEL: Record<BoxSource, string> = {
  manual: 'Manual',
  auto: 'Auto',
  engine: 'Engine',
};

/** Stroke colour over imagery. High chroma, absent from wildfire scenes. */
export const SOURCE_STROKE: Record<BoxSource, string> = {
  manual: '#FF2D95', // magenta — reads on sky, smoke and terrain alike
  auto: '#00D5FF', // cyan
  engine: '#FFC400', // amber
};

/**
 * Kept as the canvas-facing name so overlay code reads naturally; identical
 * to `SOURCE_STROKE`.
 */
export const SOURCE_COLOR = SOURCE_STROKE;

/** Border width in px, descending with the source's claim. */
export const SOURCE_WEIGHT: Record<BoxSource, number> = {
  manual: 4,
  auto: 3,
  engine: 2,
};

/**
 * A dark ring hugging the stroke on both sides, so a bright box stays visible
 * against a bright sky without dimming the hue itself.
 *
 * Divided by the zoom, like every other stroke on the stage: these marks live
 * inside the scaled layer, so a ring authored in CSS pixels would be drawn
 * three times as thick at 3x.
 */
export const haloShadow = (scale = 1): string => {
  const ring = 1 / scale;
  return `0 0 0 ${ring}px rgba(0,0,0,0.65), inset 0 0 0 ${ring}px rgba(0,0,0,0.65)`;
};

/** Accessible counterparts for badges and labels on paper (>= 4.5:1 on white). */
export const SOURCE_TEXT: Record<BoxSource, string> = {
  manual: 'text-[#C2185B]',
  auto: 'text-[#00707F]',
  engine: 'text-[#8A6100]',
};

/** Filmstrip badge letter; lowercased when the source is available but uncommitted. */
export const SOURCE_LETTER: Record<BoxSource, string> = {
  manual: 'M',
  auto: 'A',
  engine: 'E',
};
