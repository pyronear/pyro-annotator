/**
 * Visual identity for a box's SOURCE (who proposed it), shared by the rail
 * rows, the box on the stage, the ghost outlines and the filmstrip badges, so
 * one source reads the same everywhere on this screen.
 *
 * `SOURCE_STROKE` draws on the PHOTOGRAPH. Wildfire frames are sky (light
 * grey-blue), smoke (white to mid grey) and terrain (dark green-brown), so
 * anything neutral disappears into one of them — an earlier ordinal ramp in
 * the app's own neutrals (char / pine / haze) was unreadable for exactly that
 * reason: char vanished into terrain, haze into smoke. These are high-chroma
 * hues chosen because they do NOT occur in the scene, and every box is drawn
 * with `HALO_SHADOW` so the stroke survives even against bright sky.
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

/**
 * What each source IS, for the rail's tooltips. Written from the pipeline
 * rather than from the label: "auto" and "engine" say nothing on their own,
 * and which one to trust depends entirely on where each came from.
 */
export const SOURCE_EXPLANATION: Record<BoxSource, string> = {
  manual: 'A box you drew or adjusted here yourself. It always wins over the models.',
  auto: 'From the more sensitive model this app runs over the alert after import. Kept only where it agrees with the engine that something is there — usually tighter than the engine box.',
  engine: "From the camera's own detector — the box it raised this alert with.",
};
