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

    const box = container.querySelector('.border-2') as HTMLElement;
    expect(box.style.borderColor).toBe('rgb(22, 106, 93)'); // #166A5D
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
    expect(container.querySelector('.border-2')?.className).toContain('pointer-events-none');
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
    expect(container.querySelectorAll('.border-2')).toHaveLength(2);
  });

  it('renders nothing when there are no objects', () => {
    const { container } = render(<ObjectIdentityOverlay imageInfo={imageInfo} objects={[]} />);
    expect(container.querySelectorAll('.border-2')).toHaveLength(0);
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
    expect(container.querySelectorAll('.border-2')).toHaveLength(0);
  });
});
