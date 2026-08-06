/**
 * Presentation-layer pipeline taxonomy.
 *
 * Maps raw counts onto the two-pass pipeline shown on the dashboard
 * (Classify → Localize → Complete). See
 * docs/specs/2026-07-28-dashboard-taxonomy-redesign-design.md for the mapping
 * rationale. `imported` and `no_annotation` are deliberate omissions: import
 * plumbing, never shown.
 *
 * Unit discipline: every per-pass number is an ALERT count, taken from the
 * alert-grouped queue endpoints that back the pages those numbers link to. The
 * one exception is `complete`/`completePct`, which is object-grained on
 * purpose and labelled as such in the UI. Mixing the two inside a single card
 * made its progress bar divide objects by (alerts + objects).
 */

export interface RawPipelineCounts {
  /** All sequences (objects) — denominator of the object-grained Complete %. */
  total: number;
  /** Objects whose detection-level annotation is finished. */
  detectionComplete: number;
  // Totals of the alert-grouped queues — each matches exactly what the page it
  // links to shows.
  localizeQueueTotal: number;
  classifyQueueTotal: number;
  classifyDoneTotal: number;
  localizeDoneTotal: number;
}

export interface PipelineStats {
  total: number;
  classifyTodo: number;
  classifyDone: number;
  localizeTodo: number;
  localizeDone: number;
  complete: number;
  completePct: number;
}

export function derivePipelineStats(raw: RawPipelineCounts): PipelineStats {
  return {
    total: raw.total,
    classifyTodo: raw.classifyQueueTotal,
    classifyDone: raw.classifyDoneTotal,
    localizeTodo: raw.localizeQueueTotal,
    localizeDone: raw.localizeDoneTotal,
    complete: raw.detectionComplete,
    completePct: raw.total > 0 ? Math.round((raw.detectionComplete / raw.total) * 100) : 0,
  };
}
