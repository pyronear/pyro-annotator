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
  imageUrl: 'blob:image',
  disabled: false,
  onCommit: vi.fn(),
  onDraw: vi.fn(),
  onClear: vi.fn(),
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

  it('disables a row whose source has no box', () => {
    render(<BoxSourceRail {...props} />);
    expect(screen.getByTestId('source-row-manual')).toBeDisabled();
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

  it('shows the model confidence in plain terms', () => {
    render(<BoxSourceRail {...props} />);
    expect(screen.getByTestId('source-row-auto')).toHaveTextContent('87% confident');
  });

  it('disables every action when the frame is not editable', () => {
    render(<BoxSourceRail {...props} candidates={[]} committed={null} disabled />);
    expect(screen.getByTestId('editor-draw')).toBeDisabled();
    expect(screen.getByTestId('source-row-auto')).toBeDisabled();
  });

  it('disables Clear when nothing is committed', () => {
    render(<BoxSourceRail {...props} committed={null} />);
    expect(screen.getByTestId('editor-clear')).toBeDisabled();
  });

  it('draws when Draw is pressed', () => {
    const onDraw = vi.fn();
    render(<BoxSourceRail {...props} onDraw={onDraw} />);
    fireEvent.click(screen.getByTestId('editor-draw'));
    expect(onDraw).toHaveBeenCalled();
  });

  it('clears when Clear is pressed', () => {
    const onClear = vi.fn();
    render(<BoxSourceRail {...props} onClear={onClear} />);
    fireEvent.click(screen.getByTestId('editor-clear'));
    expect(onClear).toHaveBeenCalled();
  });
});
