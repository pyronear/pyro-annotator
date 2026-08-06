import { describe, it, expect } from 'vitest';
import { derivePipelineStats } from '@/utils/pipeline';

describe('derivePipelineStats', () => {
  const raw = {
    total: 522,
    seqAnnotationDone: 22,
    annotatedStage: 427,
    detectionComplete: 418,
    localizeQueueTotal: 9,
    classifyQueueTotal: 31,
  };

  it('maps raw stage counts to presented pipeline states', () => {
    const s = derivePipelineStats(raw);
    // Classify · to do reads the alert-grouped queue total, not the
    // per-lane ready_to_annotate count.
    expect(s.classifyTodo).toBe(31);
    expect(s.classifyDone).toBe(22 + 427);
    // Localize · to do reads the gated queue total, not the stage proxy.
    expect(s.localizeTodo).toBe(9);
    expect(s.complete).toBe(418);
    expect(s.completePct).toBe(80);
    expect(s.total).toBe(522);
  });

  it('is zero-safe when there are no sequences', () => {
    const s = derivePipelineStats({
      total: 0,
      seqAnnotationDone: 0,
      annotatedStage: 0,
      detectionComplete: 0,
      localizeQueueTotal: 0,
      classifyQueueTotal: 0,
    });
    expect(s.completePct).toBe(0);
    expect(s.classifyDone).toBe(0);
  });
});
