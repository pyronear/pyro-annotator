/**
 * Tests for SequencePlayer's `objectOverlays` prop (Task 8): the shared
 * classify player renders every object's track box in its stable per-object
 * color, aligned to the current frame by `recorded_at` — absent on frames
 * the object has no box for — and dims every object except the active one.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SequencePlayer from '@/components/sequence/SequencePlayer';
import type { Detection } from '@/types/api';
import type { ObjectOverlay } from '@/utils/annotation/objectColors';

vi.mock('@/hooks/useImagePreloader', () => ({
  useImagePreloader: () => ({
    currentImage: { url: 'https://example.com/fake.png', loaded: true, error: false },
    isInitialLoading: false,
    getPreloadProgress: () => ({ loaded: 1, total: 1, percentage: 100 }),
  }),
}));

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    id: 1,
    sequence_id: 101,
    alert_api_id: 9001,
    created_at: '2026-01-01T09:00:00Z',
    recorded_at: '2026-01-01T10:00:00Z',
    algo_predictions: { predictions: [] },
    last_modified_at: null,
    ...overrides,
  };
}

const noop = () => {};

const detections = [
  makeDetection({ id: 1, recorded_at: '2026-01-01T10:00:00Z' }),
  makeDetection({ id: 2, recorded_at: '2026-01-01T10:00:05Z' }),
];

function renderPlayer(objectOverlays: ObjectOverlay[], currentIndex = 0) {
  render(
    <SequencePlayer
      detections={detections}
      currentIndex={currentIndex}
      onIndexChange={noop}
      missedSmokeReview={null}
      onMissedSmokeReviewChange={noop}
      isPlaying={false}
      playbackSpeed={1}
      onPlay={noop}
      onPause={noop}
      onSeek={noop}
      onSpeedChange={noop}
      onReset={noop}
      objectOverlays={objectOverlays}
    />
  );
  // jsdom never fires a real image load; drive handleImageLoad manually so
  // imageInfo is populated and the overlay layer renders.
  fireEvent.load(screen.getByAltText(/Frame/));
}

describe('SequencePlayer object overlays', () => {
  it('renders object A on its frame (t1) in its color; object B (t2 only) is absent', () => {
    const overlayA: ObjectOverlay = {
      color: '#3b82f6',
      label: 'Object 1',
      boxesByRecordedAt: { '2026-01-01T10:00:00Z': [0.1, 0.1, 0.5, 0.5] },
    };
    const overlayB: ObjectOverlay = {
      color: '#f97316',
      label: 'Object 2',
      boxesByRecordedAt: { '2026-01-01T10:00:05Z': [0.2, 0.2, 0.6, 0.6] },
    };

    renderPlayer([overlayA, overlayB], 0);

    const boxA = screen.getByTestId('object-overlay-Object 1');
    expect(boxA).toHaveStyle({ borderColor: '#3b82f6' });
    expect(screen.queryByTestId('object-overlay-Object 2')).not.toBeInTheDocument();
  });

  it('renders object B once the frame advances to t2', () => {
    const overlayA: ObjectOverlay = {
      color: '#3b82f6',
      label: 'Object 1',
      boxesByRecordedAt: { '2026-01-01T10:00:00Z': [0.1, 0.1, 0.5, 0.5] },
    };
    const overlayB: ObjectOverlay = {
      color: '#f97316',
      label: 'Object 2',
      boxesByRecordedAt: { '2026-01-01T10:00:05Z': [0.2, 0.2, 0.6, 0.6] },
    };

    renderPlayer([overlayA, overlayB], 1);

    expect(screen.queryByTestId('object-overlay-Object 1')).not.toBeInTheDocument();
    expect(screen.getByTestId('object-overlay-Object 2')).toHaveStyle({ borderColor: '#f97316' });
  });

  it('renders the active object full-strength and dims the rest', () => {
    const overlayActive: ObjectOverlay = {
      color: '#3b82f6',
      label: 'Object 1',
      boxesByRecordedAt: { '2026-01-01T10:00:00Z': [0.1, 0.1, 0.5, 0.5] },
      isActive: true,
    };
    const overlayOther: ObjectOverlay = {
      color: '#f97316',
      label: 'Object 2',
      boxesByRecordedAt: { '2026-01-01T10:00:00Z': [0.2, 0.2, 0.6, 0.6] },
      isActive: false,
    };

    renderPlayer([overlayActive, overlayOther], 0);

    expect(screen.getByTestId('object-overlay-Object 1').className).toContain('opacity-100');
    expect(screen.getByTestId('object-overlay-Object 2').className).toContain('opacity-40');
  });
});
