import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuideLocalizationPage from '@/pages/GuideLocalizationPage';

// The exercise itself is covered in LocalizationExercise.test.tsx; here it
// stands passed, to check where the page sends the reader next.
vi.mock('@/components/guide/LocalizationExercise', () => ({
  default: ({ afterPass }: { afterPass: React.ReactNode }) => <div>{afterPass}</div>,
}));

let canLocalizeValue = false;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({ canLocalize: () => canLocalizeValue }),
}));

describe('GuideLocalizationPage', () => {
  beforeEach(() => {
    canLocalizeValue = false;
  });

  it('shows the localization exercise instead of a read confirmation', () => {
    render(<GuideLocalizationPage />, { wrapper: MemoryRouter });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Localization — advanced training' })
    ).toBeInTheDocument();
    expect(screen.getByText('~5 min exercise')).toBeInTheDocument();
    expect(screen.getByText(/get 4 of them right to pass/i)).toBeInTheDocument();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I have read it' })).not.toBeInTheDocument();
  });

  it('sends a localizer who passed to the Localize queue', () => {
    canLocalizeValue = true;
    render(<GuideLocalizationPage />, { wrapper: MemoryRouter });
    expect(screen.getByRole('link', { name: /start localizing/i })).toHaveAttribute(
      'href',
      '/localize'
    );
  });

  it('sends a classify-only reader to Classify instead', () => {
    render(<GuideLocalizationPage />, { wrapper: MemoryRouter });
    expect(screen.getByText(/localizing isn't enabled on your account/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start classifying/i })).toHaveAttribute(
      'href',
      '/classify'
    );
  });
});
