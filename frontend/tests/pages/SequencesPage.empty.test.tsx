import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
import SequencesPage from '@/pages/SequencesPage';
import { ALL_CLASSIFIED_STAGES, getStageFilterLabel } from '@/utils/processingStage';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const emptyPage = { items: [], page: 1, pages: 0, size: 50, total: 0 };

describe('SequencesPage empty states', () => {
  beforeEach(() => {
    resetFiltersMock.mockClear();
    mockedCameraName = undefined;
    vi.mocked(apiClient.getClassifyDone).mockResolvedValue(emptyPage);
    // Default (no props) SequencesPage is queue mode — alert-grouped queue, not
    // the plain sequences fetch.
    vi.mocked(apiClient.getClassifyQueue).mockResolvedValue(emptyPage);
  });

  it('queue without filters shows queue-is-clear state linking to localize', async () => {
    render(<SequencesPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Classification queue is clear')).toBeTruthy());
    expect(screen.getByText(/every alert has been classified/)).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Start localizing' });
    expect(cta.getAttribute('href')).toBe('/localize');
    // Old celebratory state is gone
    expect(screen.queryByText('🎉')).toBeNull();
    expect(screen.queryByText('All caught up!')).toBeNull();
  });

  it('with active filters shows no-matches state and Clear filters resets them', async () => {
    mockedCameraName = 'CAM_01';
    render(<SequencesPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('No matching alerts')).toBeTruthy());
    expect(screen.getByText(/matches your current filters/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(resetFiltersMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('🔍')).toBeNull();
  });

  it('review page on All classified shows no-classified-yet state linking to classify', async () => {
    render(<SequencesPage defaultProcessingStage={ALL_CLASSIFIED_STAGES} isReviewPage />, {
      wrapper,
    });
    await waitFor(() => expect(screen.getByText('No classified sequences yet')).toBeTruthy());
    expect(screen.getByText(/land here for review/)).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Start classifying' });
    expect(cta.getAttribute('href')).toBe('/classify');
  });

  it('review page with active filters shows no-matches, not the stage-aware state', async () => {
    mockedCameraName = 'CAM_01';
    render(<SequencesPage defaultProcessingStage={ALL_CLASSIFIED_STAGES} isReviewPage />, {
      wrapper,
    });
    await waitFor(() => expect(screen.getByText('No matching sequences')).toBeTruthy());
    expect(screen.queryByText('No classified sequences yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('review page on a specific stage scopes the headline to that stage', async () => {
    render(<SequencesPage defaultProcessingStage="seq_annotation_done" isReviewPage />, {
      wrapper,
    });
    const label = getStageFilterLabel('seq_annotation_done');
    await waitFor(() => expect(screen.getByText(`No sequences in "${label}"`)).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Start classifying' })).toBeTruthy();
  });
});
