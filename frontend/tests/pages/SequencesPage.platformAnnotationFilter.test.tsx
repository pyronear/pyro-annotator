import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getClassifyDone: vi.fn(),
    getClassifyQueue: vi.fn(),
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
vi.mock('@/hooks/useAnnotators', () => ({
  useAnnotators: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({ canLocalize: () => true }),
}));

let mockedFilters: Record<string, unknown> = {};

vi.mock('@/hooks/usePersistedFilters', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/usePersistedFilters')>();
  return {
    ...actual,
    usePersistedFilters: (
      _key: string,
      defaultState: Parameters<typeof actual.usePersistedFilters>[1]
    ): ReturnType<typeof actual.usePersistedFilters> => ({
      filters: { ...defaultState.filters, ...mockedFilters },
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
      resetFilters: vi.fn(),
    }),
  };
});

import { apiClient } from '@/services/api';
import SequencesPage from '@/pages/SequencesPage';
import { ALL_CLASSIFIED_STAGES } from '@/utils/processingStage';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const emptyPage = { items: [], page: 1, pages: 0, size: 50, total: 0 };

describe('SequencesPage passes the Alert API annotation filter to the endpoint', () => {
  beforeEach(() => {
    mockedFilters = {};
    vi.mocked(apiClient.getClassifyQueue).mockResolvedValue(emptyPage);
    vi.mocked(apiClient.getClassifyDone).mockResolvedValue(emptyPage);
  });

  it('sends it from the /classify queue', async () => {
    mockedFilters = { is_wildfire_alertapi: 'wildfire_smoke' };
    render(<SequencesPage />, { wrapper });
    await waitFor(() => expect(apiClient.getClassifyQueue).toHaveBeenCalled());
    expect(apiClient.getClassifyQueue).toHaveBeenCalledWith(
      expect.objectContaining({ is_wildfire_alertapi: 'wildfire_smoke' })
    );
  });

  it('sends the Unclassified choice from the /classify queue', async () => {
    mockedFilters = { is_wildfire_alertapi: null };
    render(<SequencesPage />, { wrapper });
    await waitFor(() => expect(apiClient.getClassifyQueue).toHaveBeenCalled());
    expect(apiClient.getClassifyQueue).toHaveBeenCalledWith(
      expect.objectContaining({ is_wildfire_alertapi: null })
    );
  });

  it('sends it from /classify/done', async () => {
    mockedFilters = { is_wildfire_alertapi: 'other' };
    render(<SequencesPage defaultProcessingStage={ALL_CLASSIFIED_STAGES} isReviewPage />, {
      wrapper,
    });
    await waitFor(() => expect(apiClient.getClassifyDone).toHaveBeenCalled());
    expect(apiClient.getClassifyDone).toHaveBeenCalledWith(
      expect.objectContaining({ is_wildfire_alertapi: 'other' })
    );
  });
});
