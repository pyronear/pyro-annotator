import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let canLocalizeValue = true;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    canLocalize: () => canLocalizeValue,
  }),
}));

beforeEach(() => {
  canLocalizeValue = true;
});

vi.mock('@/hooks/usePipelineStats', () => ({
  usePipelineStats: () => ({
    total: 522,
    classifyTodo: 57,
    classifyDone: 453,
    localizeTodo: 31,
    complete: 418,
    completePct: 80,
    groupsToLabel: 12,
    isLoading: false,
    error: null,
  }),
}));

import DashboardPage from '@/pages/DashboardPage';

describe('DashboardPage', () => {
  it('renders headline, pipeline, phase cards and explainer', () => {
    render(<DashboardPage />, { wrapper: MemoryRouter });
    expect(screen.getByRole('heading', { name: 'Annotation pipeline' })).toBeInTheDocument();
    expect(
      screen.getByText('Two passes: classify what the cameras saw, then localize the smoke.')
    ).toBeInTheDocument();
    expect(screen.getByText('Classify alerts')).toBeInTheDocument();
    expect(screen.getByText('Localize smoke')).toBeInTheDocument();
    expect(screen.getByText('How annotation works')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Classify by group/ })).toHaveAttribute(
      'href',
      '/classify/groups'
    );
  });

  it('hides the Localize phase card for classify-only users', () => {
    canLocalizeValue = false;
    render(<DashboardPage />, { wrapper: MemoryRouter });
    expect(screen.queryByText('Localize smoke')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start localizing' })).not.toBeInTheDocument();
    expect(screen.getByText('Classify alerts')).toBeInTheDocument();
  });

  it('shows the Localize phase card when the user can localize', () => {
    render(<DashboardPage />, { wrapper: MemoryRouter });
    expect(screen.getByText('Localize smoke')).toBeInTheDocument();
  });
});
