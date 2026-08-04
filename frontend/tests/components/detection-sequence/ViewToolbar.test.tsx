import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewToolbar } from '@/components/detection-sequence/ViewToolbar';

const baseProps = {
  cardSize: 'md' as const,
  onCardSizeChange: vi.fn(),
};

describe('ViewToolbar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('S/M/L segmented pill fires onCardSizeChange', () => {
    render(<ViewToolbar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    expect(baseProps.onCardSizeChange).toHaveBeenCalledWith('lg');
  });

  it('marks the active size as pressed', () => {
    render(<ViewToolbar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'S' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('tints the pressed controls, which a white pill on the panel could not do', () => {
    // The toolbar sits on a white control panel now: the old `bg-paper`
    // pressed state was white on pale ash, near-invisible.
    render(<ViewToolbar {...baseProps} cropMode />);

    expect(screen.getByRole('button', { name: 'M' })).toHaveClass('bg-pine-soft');
    expect(screen.getByRole('button', { name: 'S' })).not.toHaveClass('bg-pine-soft');
    expect(screen.getByTitle('Crop cells (C)')).toHaveClass('bg-pine-soft');
  });

  // The crop toggle used to hide behind an `isLocalize` flag, for the legacy
  // per-lane page that also used this toolbar. That page is gone and the
  // collocated localize screen is the only consumer, so it always renders.
  it('always renders the crop toggle', () => {
    render(<ViewToolbar {...baseProps} />);
    expect(screen.getByTitle('Crop cells (C)')).toBeInTheDocument();
  });

  // The flipbook toggle is gone: the cropped loop now comes with selecting an
  // object rather than waiting behind a control nobody found.
  it('no longer renders a cropped-view toggle', () => {
    render(<ViewToolbar {...baseProps} />);
    expect(screen.queryByTitle('Cropped view')).not.toBeInTheDocument();
  });

  it('crop toggle fires with the inverted value', () => {
    const onToggleCropMode = vi.fn();
    render(<ViewToolbar {...baseProps} cropMode={false} onToggleCropMode={onToggleCropMode} />);
    fireEvent.click(screen.getByTitle('Crop cells (C)'));
    expect(onToggleCropMode).toHaveBeenCalledWith(true);
  });

  it('reflects pressed state on the crop toggle', () => {
    render(<ViewToolbar {...baseProps} cropMode />);
    expect(screen.getByTitle('Crop cells (C)')).toHaveAttribute('aria-pressed', 'true');
  });
});
