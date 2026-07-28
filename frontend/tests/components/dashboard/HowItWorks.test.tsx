import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HowItWorks from '@/components/dashboard/HowItWorks';

describe('HowItWorks', () => {
  it('renders the explainer steps and the field guide link', () => {
    render(<HowItWorks />, { wrapper: MemoryRouter });
    expect(screen.getByText('How annotation works')).toBeInTheDocument();
    expect(screen.getByText('Pass 01 · Classify')).toBeInTheDocument();
    expect(screen.getByText('Pass 02 · Localize')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the field guide/i })).toHaveAttribute(
      'href',
      '/guide'
    );
  });
});
