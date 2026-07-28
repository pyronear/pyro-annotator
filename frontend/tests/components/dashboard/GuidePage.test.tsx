import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuidePage from '@/pages/GuidePage';

describe('GuidePage', () => {
  it('renders the field guide with both passes', () => {
    render(<GuidePage />, { wrapper: MemoryRouter });
    expect(screen.getByRole('heading', { name: 'Field guide' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Pass 01 — Classify sequences/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Pass 02 — Localize smoke/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/');
  });
});
