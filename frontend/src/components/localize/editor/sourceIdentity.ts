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
 * hues chosen because they do NOT occur in the scene, which is what lets them
 * carry a hairline stroke unaided — an earlier dark halo behind every box was
 * dropped once the strokes got thin enough for it to outweigh them.
 *
 * Deliberately outside DESIGN.md's semantic tokens, on the same reasoning
 * `objectColors.ts` gives: ember/pine/signal mark action, positive state and
 * error, and a box's provenance is none of those. Legibility over a
 * photograph is a different problem from chrome, and it wins here.
 *
 * The manual > auto > engine hierarchy is carried by STROKE WEIGHT rather
 * than by colour — see `SOURCE_WEIGHT`. Weight reads on any background; a
 * lightness ramp does not.
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

/**
 * Stroke width in px, descending with the source's claim.
 *
 * Kept deliberately hairline. A wildfire at the start of an alert can be a
 * dozen pixels across, and a stroke authored for comfort at alert scale sits
 * ON the smoke rather than around it — you end up drawing against your own
 * box. The ladder still reads because colour separates the three sources
 * anyway; weight only has to break the tie.
 *
 * These are drawn as PAINT, not as CSS borders — a border cannot render below
 * one device pixel per unit of zoom, which silently flattened this whole
 * ladder to a single width whenever the annotator zoomed in. See
 * `utils/annotation/hairlineStroke`.
 *
 * Because the paint path is honest, these numbers are now literal device
 * pixels on screen, and the floor is 1: below that a stroke is anti-aliased
 * to partial alpha and reads as missing rather than as thin.
 */
export const SOURCE_WEIGHT: Record<BoxSource, number> = {
  manual: 2,
  auto: 1.5,
  engine: 1,
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

/**
 * The rail's fourth row is not a source, so it sits outside
 * `SOURCE_EXPLANATION`'s record — but it answers the same question the
 * source tooltips do, in the same voice.
 */
export const NONE_EXPLANATION =
  'Records that this object is not visible on this frame. The frame counts as done and no box is saved — the models keep their boxes, so picking one above undoes it.';
