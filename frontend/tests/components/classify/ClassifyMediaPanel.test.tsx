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
  default: (props: { hideReviewControls?: boolean; onToggleFullscreen?: () => void }) => (
    <div data-testid="sequence-reviewer" data-hide-controls={String(props.hideReviewControls)}>
      {props.onToggleFullscreen && (
        <button aria-label="Enter fullscreen" onClick={props.onToggleFullscreen} />
      )}
    </div>
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
    expect(screen.getByTestId('object-media').getAttribute('data-object-label')).toBe('Object 1');
    expect(screen.queryByTestId('sequence-reviewer')).not.toBeInTheDocument();
  });

  it('renders the whole-alert reviewer (player-embedded yes/no hidden) in sequence mode', () => {
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

  it('forwards a fullscreen toggle to the reviewer in sequence mode and requests fullscreen on invoke', () => {
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

  it('answers missed smoke through the panel CTAs, mirroring state and disabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ClassifyMediaPanel
        {...baseProps}
        activeSection="sequence"
        activeObject={activeObject}
        onMissedSmokeReviewChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: /^Yes/ }));
    expect(onChange).toHaveBeenCalledWith('yes');
    fireEvent.click(screen.getByRole('radio', { name: /^No/ }));
    expect(onChange).toHaveBeenCalledWith('no');

    rerender(
      <ClassifyMediaPanel
        {...baseProps}
        activeSection="sequence"
        activeObject={activeObject}
        onMissedSmokeReviewChange={onChange}
        missedSmokeReview="no"
      />
    );
    expect(screen.getByRole('radio', { name: /^No/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /^Yes/ })).toHaveAttribute('aria-checked', 'false');

    onChange.mockClear();
    rerender(
      <ClassifyMediaPanel
        {...baseProps}
        activeSection="sequence"
        activeObject={activeObject}
        onMissedSmokeReviewChange={onChange}
        missedSmokeDisabled
      />
    );
    expect(screen.getByRole('radio', { name: /^Yes/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /^Yes/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hides the guidance copy and CTAs in fullscreen, and Escape exits fullscreen', () => {
    let fullscreenEl: Element | null = null;
    HTMLElement.prototype.requestFullscreen = vi.fn(function (this: HTMLElement) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      fullscreenEl = this;
      return Promise.resolve();
    });
    document.exitFullscreen = vi.fn(() => {
      fullscreenEl = null;
      return Promise.resolve();
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenEl,
    });

    render(
      <ClassifyMediaPanel {...baseProps} activeSection="sequence" activeObject={activeObject} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    fireEvent(document, new Event('fullscreenchange'));

    expect(screen.queryByRole('radio', { name: /^Yes/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Did the model miss any smoke/)).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.exitFullscreen).toHaveBeenCalled();
    fireEvent(document, new Event('fullscreenchange'));
    expect(screen.getByRole('radio', { name: /^Yes/ })).toBeInTheDocument();
  });
});
