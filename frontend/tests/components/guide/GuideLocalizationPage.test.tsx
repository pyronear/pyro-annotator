import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuideLocalizationPage from '@/pages/GuideLocalizationPage';

describe('GuideLocalizationPage', () => {
  it('explains the training and leads into it, without a read confirmation', () => {
    render(<GuideLocalizationPage />, { wrapper: MemoryRouter });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Localization — advanced training' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByText(/4 real alerts/)).toHaveTextContent('get 3 of them right to pass');
    expect(screen.getByRole('link', { name: /start the training/i })).toHaveAttribute(
      'href',
      '/guide/localization/practice'
    );
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I have read it' })).not.toBeInTheDocument();
  });
});
