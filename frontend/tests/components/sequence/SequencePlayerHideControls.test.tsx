/**
 * Focused coverage for SequencePlayer's `hideReviewControls` prop (used by
 * the classify cockpit, where the decision rail owns the yes/no controls).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import SequencePlayer from '@/components/sequence/SequencePlayer';
import type { Detection } from '@/types/api';

vi.mock('@/hooks/useImagePreloader', () => ({
  useImagePreloader: () => ({
    currentImage: null,
    isInitialLoading: false,
    getPreloadProgress: () => ({ loaded: 0, total: 0, percentage: 0 }),
  }),
}));

function makeDetection(): Detection {
  return {
    id: 1,
    sequence_id: 101,
    alert_api_id: 9001,
    created_at: '2026-01-01T09:00:00Z',
    recorded_at: '2026-01-01T10:00:00Z',
    algo_predictions: { predictions: [] },
    last_modified_at: null,
  };
}

const noop = () => {};
const baseProps = {
  currentIndex: 0,
  onIndexChange: noop,
  missedSmokeReview: null,
  onMissedSmokeReviewChange: noop,
  isPlaying: false,
  playbackSpeed: 1,
  onPlay: noop,
  onPause: noop,
  onSeek: noop,
  onSpeedChange: noop,
  onReset: noop,
};

describe('SequencePlayer hideReviewControls', () => {
  it('shows the embedded missed-smoke overlay by default', () => {
    render(<SequencePlayer {...baseProps} detections={[makeDetection()]} />);
    expect(screen.getByText(/Did the model miss any smoke/i)).toBeInTheDocument();
  });

  it('hides the embedded missed-smoke overlay when hideReviewControls', () => {
    render(<SequencePlayer {...baseProps} detections={[makeDetection()]} hideReviewControls />);
    expect(screen.queryByText(/Did the model miss any smoke/i)).not.toBeInTheDocument();
  });
});
