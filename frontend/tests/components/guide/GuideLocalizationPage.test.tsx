import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuideLocalizationPage from '@/pages/GuideLocalizationPage';

vi.mock('@/components/guide/celebrate', () => ({ celebrate: vi.fn() }));

let canLocalizeValue = false;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({ canLocalize: () => canLocalizeValue }),
}));

const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'I have read it' }));

describe('GuideLocalizationPage', () => {
  beforeEach(() => {
    canLocalizeValue = false;
  });

  it('shows the localization training as coming soon', () => {
    render(<GuideLocalizationPage />, { wrapper: MemoryRouter });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Localization — advanced training' })
    ).toBeInTheDocument();
    expect(screen.getByText('~20 min')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Coming soon' })).toBeInTheDocument();
  });

  it('sends a localizer to the Localize queue', () => {
    canLocalizeValue = true;
    render(<GuideLocalizationPage />, { wrapper: MemoryRouter });
    confirm();
    expect(screen.getByRole('link', { name: /start localizing/i })).toHaveAttribute(
      'href',
      '/localize'
    );
  });

  it('sends a classify-only reader to Classify instead', () => {
    render(<GuideLocalizationPage />, { wrapper: MemoryRouter });
    confirm();
    expect(screen.getByText(/localizing isn't enabled on your account/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start classifying/i })).toHaveAttribute(
      'href',
      '/classify'
    );
  });
});
