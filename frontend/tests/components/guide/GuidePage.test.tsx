import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuidePage from '@/pages/GuidePage';
import type { RightStatus } from '@/types/api';

let classifyStatus: RightStatus = 'training';
let localizeStatus: RightStatus = 'training';

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    user: { classify_status: classifyStatus, localize_status: localizeStatus },
  }),
}));

beforeEach(() => {
  classifyStatus = 'training';
  localizeStatus = 'training';
});

const renderPage = () => render(<GuidePage />, { wrapper: MemoryRouter });

describe('GuidePage (user guide hub)', () => {
  it('welcomes the reader to the training module', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome to the Pyronear training module' })
    ).toBeInTheDocument();
    // The sidebar now leads here, so the old back link is gone.
    expect(screen.queryByRole('link', { name: /back to dashboard/i })).not.toBeInTheDocument();
  });

  it('links one card per module, each with its time estimate', () => {
    renderPage();

    const basics = screen.getByRole('link', { name: /how annotation works/i });
    expect(basics).toHaveAttribute('href', '/guide/how-annotation-works');
    expect(basics).toHaveTextContent('Understand how to turn an alert into training data.');
    expect(basics).toHaveTextContent('~5 min read');

    const classification = screen.getByRole('link', { name: /classification — advanced/i });
    expect(classification).toHaveAttribute('href', '/guide/classification');
    expect(classification).toHaveTextContent('~15 min');

    const localization = screen.getByRole('link', { name: /localization — advanced/i });
    expect(localization).toHaveAttribute('href', '/guide/localization');
    expect(localization).toHaveTextContent('~20 min');
  });

  it('marks only the two advanced trainings as coming soon', () => {
    renderPage();
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /how annotation works/i })).not.toHaveTextContent(
      'Coming soon'
    );
  });

  it('keeps the basics card summary-only, without the pass-by-pass steps', () => {
    renderPage();
    expect(screen.queryByText(/Pass 01/)).not.toBeInTheDocument();
    expect(screen.queryByText(/The pipeline/)).not.toBeInTheDocument();
  });

  it('S1: locks the localization card, without a Skip button', () => {
    localizeStatus = 'locked';
    renderPage();

    expect(screen.getByRole('link', { name: /classification — advanced/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /localization — advanced/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: /localization — advanced training \(locked\)/i })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('link', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('keeps the locked card title readable, with an unlock hint', () => {
    localizeStatus = 'locked';
    renderPage();

    expect(
      screen.getByRole('heading', { level: 2, name: 'Localization — advanced training' })
    ).toBeInTheDocument();
    expect(screen.getByText('Keep classifying to unlock')).toBeInTheDocument();
  });

  it('S2: adds a Skip button to classification once classify is granted', () => {
    classifyStatus = 'granted';
    localizeStatus = 'locked';
    renderPage();

    expect(
      screen.getByRole('group', { name: /localization — advanced training \(locked\)/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /skip to classification/i })).toHaveAttribute(
      'href',
      '/classify'
    );
  });

  it('S4: enables both cards, without a Skip button', () => {
    classifyStatus = 'granted';
    renderPage();

    expect(screen.getByRole('link', { name: /classification — advanced/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /localization — advanced/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /skip/i })).not.toBeInTheDocument();
  });
});
