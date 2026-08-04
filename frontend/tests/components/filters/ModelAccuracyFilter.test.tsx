import { render, screen, fireEvent } from '@testing-library/react';
import ModelAccuracyFilter from '@/components/filters/ModelAccuracyFilter';

describe('ModelAccuracyFilter', () => {
  it('renders one chip per outcome, labelled like the Result column', () => {
    render(<ModelAccuracyFilter selectedAccuracy="all" onSelectionChange={vi.fn()} />);
    const chips = screen.getAllByRole('radio');
    expect(chips.map(c => c.textContent)).toEqual([
      'All',
      'TPTrue positive',
      'FPFalse positive',
      '⚑FNFalse negative',
    ]);
  });

  it('marks only the selected chip as checked', () => {
    render(<ModelAccuracyFilter selectedAccuracy="false_positive" onSelectionChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /false positive/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^all$/i })).not.toBeChecked();
  });

  it('reports the chosen accuracy on click', () => {
    const onSelectionChange = vi.fn();
    render(<ModelAccuracyFilter selectedAccuracy="all" onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /false negative/i }));
    expect(onSelectionChange).toHaveBeenCalledWith('false_negative');
  });
});
