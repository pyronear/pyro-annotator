/**
 * Tests for TemporalScoreCell: percentage formatting and the not-scored
 * placeholder. An empty cell would be indistinguishable from a bug, which
 * matters while most alerts predate score capture.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { TemporalScoreCell } from '@/components/sequences/TemporalScoreCell';

describe('TemporalScoreCell', () => {
  it('renders a score as a rounded percentage', () => {
    render(<TemporalScoreCell score={0.8712} />);
    expect(screen.getByText('87%')).toBeInTheDocument();
  });

  it('renders an exact zero as 0%, not as not-scored', () => {
    render(<TemporalScoreCell score={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders a dash with an explanation when the score is null', () => {
    render(<TemporalScoreCell score={null} />);
    const cell = screen.getByTitle('Not scored by the platform');
    expect(cell).toHaveTextContent('—');
  });

  it('treats undefined the same as null', () => {
    render(<TemporalScoreCell score={undefined} />);
    expect(screen.getByTitle('Not scored by the platform')).toHaveTextContent('—');
  });
});
