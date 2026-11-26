import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuidePage from '@/pages/GuidePage';

describe('GuidePage (user guide hub)', () => {
  it('welcomes the reader to the training module', () => {
    render(<GuidePage />, { wrapper: MemoryRouter });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome to the Pyronear training module' })
    ).toBeInTheDocument();
    // The sidebar now leads here, so the old back link is gone.
    expect(screen.queryByRole('link', { name: /back to dashboard/i })).not.toBeInTheDocument();
  });

  it('links one card per module, each with its time estimate', () => {
    render(<GuidePage />, { wrapper: MemoryRouter });

    const basics = screen.getByRole('link', { name: /how annotation works/i });
    expect(basics).toHaveAttribute('href', '/guide/how-annotation-works');
    expect(basics).toHaveTextContent('Understand how to turn an alert into training data.');
    expect(basics).toHaveTextContent('~5 min read');

    const classification = screen.getByRole('link', { name: /classification — advanced/i });
    expect(classification).toHaveAttribute('href', '/guide/classification');
    expect(classification).toHaveTextContent('~1 min video');

    const localization = screen.getByRole('link', { name: /localization — advanced/i });
    expect(localization).toHaveAttribute('href', '/guide/localization');
    expect(localization).toHaveTextContent('~20 min');
  });

  it('marks only the localization training as coming soon', () => {
    render(<GuidePage />, { wrapper: MemoryRouter });
    expect(screen.getAllByText('Coming soon')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /localization — advanced/i })).toHaveTextContent(
      'Coming soon'
    );
  });

  it('keeps the basics card summary-only, without the pass-by-pass steps', () => {
    render(<GuidePage />, { wrapper: MemoryRouter });
    expect(screen.queryByText(/Pass 01/)).not.toBeInTheDocument();
    expect(screen.queryByText(/The pipeline/)).not.toBeInTheDocument();
  });
});
