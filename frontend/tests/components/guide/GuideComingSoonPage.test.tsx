import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuideComingSoonPage from '@/pages/GuideComingSoonPage';

let canLocalizeValue = false;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({ canLocalize: () => canLocalizeValue }),
}));

const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'I have read it' }));

describe('GuideComingSoonPage', () => {
  beforeEach(() => {
    canLocalizeValue = false;
  });

  it('shows the classification training as coming soon, with a back link', () => {
    render(<GuideComingSoonPage module="classification" />, { wrapper: MemoryRouter });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Classification — advanced training' })
    ).toBeInTheDocument();
    expect(screen.getByText('~15 min')).toBeInTheDocument();
    expect(screen.getByText(/tell wildfire smoke apart from clouds/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Coming soon' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to user guide/i })).toHaveAttribute(
      'href',
      '/guide'
    );
  });

  it('sends the classification reader to the Classify queue', () => {
    canLocalizeValue = true;
    render(<GuideComingSoonPage module="classification" />, { wrapper: MemoryRouter });
    confirm();
    expect(screen.getByRole('link', { name: /start classifying/i })).toHaveAttribute(
      'href',
      '/classify'
    );
  });

  it('sends a localizer to the Localize queue', () => {
    canLocalizeValue = true;
    render(<GuideComingSoonPage module="localization" />, { wrapper: MemoryRouter });
    expect(screen.getByText('~20 min')).toBeInTheDocument();
    confirm();
    expect(screen.getByRole('link', { name: /start localizing/i })).toHaveAttribute(
      'href',
      '/localize'
    );
  });

  it('sends a classify-only reader of the localization page to Classify', () => {
    render(<GuideComingSoonPage module="localization" />, { wrapper: MemoryRouter });
    confirm();
    expect(screen.getByRole('link', { name: /start classifying/i })).toHaveAttribute(
      'href',
      '/classify'
    );
  });
});
