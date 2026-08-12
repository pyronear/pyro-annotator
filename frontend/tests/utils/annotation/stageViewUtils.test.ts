import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  StageView,
  clampPan,
  clampScale,
  cropToPan,
  stageTransform,
  wheelZoomFactor,
  zoomAtPoint,
} from '@/utils/annotation/stageViewUtils';

/**
 * The forward transform, restated here independently of the module under
 * test: where a point at normalized image coordinate `u` lands, as a
 * fraction of the image's rendered size. Every anchoring claim below is
 * "this point projects to the same place before and after".
 */
const project = (u: number, view: StageView, axis: 'x' | 'y' = 'x') =>
  0.5 + view.scale * (u - 0.5 + view.pan[axis]);

/** The old transform-origin framing: origin `c` (a fraction) held fixed. */
const projectAboutOrigin = (u: number, scale: number, c: number) => c + scale * (u - c);

const AT_REST: StageView = { scale: 1, pan: { x: 0, y: 0 } };

describe('zoomAtPoint', () => {
  it('holds the point under the cursor still while zooming in', () => {
    const cursor = { x: 0.8, y: 0.3 };
    const zoomed = zoomAtPoint(AT_REST, cursor, 2);

    expect(zoomed.scale).toBe(2);
    expect(project(cursor.x, zoomed, 'x')).toBeCloseTo(project(cursor.x, AT_REST, 'x'), 10);
    expect(project(cursor.y, zoomed, 'y')).toBeCloseTo(project(cursor.y, AT_REST, 'y'), 10);
  });

  it('holds it still when zooming out of an already panned view', () => {
    const panned: StageView = { scale: 4, pan: { x: -0.1, y: 0.1 } };
    const cursor = { x: 0.45, y: 0.55 };
    const zoomed = zoomAtPoint(panned, cursor, 2.5);

    expect(project(cursor.x, zoomed, 'x')).toBeCloseTo(project(cursor.x, panned, 'x'), 10);
    expect(project(cursor.y, zoomed, 'y')).toBeCloseTo(project(cursor.y, panned, 'y'), 10);
  });

  it('lets the clamp win over the anchor rather than showing a blank edge', () => {
    // Zooming out shrinks the pan the image can afford — (z-1)/2z falls from
    // 0.375 to 0.3 here — so holding this point still would need a pan that
    // uncovers the frame. The anchor is what gives.
    const panned: StageView = { scale: 4, pan: { x: -0.2, y: 0.15 } };
    const zoomed = zoomAtPoint(panned, { x: 0.35, y: 0.62 }, 2.5);

    expect(zoomed.pan.x).toBeCloseTo(-0.3, 10);
    expect(Math.abs(zoomed.pan.x)).toBeLessThanOrEqual((2.5 - 1) / (2 * 2.5));
  });

  it('holds it still across a run of steps, so a wheel burst does not drift', () => {
    const cursor = { x: 0.18, y: 0.9 };
    let view = AT_REST;
    for (let i = 0; i < 8; i++) view = zoomAtPoint(view, cursor, view.scale * 1.15);

    expect(view.scale).toBeGreaterThan(3);
    expect(project(cursor.x, view, 'x')).toBeCloseTo(project(cursor.x, AT_REST, 'x'), 10);
  });

  it('refuses to zoom past the ceiling or below the full frame', () => {
    expect(zoomAtPoint(AT_REST, { x: 0.5, y: 0.5 }, 99).scale).toBe(MAX_ZOOM);
    expect(zoomAtPoint(AT_REST, { x: 0.5, y: 0.5 }, 0.2).scale).toBe(1);
  });

  it('returns to no pan at all when the zoom returns to 1', () => {
    const panned: StageView = { scale: 3, pan: { x: 0.3, y: -0.3 } };
    expect(zoomAtPoint(panned, { x: 0.1, y: 0.1 }, 1).pan).toEqual({ x: 0, y: 0 });
  });
});

describe('clampPan', () => {
  it('allows no pan at the full frame', () => {
    expect(clampPan({ x: 0.5, y: -0.5 }, 1)).toEqual({ x: 0, y: 0 });
  });

  it('stops the pan where the image would uncover its frame', () => {
    // Half the image is off-frame at 2x, and the pan sits inside the scale:
    // (z - 1) / 2z = 0.25.
    expect(clampPan({ x: 0.9, y: -0.9 }, 2)).toEqual({ x: 0.25, y: -0.25 });
    expect(clampPan({ x: 0.1, y: -0.1 }, 2)).toEqual({ x: 0.1, y: -0.1 });
  });
});

describe('clampScale', () => {
  it('holds the scale between the full frame and the ceiling', () => {
    expect(clampScale(0.5)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(20)).toBe(MAX_ZOOM);
  });
});

describe('cropToPan', () => {
  it('frames the object exactly where the transform-origin version did', () => {
    // The editor's own framing of the fixture box [0.2,0.2,0.3,0.3]:
    // 0.32 target fill over a 0.1 span clamps to scale 3, centred on 25%.
    const view = cropToPan({ scale: 3, originX: 25, originY: 25 });

    for (const u of [0, 0.25, 0.5, 1]) {
      expect(project(u, view, 'x')).toBeCloseTo(projectAboutOrigin(u, 3, 0.25), 10);
      expect(project(u, view, 'y')).toBeCloseTo(projectAboutOrigin(u, 3, 0.25), 10);
    }
  });

  it('is a no-op at scale 1, where there is nothing to frame', () => {
    expect(cropToPan({ scale: 1, originX: 50, originY: 50 })).toEqual({
      scale: 1,
      pan: { x: 0, y: 0 },
    });
  });
});

describe('wheelZoomFactor', () => {
  it('turns one mouse notch into a ~15% step, in whichever direction', () => {
    expect(wheelZoomFactor({ deltaY: -100 })).toBeCloseTo(1.15, 4);
    expect(wheelZoomFactor({ deltaY: 100 })).toBeCloseTo(1 / 1.15, 4);
  });

  it('reads a line-mode notch as comparable to a pixel-mode one', () => {
    // Firefox reports 3 lines where Chrome reports ~100px for the same notch.
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1 })).toBeCloseTo(1.148, 3);
  });

  it('scales with the delta, so a trackpad nudge is a nudge', () => {
    expect(wheelZoomFactor({ deltaY: -12 })).toBeCloseTo(1.017, 3);
  });
});

describe('stageTransform', () => {
  it('renders the pan as a percentage of the image, trimmed', () => {
    expect(stageTransform({ scale: 3, pan: { x: 0.5 / 3, y: 0.5 / 3 } })).toBe(
      'scale(3) translate(16.667%, 16.667%)'
    );
    expect(stageTransform({ scale: 1, pan: { x: 0, y: 0 } })).toBe('scale(1) translate(0%, 0%)');
  });

  it('trims the float noise a multiplicative step leaves on the scale', () => {
    expect(stageTransform({ scale: 1.1499999999999997, pan: { x: 0, y: 0 } })).toBe(
      'scale(1.15) translate(0%, 0%)'
    );
  });
});
