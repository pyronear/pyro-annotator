import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassifyMediaPanel } from '@/components/classify';

vi.mock('@/components/annotation/FullImageSequence', () => ({
  default: () => <div data-testid="full-image-sequence" />,
}));
vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  default: () => <div data-testid="cropped-image-sequence" />,
}));
vi.mock('@/components/sequence/SequenceReviewer', () => ({
  default: (props: { hideReviewControls?: boolean }) => (
    <div data-testid="sequence-reviewer" data-hide-controls={String(props.hideReviewControls)} />
  ),
}));

const baseProps = {
  primarySequenceId: 101,
  missedSmokeReview: null,
  onMissedSmokeReviewChange: vi.fn(),
  annotationLoading: false,
  objectOverlays: [],
};

const activeObject = {
  label: 'Object 1',
  bboxes: [],
  croppedBboxes: [],
  sequenceId: 101,
  color: '#E4572E',
  siblingOverlays: [],
  frameRecordedAt: [],
};

describe('ClassifyMediaPanel', () => {
  it('renders the active object players in detections mode', () => {
    render(
      <ClassifyMediaPanel {...baseProps} activeSection="detections" activeObject={activeObject} />
    );
    expect(screen.getByTestId('full-image-sequence')).toBeInTheDocument();
    expect(screen.getByTestId('cropped-image-sequence')).toBeInTheDocument();
    expect(screen.getByText(/Cropped · Object 1/)).toBeInTheDocument();
    expect(screen.queryByTestId('sequence-reviewer')).not.toBeInTheDocument();
  });

  it('renders the whole-alert reviewer (without its own yes/no) in sequence mode', () => {
    render(
      <ClassifyMediaPanel {...baseProps} activeSection="sequence" activeObject={activeObject} />
    );
    expect(screen.getByTestId('sequence-reviewer')).toHaveAttribute('data-hide-controls', 'true');
    expect(screen.queryByTestId('full-image-sequence')).not.toBeInTheDocument();
  });

  it('renders an empty state when there is no active object', () => {
    render(<ClassifyMediaPanel {...baseProps} activeSection="detections" activeObject={null} />);
    expect(screen.getByText('No objects to review yet')).toBeInTheDocument();
  });

  it('renders a skeleton instead of the empty state while loading', () => {
    render(
      <ClassifyMediaPanel {...baseProps} activeSection="detections" activeObject={null} loading />
    );
    expect(screen.getByTestId('media-panel-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('No objects to review yet')).not.toBeInTheDocument();
  });

  it('offers a fullscreen toggle in sequence mode and requests fullscreen on click', () => {
    const requestSpy = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = requestSpy;
    render(
      <ClassifyMediaPanel {...baseProps} activeSection="sequence" activeObject={activeObject} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    expect(requestSpy).toHaveBeenCalled();
    // No fullscreen toggle in the per-object (detections) view.
    render(
      <ClassifyMediaPanel {...baseProps} activeSection="detections" activeObject={activeObject} />
    );
    expect(screen.queryAllByRole('button', { name: 'Enter fullscreen' })).toHaveLength(1);
  });
});
