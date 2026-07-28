import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AttentionBanner from '@/components/dashboard/AttentionBanner';

describe('AttentionBanner', () => {
  it('renders nothing when count is zero', () => {
    const { container } = render(<AttentionBanner count={0} />, { wrapper: MemoryRouter });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count and a resolve link when nonzero', () => {
    render(<AttentionBanner count={4} />, { wrapper: MemoryRouter });
    expect(screen.getByText(/4 sequences need manual attention/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /resolve/i })).toHaveAttribute(
      'href',
      '/detections/annotate'
    );
  });
});
