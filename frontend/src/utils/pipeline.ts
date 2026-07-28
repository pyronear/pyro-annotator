/**
 * Presentation-layer pipeline taxonomy.
 *
 * Maps raw processing-stage counts onto the two-pass pipeline shown on the
 * dashboard (Classify → Localize → Complete). See
 * docs/specs/2026-07-28-dashboard-taxonomy-redesign-design.md for the mapping
 * rationale. `imported`, `no_annotation` and `under_annotation` are deliberate
 * omissions: import plumbing and a vestigial claim marker, never shown.
 */

export interface RawPipelineCounts {
  total: number;
  readyToAnnotate: number;
  seqAnnotationDone: number;
  inReview: number;
  annotatedStage: number;
  detectionComplete: number;
  needsManual: number;
}

export interface PipelineStats {
  total: number;
  classifyTodo: number;
  classifyDone: number;
  localizeTodo: number;
  complete: number;
  completePct: number;
  attention: number;
}

export function derivePipelineStats(raw: RawPipelineCounts): PipelineStats {
  const classifyDone = raw.seqAnnotationDone + raw.inReview + raw.annotatedStage;
  return {
    total: raw.total,
    classifyTodo: raw.readyToAnnotate,
    classifyDone,
    // Proxy: classify submit parks sequences at seq_annotation_done; finishing
    // localization moves them to annotated.
    localizeTodo: raw.seqAnnotationDone,
    complete: raw.detectionComplete,
    completePct: raw.total > 0 ? Math.round((raw.detectionComplete / raw.total) * 100) : 0,
    attention: raw.needsManual,
  };
}
