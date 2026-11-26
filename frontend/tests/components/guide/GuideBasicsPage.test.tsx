import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuideBasicsPage from '@/pages/GuideBasicsPage';

describe('GuideBasicsPage', () => {
  it('renders the field guide with both passes', () => {
    render(<GuideBasicsPage />, { wrapper: MemoryRouter });
    expect(
      screen.getByRole('heading', { level: 1, name: 'How annotation works' })
    ).toBeInTheDocument();
    expect(screen.getByText('~5 min read')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Pass 01 — Classify alerts/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Pass 02 — Localize smoke/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to user guide/i })).toHaveAttribute(
      'href',
      '/guide'
    );
  });

  it('introduces the Alert → Objects → Frames vocabulary', () => {
    render(<GuideBasicsPage />, { wrapper: MemoryRouter });
    expect(screen.getByText(/one alert per camera event/i)).toBeInTheDocument();
    expect(screen.getByText('alerts')).toBeInTheDocument();
    expect(screen.getByText('objects')).toBeInTheDocument();
    expect(screen.getByText('frames')).toBeInTheDocument();
  });

  it('describes the collocated Pass 02 flow: timeline, focus, accept-all, add-object and skip', () => {
    render(<GuideBasicsPage />, { wrapper: MemoryRouter });
    expect(screen.getByText(/object timeline/i)).toBeInTheDocument();
    expect(screen.getByText(/focus that object/i)).toBeInTheDocument();
    // A missed smoke is now drawn, not parked: two anchors and an
    // interpolated middle. Skip survives only for what drawing can't fix.
    expect(screen.getByText(/“\+ Add object”/)).toBeInTheDocument();
    expect(screen.getByText(/first and last frame the plume appears on/)).toBeInTheDocument();
    expect(screen.getByText(/“Skip alert” remains for what drawing can’t fix/)).toBeInTheDocument();
    expect(screen.getByText(/“Accept all & submit alert”/)).toBeInTheDocument();
  });

  it('notes the per-object editor is deep-link-only', () => {
    render(<GuideBasicsPage />, { wrapper: MemoryRouter });
    expect(screen.getByText(/no longer part of the normal queue flow/i)).toBeInTheDocument();
  });

  it('ends with the confirmation, which leads to the Classify queue', () => {
    render(<GuideBasicsPage />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'I have read it' }));
    expect(screen.getByRole('link', { name: /start classifying/i })).toHaveAttribute(
      'href',
      '/classify'
    );
  });
});
