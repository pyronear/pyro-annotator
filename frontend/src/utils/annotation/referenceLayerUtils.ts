/**
 * Read-only model reference layers on the detection review canvas.
 *
 * Two immutable model layers can be shown: `engine` (Detection.algo_predictions)
 * and `auto` (Detection.auto_predictions). Exactly one is the "winning" layer —
 * the basis the human annotation is seeded from at submit: auto beats engine when
 * auto has any predictions, otherwise engine. By default the canvas shows only the
 * winning layer; the other is hidden and can be toggled on for investigation.
 */

import { Detection } from '@/types/api';

export type ModelLayer = 'engine' | 'auto';

/**
 * The winning model layer for a detection: `auto` if auto_predictions has any
 * boxes, otherwise `engine`.
 */
export function getWinningModelLayer(detection: Pick<Detection, 'auto_predictions'>): ModelLayer {
  const autoCount = detection.auto_predictions?.predictions?.length ?? 0;
  return autoCount > 0 ? 'auto' : 'engine';
}
