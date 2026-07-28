import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewToolbar } from '@/components/detection-sequence/ViewToolbar';

const baseProps = {
  cardSize: 'md' as const,
  onCardSizeChange: vi.fn(),
  showPredictions: true,
  onTogglePredictions: vi.fn(),
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

  it('predictions toggle fires with the inverted value and shows pressed state', () => {
    render(<ViewToolbar {...baseProps} />);
    const btn = screen.getByTitle('Show predictions (P)');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(baseProps.onTogglePredictions).toHaveBeenCalledWith(false);
  });

  it('hides Crop and Cropped view outside localize', () => {
    render(<ViewToolbar {...baseProps} />);
    expect(screen.queryByTitle('Crop cells (C)')).toBeNull();
    expect(screen.queryByTitle('Cropped view')).toBeNull();
  });

  it('localize: crop toggles fire', () => {
    const onToggleCropMode = vi.fn();
    const onToggleCroppedView = vi.fn();
    render(
      <ViewToolbar
        {...baseProps}
        isLocalize
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
});
