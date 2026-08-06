import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getClassifyDone: vi.fn(),
    getClassifyQueue: vi.fn(),
    unskipAlert: vi.fn(),
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

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({ canLocalize: () => true }),
}));

vi.mock('@/components/DetectionImageThumbnail', () => ({
  default: () => <div data-testid="detection-thumbnail" />,
}));

vi.mock('@/hooks/usePersistedFilters', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/usePersistedFilters')>();
  return {
    ...actual,
    usePersistedFilters: (
      _key: string,
      defaultState: Parameters<typeof actual.usePersistedFilters>[1]
    ): ReturnType<typeof actual.usePersistedFilters> => ({
      filters: { ...defaultState.filters },
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
import { QUEUE_COUNTS_KEY } from '@/hooks/useQueueTotals';
import type { ClassifyQueueItem } from '@/types/api';

const emptyPage = { items: [], page: 1, pages: 0, size: 50, total: 0 };

// Annotated on purpose: `tests/` is outside the tsconfig `include`, so an
// untyped fixture can drift from the real payload without tsc noticing.
const skippedItem: ClassifyQueueItem = {
  source_api: 'pyronear_french',
  platform_alert_id: 170000,
  camera_name: 'CAM_01',
  organisation_name: 'Pyronear',
  azimuth: 143,
  recorded_at: '2026-08-05T09:00:00Z',
  is_wildfire_alertapi: 'wildfire_smoke',
  primary_sequence_id: 1,
  total_objects: 2,
  classified_objects: 0,
  skip: {
    skipped_at: '2026-08-05T10:00:00Z',
    skipped_by: 'annotator',
    note: 'too hazy to call',
  },
};

describe('SequencesPage unskip', () => {
  let client: QueryClient;

  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(apiClient.getClassifyDone).mockResolvedValue(emptyPage);
    vi.mocked(apiClient.getClassifyQueue).mockImplementation(async params =>
      params?.skipped
        ? { items: [skippedItem], page: 1, pages: 1, size: params.size ?? 50, total: 1 }
        : emptyPage
    );
    vi.mocked(apiClient.unskipAlert).mockResolvedValue(undefined as never);
  });

  // Regression guard: the classify-queue total behind both the sidebar badge
  // and the dashboard's Classify card is skip-excluding, so un-skipping an
  // alert has to refresh both. Miss the invalidation and they disagree for the
  // full 5-minute staleTime — the exact symptom this branch set out to fix.
  // QUEUE_COUNTS_KEY is imported rather than spelled out so renaming the hook's
  // key without updating the invalidator fails here instead of silently
  // regressing.
  it('invalidates the queue-count and dashboard keys so both counts follow the unskip', async () => {
    // spyOn, not a bare stub: real invalidation still runs, so a throwing or
    // refetch-looping invalidation would surface instead of being swallowed.
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(<SequencesPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /Skipped/ }));
    await waitFor(() => expect(screen.getByText('too hazy to call')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Unskip' }));
    await waitFor(() =>
      expect(apiClient.unskipAlert).toHaveBeenCalledWith('pyronear_french', 170000)
    );

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map(([arg]) => String(arg?.queryKey?.[0]));
      // The unskip handler's whole contract: the list, the skipped-count pill,
      // the shared queue totals, and the dashboard's stage counts.
      expect(keys).toContain('classify-queue');
      expect(keys).toContain('classify-queue-skipped-count');
      expect(keys).toContain(QUEUE_COUNTS_KEY);
      expect(keys).toContain('pipeline-stats');
    });
  });
});
