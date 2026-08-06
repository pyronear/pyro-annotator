import { describe, it, expect } from 'vitest';
import { derivePipelineStats } from '@/utils/pipeline';

describe('derivePipelineStats', () => {
  const raw = {
    total: 522,
    detectionComplete: 418,
    localizeQueueTotal: 9,
    classifyQueueTotal: 31,
    classifyDoneTotal: 449,
    localizeDoneTotal: 402,
  };

  it('maps raw counts to presented pipeline states', () => {
    const s = derivePipelineStats(raw);
    // Every card number is alert-grained: to do and done both come from the
    // alert-grouped queues, so a card's two halves are the same unit and its
    // progress bar is a real ratio.
    expect(s.classifyTodo).toBe(31);
    expect(s.classifyDone).toBe(449);
    expect(s.localizeTodo).toBe(9);
    expect(s.localizeDone).toBe(402);
    // The Complete strip segment stays object-grained — it is labelled
    // "% of all objects" and its denominator is all sequences.
    expect(s.complete).toBe(418);
    expect(s.completePct).toBe(80);
    expect(s.total).toBe(522);
  });

  it('is zero-safe when there are no sequences', () => {
    const s = derivePipelineStats({
      total: 0,
      detectionComplete: 0,
      localizeQueueTotal: 0,
      classifyQueueTotal: 0,
      classifyDoneTotal: 0,
      localizeDoneTotal: 0,
    });
    expect(s.completePct).toBe(0);
    expect(s.classifyDone).toBe(0);
    expect(s.localizeDone).toBe(0);
  });
});
