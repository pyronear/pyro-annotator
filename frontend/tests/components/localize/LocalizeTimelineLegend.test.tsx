import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocalizeTimelineLegend } from '@/components/localize/LocalizeTimelineLegend';

describe('LocalizeTimelineLegend', () => {
  it('renders one chip per status, labelled with the popover vocabulary', () => {
    render(<LocalizeTimelineLegend statuses={['confirmed', 'pending', 'empty']} />);
    expect(screen.getByTestId('legend-chip-confirmed')).toHaveTextContent('committed');
    expect(screen.getByTestId('legend-chip-pending')).toHaveTextContent('model box to accept');
    expect(screen.getByTestId('legend-chip-empty')).toHaveTextContent('no box');
  });

  it('renders only the statuses it is given', () => {
    render(<LocalizeTimelineLegend statuses={['confirmed']} />);
    expect(screen.getByTestId('legend-chip-confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('legend-chip-pending')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legend-chip-empty')).not.toBeInTheDocument();
  });

  it('renders nothing at all for an empty status list', () => {
    const { container } = render(<LocalizeTimelineLegend statuses={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('gives each status its own swatch treatment: solid, faded, outline', () => {
    render(<LocalizeTimelineLegend statuses={['confirmed', 'pending', 'empty']} />);
    const swatch = (status: string) =>
      screen.getByTestId(`legend-chip-${status}`).querySelector('span[aria-hidden]');
    expect(swatch('confirmed')).toHaveClass('bg-char');
    expect(swatch('confirmed')).not.toHaveClass('opacity-40');
    expect(swatch('pending')).toHaveClass('bg-char', 'opacity-40');
    expect(swatch('empty')).toHaveClass('ring-1', 'ring-inset', 'ring-char');
  });
});
