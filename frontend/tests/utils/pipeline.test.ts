import { describe, it, expect } from 'vitest';
import { derivePipelineStats } from '@/utils/pipeline';

describe('derivePipelineStats', () => {
  const raw = {
    total: 522,
    readyToAnnotate: 57,
    seqAnnotationDone: 22,
    inReview: 4,
    annotatedStage: 427,
    detectionComplete: 418,
    needsManual: 4,
  };

  it('maps raw stage counts to presented pipeline states', () => {
    const s = derivePipelineStats(raw);
    expect(s.classifyTodo).toBe(57);
    expect(s.classifyDone).toBe(22 + 4 + 427);
    expect(s.localizeTodo).toBe(22);
    expect(s.complete).toBe(418);
    expect(s.completePct).toBe(80);
    expect(s.attention).toBe(4);
    expect(s.total).toBe(522);
  });

  it('is zero-safe when there are no sequences', () => {
    const s = derivePipelineStats({
      total: 0,
      readyToAnnotate: 0,
      seqAnnotationDone: 0,
      inReview: 0,
      annotatedStage: 0,
      detectionComplete: 0,
      needsManual: 0,
    });
    expect(s.completePct).toBe(0);
    expect(s.classifyDone).toBe(0);
  });
});
