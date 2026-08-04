import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuidePage from '@/pages/GuidePage';

describe('GuidePage', () => {
  it('renders the field guide with both passes', () => {
    render(<GuidePage />, { wrapper: MemoryRouter });
    expect(screen.getByRole('heading', { name: 'Field guide' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Pass 01 — Classify alerts/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Pass 02 — Localize smoke/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/');
  });

  it('introduces the Alert → Objects → Frames vocabulary', () => {
    render(<GuidePage />, { wrapper: MemoryRouter });
    expect(screen.getByText(/one alert per camera event/i)).toBeInTheDocument();
    expect(screen.getByText('alerts')).toBeInTheDocument();
    expect(screen.getByText('objects')).toBeInTheDocument();
    expect(screen.getByText('frames')).toBeInTheDocument();
  });

  it('describes the collocated Pass 02 flow: timeline, focus, accept-all, and the ⚑ Missed row', () => {
    render(<GuidePage />, { wrapper: MemoryRouter });
    expect(screen.getByText(/object timeline/i)).toBeInTheDocument();
    expect(screen.getByText(/focus that object/i)).toBeInTheDocument();
    expect(screen.getByText(/⚑ Missed row/)).toBeInTheDocument();
    expect(screen.getByText(/“Accept all & submit alert”/)).toBeInTheDocument();
  });

  it('notes the per-object editor is deep-link-only', () => {
    render(<GuidePage />, { wrapper: MemoryRouter });
    expect(screen.getByText(/no longer part of the normal queue flow/i)).toBeInTheDocument();
  });
});
