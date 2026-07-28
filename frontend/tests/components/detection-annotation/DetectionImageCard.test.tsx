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

  it('shows the recorded timestamp on hover (label present, hover-gated)', () => {
    const { container } = render(
      <DetectionImageCard detection={detection} onClick={noop} cellState="auto" />
    );
    const label = screen.getByText(new Date('2024-01-01T10:00:00Z').toLocaleString());
    expect(label.className).toContain('group-hover:opacity-100');
    expect(container.firstElementChild?.className).toContain('group');
  });

  it('crop mode zooms the image around the winning boxes', () => {
    const { container } = render(
      <DetectionImageCard detection={detection} onClick={noop} cellState="auto" cropMode />
    );
    const img = container.querySelector('img')!;
    // auto box [0.1,0.1,0.2,0.2]: span 0.1 → scale clamped to 8, origin at 15%,15%
    expect(img.style.transform).toBe('scale(8)');
    expect(img.style.transformOrigin).toBe('15% 15%');
  });

  it('crop mode leaves no-box cells at full frame', () => {
    const { container } = render(
      <DetectionImageCard
        detection={{ ...detection, algo_predictions: { predictions: [] }, auto_predictions: { predictions: [] } } as unknown as Detection}
        onClick={noop}
        cellState="no-box"
        cropMode
      />
    );
    const img = container.querySelector('img')!;
    expect(img.style.transform).toBe('');
  });

  it('observes cell resize to re-measure overlay geometry', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(() => ({ observe, disconnect, unobserve: vi.fn() }))
    );

    const { unmount } = render(
      <DetectionImageCard detection={detection} onClick={noop} cellState="auto" />
    );
    expect(observe).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
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
