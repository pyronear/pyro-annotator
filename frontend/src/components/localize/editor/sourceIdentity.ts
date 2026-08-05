/**
 * Visual identity for a box's SOURCE (who proposed it), shared by the rail
 * rows, the stage's ghost outlines and the filmstrip badges so one source
 * reads the same everywhere on this screen.
 *
 * Deliberately not DESIGN.md's ember/pine/signal tokens — those mark action,
 * positive state and error, and a box's provenance is none of those. Also
 * deliberately not the object-identity palette in `objectColors.ts`, which
 * distinguishes objects from each other; on this screen there is exactly one
 * object and the thing being distinguished is where its box came from.
 */

import type { BoxSource } from '@/utils/annotation/objectBoxCandidates';

export const SOURCE_ORDER: BoxSource[] = ['manual', 'auto', 'engine'];

export const SOURCE_LABEL: Record<BoxSource, string> = {
  manual: 'Manual',
  auto: 'Auto',
  engine: 'Engine',
};

export const SOURCE_COLOR: Record<BoxSource, string> = {
  manual: '#f0a24b',
  auto: '#5bbf8f',
  engine: '#7aa7d9',
};

/** Filmstrip badge letter; lowercased when the source is available but uncommitted. */
export const SOURCE_LETTER: Record<BoxSource, string> = {
  manual: 'M',
  auto: 'A',
  engine: 'E',
};
