import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoxSourceRail } from '@/components/localize/editor/BoxSourceRail';
import type { BoxCandidate } from '@/utils/annotation/objectBoxCandidates';

// jsdom has no canvas. The rail's crops are drawn imperatively; these tests
// assert on rows, state and callbacks, so a no-op 2D context is enough — it
// just keeps "Not implemented: getContext" out of the output.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
  })) as unknown as HTMLCanvasElement['getContext'];
});

const auto: BoxCandidate = {
  source: 'auto',
  index: 0,
  xyxyn: [0.2, 0.2, 0.3, 0.3],
  confidence: 0.87,
};
const engine: BoxCandidate = {
  source: 'engine',
  index: 0,
  xyxyn: [0.1, 0.1, 0.4, 0.4],
  confidence: 0.5,
};

const props = {
  candidates: [auto, engine],
  committed: auto,
  cleared: false,
  imageUrl: 'blob:image',
  disabled: false,
  onCommit: vi.fn(),
  onClear: vi.fn(),
  onPreview: vi.fn(),
};

describe('BoxSourceRail', () => {
  it('renders a row for every source, including ones with no box', () => {
    render(<BoxSourceRail {...props} />);
    expect(screen.getByTestId('source-row-manual')).toBeInTheDocument();
    expect(screen.getByTestId('source-row-auto')).toBeInTheDocument();
    expect(screen.getByTestId('source-row-engine')).toBeInTheDocument();
  });

  it('marks the committed row', () => {
    render(<BoxSourceRail {...props} />);
    expect(screen.getByTestId('source-row-auto')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('source-row-engine')).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables a model row whose source has no box', () => {
    render(<BoxSourceRail {...props} candidates={[auto]} committed={auto} />);
    expect(screen.getByTestId('source-row-engine')).toBeDisabled();
  });

  it('points at the canvas from the Manual row when nothing is drawn', () => {
    render(<BoxSourceRail {...props} />);
    // There is no draw mode to arm, so the row says where boxes come from
    // rather than acting as a control.
    expect(screen.getByTestId('source-row-manual')).toHaveTextContent('drag on the image');
  });

  it('commits the clicked candidate', () => {
    const onCommit = vi.fn();
    render(<BoxSourceRail {...props} onCommit={onCommit} />);
    fireEvent.click(screen.getByTestId('source-row-engine'));
    expect(onCommit).toHaveBeenCalledWith(engine);
  });

  it('does not commit the row that is already committed', () => {
    const onCommit = vi.fn();
    render(<BoxSourceRail {...props} onCommit={onCommit} />);
    fireEvent.click(screen.getByTestId('source-row-auto'));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('explains what each source is, for a reader who does not know', () => {
    render(<BoxSourceRail {...props} />);
    expect(screen.getByText(/camera's own detector/i)).toBeInTheDocument();
    expect(screen.getByText(/more sensitive model this app runs/i)).toBeInTheDocument();
    expect(screen.getByText(/drew or adjusted here yourself/i)).toBeInTheDocument();
  });

  it('ties each explanation to its row for a screen reader', () => {
    render(<BoxSourceRail {...props} />);
    const describedBy = screen.getByTestId('source-row-engine').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(/camera's own detector/i);
  });

  it('shows the model confidence in plain terms', () => {
    render(<BoxSourceRail {...props} />);
    expect(screen.getByTestId('source-row-auto')).toHaveTextContent('87% confident');
  });

  it('disables every action when the frame is not editable', () => {
    render(<BoxSourceRail {...props} candidates={[]} committed={null} disabled />);
    expect(screen.getByTestId('source-row-auto')).toBeDisabled();
  });

  // React delivers onMouseEnter/onMouseLeave via mouseover/mouseout, so
  // that's what these fire.
  it('previews a hovered row and releases on leave', () => {
    const onPreview = vi.fn();
    render(<BoxSourceRail {...props} onPreview={onPreview} />);
    fireEvent.mouseOver(screen.getByTestId('source-row-engine'));
    expect(onPreview).toHaveBeenCalledWith(engine);
    fireEvent.mouseOut(screen.getByTestId('source-row-engine'));
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('previews on keyboard focus too', () => {
    const onPreview = vi.fn();
    render(<BoxSourceRail {...props} onPreview={onPreview} />);
    fireEvent.focus(screen.getByTestId('source-row-engine'));
    expect(onPreview).toHaveBeenCalledWith(engine);
    fireEvent.blur(screen.getByTestId('source-row-engine'));
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('does not preview the committed row — its box is already on stage', () => {
    const onPreview = vi.fn();
    render(<BoxSourceRail {...props} onPreview={onPreview} />);
    fireEvent.mouseOver(screen.getByTestId('source-row-auto'));
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('does not preview a row with no candidate', () => {
    const onPreview = vi.fn();
    render(<BoxSourceRail {...props} onPreview={onPreview} />);
    fireEvent.mouseOver(screen.getByTestId('source-row-manual'));
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('releases the preview when a hovered row is clicked to commit', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(<BoxSourceRail {...props} onPreview={onPreview} onCommit={onCommit} />);
    fireEvent.mouseOver(screen.getByTestId('source-row-engine'));
    fireEvent.click(screen.getByTestId('source-row-engine'));
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onCommit).toHaveBeenCalledWith(engine);
  });

  it('offers a None row so "not visible here" is sayable with the mouse', () => {
    const onClear = vi.fn();
    render(<BoxSourceRail {...props} onClear={onClear} />);
    const none = screen.getByTestId('source-row-none');
    expect(none).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(none);
    expect(onClear).toHaveBeenCalled();
  });

  it('presses the None row on a cleared frame', () => {
    render(<BoxSourceRail {...props} committed={null} cleared />);
    expect(screen.getByTestId('source-row-none')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the source rows live on a cleared frame — re-picking one is the undo', () => {
    const onCommit = vi.fn();
    render(<BoxSourceRail {...props} committed={null} cleared onCommit={onCommit} />);
    fireEvent.click(screen.getByTestId('source-row-auto'));
    expect(onCommit).toHaveBeenCalledWith(auto);
  });

  it('disables the None row with the rest of the rail on an out-of-range frame', () => {
    render(<BoxSourceRail {...props} disabled />);
    expect(screen.getByTestId('source-row-none')).toBeDisabled();
  });
});
