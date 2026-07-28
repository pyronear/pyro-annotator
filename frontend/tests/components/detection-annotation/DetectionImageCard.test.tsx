import React from 'react';
import { render, screen } from '@testing-library/react';
import { DetectionImageCard } from '@/components/detection-annotation/DetectionImageCard';
import type { Detection, DetectionAnnotation } from '@/types/api';

vi.mock('@/hooks/useDetectionImage', () => ({
  useDetectionImage: () => ({ data: { url: 'http://test/img.jpg' }, isLoading: false }),
}));

vi.mock('@/components/annotation/ImageOverlays', () => ({
  BoundingBoxOverlay: () => <div data-testid="engine-overlay" />,
  SiblingBoundingBoxOverlay: () => <div data-testid="sibling-overlay" />,
  UserAnnotationOverlay: () => <div data-testid="user-overlay" />,
  ReferenceBoxOverlay: () => <div data-testid="reference-overlay" />,
}));

const detection = {
  id: 7,
  sequence_id: 1,
  recorded_at: '2024-01-01T10:00:00Z',
  algo_predictions: {
    predictions: [{ xyxyn: [0.1, 0.1, 0.2, 0.2], confidence: 0.9, class_name: 'smoke' }],
  },
  auto_predictions: {
    predictions: [{ xyxyn: [0.1, 0.1, 0.2, 0.2], confidence: 0.8, class_name: 'smoke' }],
  },
} as unknown as Detection;

const committed = {
  id: 700,
  detection_id: 7,
  processing_stage: 'annotated',
  annotation: {
    annotation: [
      { xyxyn: [0.1, 0.1, 0.2, 0.2], class_name: 'smoke', smoke_type: 'wildfire', origin: 'auto' },
    ],
  },
} as unknown as DetectionAnnotation;

const noop = () => {};

describe('DetectionImageCard dense restyle', () => {
  it('renders no footer metadata (no detection id, timestamp, or counts)', () => {
    render(<DetectionImageCard detection={detection} onClick={noop} cellState="auto" />);
    expect(screen.queryByText(/Detection #/)).toBeNull();
    expect(screen.queryByText(/prediction/)).toBeNull();
    expect(screen.queryByText(/COMPLETED|PENDING/)).toBeNull();
  });

  it('done: green border, user overlay, no model overlay', () => {
    const { container } = render(
      <DetectionImageCard
        detection={detection}
        onClick={noop}
        cellState="done"
        userAnnotation={committed}
      />
    );
    expect(container.firstElementChild?.className).toContain('border-green-500');
    expect(screen.queryByTestId('reference-overlay')).toBeNull();
  });

  it('no-box: amber border, no boxes drawn', () => {
    const { container } = render(
      <DetectionImageCard detection={detection} onClick={noop} cellState="no-box" />
    );
    expect(container.firstElementChild?.className).toContain('border-amber-400');
    expect(screen.queryByTestId('reference-overlay')).toBeNull();
    expect(screen.queryByTestId('user-overlay')).toBeNull();
  });

  it('legacy mode keeps green/orange encoding', () => {
    const { container, rerender } = render(
      <DetectionImageCard detection={detection} onClick={noop} isAnnotated />
    );
    expect(container.firstElementChild?.className).toContain('border-green-500');
    rerender(<DetectionImageCard detection={detection} onClick={noop} isAnnotated={false} />);
    expect(container.firstElementChild?.className).toContain('border-orange-400');
  });
});
