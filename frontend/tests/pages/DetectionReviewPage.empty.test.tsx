import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getLocalizeDoneQueue: vi.fn(),
  },
}));

vi.mock('@/hooks/useCameras', () => ({
  useCameras: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/hooks/useOrganizations', () => ({
  useOrganizations: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/hooks/useSourceApis', () => ({
  useSourceApis: () => ({ data: [], isLoading: false }),
}));

const resetFiltersMock = vi.fn();
let mockedCameraName: string | undefined;

vi.mock('@/hooks/usePersistedFilters', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/usePersistedFilters')>();
  return {
    ...actual,
    usePersistedFilters: (
      _key: string,
      defaultState: Parameters<typeof actual.usePersistedFilters>[1]
    ): ReturnType<typeof actual.usePersistedFilters> => ({
      filters: { ...defaultState.filters, camera_name: mockedCameraName },
      dateFrom: '',
      dateTo: '',
      selectedFalsePositiveTypes: [],
      selectedSmokeTypes: [],
      selectedModelAccuracy: 'all',
      selectedUnsure: 'all',
      setFilters: vi.fn(),
      setDateFrom: vi.fn(),
      setDateTo: vi.fn(),
      setSelectedFalsePositiveTypes: vi.fn(),
      setSelectedSmokeTypes: vi.fn(),
      setSelectedModelAccuracy: vi.fn(),
      setSelectedUnsure: vi.fn(),
      resetFilters: resetFiltersMock,
    }),
  };
});

import { apiClient } from '@/services/api';
import DetectionReviewPage from '@/pages/DetectionReviewPage';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const emptyPage = { items: [], page: 1, pages: 0, size: 50, total: 0 };

describe('DetectionReviewPage empty states', () => {
  beforeEach(() => {
    resetFiltersMock.mockClear();
    mockedCameraName = undefined;
    vi.mocked(apiClient.getLocalizeDoneQueue).mockResolvedValue(emptyPage);
  });

  it('without filters, shows nothing-localized-yet state linking to the localize queue', async () => {
    render(<DetectionReviewPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('No localized alerts yet')).toBeTruthy());
    expect(screen.getByText(/Finished localizations show up here for review/)).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Start localizing' });
    expect(cta.getAttribute('href')).toBe('/localize');
  });

  it('with active filters, shows no-matches state and Clear filters resets them', async () => {
    mockedCameraName = 'CAM_01';
    render(<DetectionReviewPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('No matching alerts')).toBeTruthy());
    expect(screen.getByText(/matches your current filters/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(resetFiltersMock).toHaveBeenCalledTimes(1);
    // Old emoji state is gone
    expect(screen.queryByText('🔍')).toBeNull();
  });
});
