/**
 * Presentation-layer pipeline taxonomy.
 *
 * Maps raw processing-stage counts onto the two-pass pipeline shown on the
 * dashboard (Classify → Localize → Complete). See
 * docs/specs/2026-07-28-dashboard-taxonomy-redesign-design.md for the mapping
 * rationale. `imported` and `no_annotation` are deliberate omissions: import
 * plumbing, never shown.
 */

export interface RawPipelineCounts {
  total: number;
  readyToAnnotate: number;
  seqAnnotationDone: number;
  annotatedStage: number;
  detectionComplete: number;
  // Total of the gated localization queue (alerts ready for smoke
  // localization) — matches exactly what /localize shows.
  localizeQueueTotal: number;
}

export interface PipelineStats {
  total: number;
  classifyTodo: number;
  classifyDone: number;
  localizeTodo: number;
  complete: number;
  completePct: number;
}

export function derivePipelineStats(raw: RawPipelineCounts): PipelineStats {
  return {
    total: raw.total,
    classifyTodo: raw.readyToAnnotate,
    classifyDone: raw.seqAnnotationDone + raw.annotatedStage,
    localizeTodo: raw.localizeQueueTotal,
    complete: raw.detectionComplete,
    completePct: raw.total > 0 ? Math.round((raw.detectionComplete / raw.total) * 100) : 0,
  };
}
