/**
 * Tests for ObjectIdentityOverlay: the collocated localize editor's
 * replacement for the generic "sibling NN%" layer — renders OTHER objects'
 * boxes color-coded and labeled with their own object identity.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ObjectIdentityOverlay } from '@/components/annotation/ImageOverlays';
import { ImageInfo } from '@/utils/annotation/coordinateUtils';

const imageInfo: ImageInfo = { width: 100, height: 100, offsetX: 0, offsetY: 0 };

describe('ObjectIdentityOverlay', () => {
  it('renders each object\'s boxes with its own color and "Object N" label', () => {
    render(
      <ObjectIdentityOverlay
        imageInfo={imageInfo}
        objects={[
          { color: '#166A5D', label: 'Object 2', boxes: [{ xyxyn: [0.1, 0.1, 0.2, 0.2] }] },
          { color: '#D9581E', label: 'Object 3', boxes: [{ xyxyn: [0.3, 0.3, 0.4, 0.4] }] },
        ]}
      />
    );

    expect(screen.getByText('Object 2')).toBeInTheDocument();
    expect(screen.getByText('Object 3')).toBeInTheDocument();
    expect(screen.queryByText(/sibling/i)).not.toBeInTheDocument();
  });

  it("colors each box's border and label chip with the object's own color", () => {
    const { container } = render(
      <ObjectIdentityOverlay
        imageInfo={imageInfo}
        objects={[{ color: '#166A5D', label: 'Object 2', boxes: [{ xyxyn: [0.1, 0.1, 0.2, 0.2] }] }]}
      />
    );

    const box = container.querySelector('[data-testid="object-overlay-box"]') as HTMLElement;
    // The stroke is painted as a box-shadow ring rather than laid out as a
    // CSS border, so the colour lands there. See hairlineStroke.
    expect(box.style.boxShadow).toContain('#166A5D');
    const label = screen.getByText('Object 2');
    expect(label.style.backgroundColor).toBe('rgb(22, 106, 93)');
  });

  it('is non-interactive (pointer-events-none)', () => {
    const { container } = render(
      <ObjectIdentityOverlay
        imageInfo={imageInfo}
        objects={[{ color: '#166A5D', label: 'Object 2', boxes: [{ xyxyn: [0.1, 0.1, 0.2, 0.2] }] }]}
      />
    );
    expect(container.querySelector('[data-testid="object-overlay-box"]')?.className).toContain('pointer-events-none');
  });

  it('renders multiple boxes for the same object', () => {
    const { container } = render(
      <ObjectIdentityOverlay
        imageInfo={imageInfo}
        objects={[
          {
            color: '#166A5D',
            label: 'Object 2',
            boxes: [
              { xyxyn: [0.1, 0.1, 0.2, 0.2] },
              { xyxyn: [0.3, 0.3, 0.4, 0.4] },
            ],
          },
        ]}
      />
    );
    expect(container.querySelectorAll('[data-testid="object-overlay-box"]')).toHaveLength(2);
  });

  it('renders nothing when there are no objects', () => {
    const { container } = render(<ObjectIdentityOverlay imageInfo={imageInfo} objects={[]} />);
    expect(container.querySelectorAll('[data-testid="object-overlay-box"]')).toHaveLength(0);
  });

  it('skips an invalid box without crashing', () => {
    const { container } = render(
      <ObjectIdentityOverlay
        imageInfo={imageInfo}
        objects={[
          { color: '#166A5D', label: 'Object 2', boxes: [{ xyxyn: [0.5, 0.5, 0.2, 0.2] }] }, // x2<x1
        ]}
      />
    );
    expect(container.querySelectorAll('[data-testid="object-overlay-box"]')).toHaveLength(0);
  });

  // These boxes live inside the canvas's scaled layer, so a stroke authored in
  // flat CSS pixels is drawn `zoomLevel` times as thick — worst exactly when
  // the annotator has zoomed in on a small smoke.
  it('divides the stroke by the zoom so it keeps its on-screen weight', () => {
    const strokeAt = (strokeScale: number) => {
      const { container } = render(
        <ObjectIdentityOverlay
          imageInfo={imageInfo}
          strokeScale={strokeScale}
          objects={[
            { color: '#166A5D', label: 'Object 2', boxes: [{ xyxyn: [0.1, 0.1, 0.2, 0.2] }] },
          ]}
        />
      );
      const box = container.querySelector('[data-testid="object-overlay-box"]') as HTMLElement;
      // The ring's spread radius is the stroke width: `0 0 0 <spread>px <color>`.
      const lengths = box.style.boxShadow.match(/[\d.]+px/g) ?? [];
      return parseFloat(lengths[lengths.length - 1]);
    };

    const at1x = strokeAt(1);
    expect(at1x).toBeGreaterThan(0);
    expect(strokeAt(4)).toBeCloseTo(at1x / 4);
  });

  // The regression this whole approach exists for: a CSS border cannot paint
  // below one device pixel per unit of zoom, so it must not come back.
  it('paints the stroke rather than laying it out as a border', () => {
    const { container } = render(
      <ObjectIdentityOverlay
        imageInfo={imageInfo}
        strokeScale={3}
        objects={[{ color: '#166A5D', label: 'Object 2', boxes: [{ xyxyn: [0.1, 0.1, 0.2, 0.2] }] }]}
      />
    );
    const box = container.querySelector('[data-testid="object-overlay-box"]') as HTMLElement;
    // Both spellings: this box carried its border as a Tailwind class
    // (`border-2 border-dashed`), so asserting on the inline style alone
    // would pass against the very code this guards against.
    expect(box.className).not.toMatch(/\bborder(-|\b)/);
    expect(box.style.borderWidth).toBe('');
    expect(box.style.boxShadow).not.toBe('');
  });
});
