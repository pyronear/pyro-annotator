/**
 * Unit tests for the model reference layer utilities.
 * Verifies the winning-layer rule that drives default canvas visibility.
 */

import { describe, it, expect } from 'vitest';
import { getWinningModelLayer } from '@/utils/annotation';
import { AlgoPredictions } from '@/types/api';

const preds = (n: number): AlgoPredictions => ({
  predictions: Array.from({ length: n }, () => ({
    xyxyn: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number],
    confidence: 0.5,
    class_name: 'smoke',
  })),
});

describe('getWinningModelLayer', () => {
  it('picks auto when auto_predictions has boxes', () => {
    expect(getWinningModelLayer({ auto_predictions: preds(1) })).toBe('auto');
  });

  it('picks engine when auto_predictions is empty', () => {
    expect(getWinningModelLayer({ auto_predictions: preds(0) })).toBe('engine');
  });

  it('picks engine when auto_predictions is null', () => {
    expect(getWinningModelLayer({ auto_predictions: null })).toBe('engine');
  });

  it('picks engine when auto_predictions is absent', () => {
    expect(getWinningModelLayer({})).toBe('engine');
  });
});
