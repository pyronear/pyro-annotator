import { render, screen, fireEvent } from '@testing-library/react';
import ModelAccuracyFilter from '@/components/filters/ModelAccuracyFilter';

// The chip a radio labels — where its dot and code live.
const chipOf = (radio: HTMLElement) => radio.closest('label') as HTMLLabelElement;

describe('ModelAccuracyFilter', () => {
  it('renders one chip per outcome, named like the Result column', () => {
    render(<ModelAccuracyFilter selectedAccuracy="all" onSelectionChange={vi.fn()} />);
    expect(screen.getAllByRole('radio').map(r => chipOf(r).textContent)).toEqual([
      'All',
      'TPTrue Positive',
      'FPFalse Positive',
      '⚑FNFalse Negative',
    ]);
  });

  it('marks each chip with the same dot the table row uses', () => {
    render(<ModelAccuracyFilter selectedAccuracy="all" onSelectionChange={vi.fn()} />);
    const chip = (name: RegExp) => chipOf(screen.getByRole('radio', { name }));
    expect(chip(/true positive/i).querySelector('.bg-pine')).not.toBeNull();
    expect(chip(/false positive/i).querySelector('.bg-haze')).not.toBeNull();
    // False negative is the one outcome with a glyph instead of a dot.
    expect(chip(/false negative/i)).toHaveTextContent('⚑');
    expect(chip(/^all$/i).querySelector('[aria-hidden]')).toBeNull();
  });

  it('exposes the group under its visible label', () => {
    render(<ModelAccuracyFilter selectedAccuracy="all" onSelectionChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Result' })).toBeInTheDocument();
  });

  it('checks only the selected chip', () => {
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
