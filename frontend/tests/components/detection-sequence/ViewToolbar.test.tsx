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

  // The crop and flipbook toggles used to hide behind an `isLocalize` flag,
  // for the legacy per-lane page that also used this toolbar. That page is
  // gone and the collocated localize screen is the only consumer, so they
  // always render.
  it('always renders the crop and cropped-view toggles', () => {
    render(<ViewToolbar {...baseProps} />);
    expect(screen.getByTitle('Crop cells (C)')).toBeInTheDocument();
    expect(screen.getByTitle('Cropped view')).toBeInTheDocument();
  });

  it('crop toggles fire with the inverted value', () => {
    const onToggleCropMode = vi.fn();
    const onToggleCroppedView = vi.fn();
    render(
      <ViewToolbar
        {...baseProps}
        cropMode={false}
        onToggleCropMode={onToggleCropMode}
        showCroppedView
        onToggleCroppedView={onToggleCroppedView}
      />
    );
    fireEvent.click(screen.getByTitle('Crop cells (C)'));
    expect(onToggleCropMode).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTitle('Cropped view'));
    expect(onToggleCroppedView).toHaveBeenCalledWith(false);
  });

  it('reflects pressed state on the toggles', () => {
    render(<ViewToolbar {...baseProps} cropMode showCroppedView={false} />);
    expect(screen.getByTitle('Crop cells (C)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Cropped view')).toHaveAttribute('aria-pressed', 'false');
  });
});
