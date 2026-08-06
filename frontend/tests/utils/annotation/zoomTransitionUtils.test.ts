import { describe, it, expect } from 'vitest';
import { zoomKeyframes } from '@/utils/annotation/zoomTransitionUtils';

describe('zoomKeyframes', () => {
  it('maps the cell rect to a translate+scale pose of the full viewport', () => {
    const { atCell, full } = zoomKeyframes(
      { left: 100, top: 50, width: 200, height: 150 },
      { width: 1000, height: 600 }
    );
    expect(atCell.transform).toBe('translate(100px, 50px) scale(0.2, 0.25)');
    expect(atCell.opacity).toBe(0.55);
    expect(full).toEqual({ transform: 'none', opacity: 1 });
  });

  it('handles a cell at the viewport origin', () => {
    const { atCell } = zoomKeyframes(
      { left: 0, top: 0, width: 500, height: 300 },
      { width: 1000, height: 600 }
    );
    expect(atCell.transform).toBe('translate(0px, 0px) scale(0.5, 0.5)');
  });
});
