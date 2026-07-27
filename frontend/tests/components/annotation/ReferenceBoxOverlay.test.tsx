/**
 * Tests for ReferenceBoxOverlay: the read-only model reference layer.
 * Verifies line style encodes the layer (engine dotted / auto dashed),
 * border color encodes the active smoke_type, boxes are non-interactive,
 * and nothing renders without predictions.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { ReferenceBoxOverlay } from '@/components/annotation/ImageOverlays';
import { AlgoPrediction } from '@/types/api';
import { ImageInfo } from '@/utils/annotation/coordinateUtils';

const imageInfo: ImageInfo = { width: 100, height: 100, offsetX: 0, offsetY: 0 };

const preds: AlgoPrediction[] = [
  { xyxyn: [0.1, 0.1, 0.2, 0.2], confidence: 0.5, class_name: 'smoke' },
  { xyxyn: [0.3, 0.3, 0.5, 0.5], confidence: 0.8, class_name: 'smoke' },
];

describe('ReferenceBoxOverlay', () => {
  it('renders the engine layer dotted, colored by the active smoke_type', () => {
    const { container } = render(
      <ReferenceBoxOverlay
        predictions={preds}
        variant="engine"
        smokeType="wildfire"
        imageInfo={imageInfo}
        detectionId={1}
      />
    );
    const boxes = container.querySelectorAll('.border-2');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].className).toContain('border-dotted');
    expect(boxes[0].className).toContain('border-red-500');
  });

  it('renders the auto layer dashed, recolored when the smoke_type changes', () => {
    const { container } = render(
      <ReferenceBoxOverlay
        predictions={preds}
        variant="auto"
        smokeType="industrial"
        imageInfo={imageInfo}
        detectionId={1}
      />
    );
    const box = container.querySelector('.border-2');
    expect(box?.className).toContain('border-dashed');
    expect(box?.className).toContain('border-purple-500');
  });

  it('is non-interactive', () => {
    const { container } = render(
      <ReferenceBoxOverlay
        predictions={preds}
        variant="engine"
        smokeType="wildfire"
        imageInfo={imageInfo}
        detectionId={1}
      />
    );
    expect(container.querySelector('.border-2')?.className).toContain('pointer-events-none');
  });

  it('renders nothing when there are no predictions', () => {
    const { container } = render(
      <ReferenceBoxOverlay
        predictions={[]}
        variant="engine"
        smokeType="wildfire"
        imageInfo={imageInfo}
        detectionId={1}
      />
    );
    expect(container.querySelectorAll('.border-2')).toHaveLength(0);
  });
});
