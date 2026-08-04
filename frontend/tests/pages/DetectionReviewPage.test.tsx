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

const navigateMock = vi.fn();
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/hooks/useCameras', () => ({
  useCameras: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/hooks/useOrganizations', () => ({
  useOrganizations: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/hooks/useSourceApis', () => ({
  useSourceApis: () => ({ data: [], isLoading: false }),
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
import DetectionReviewPage from '@/pages/DetectionReviewPage';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const queueItem = {
  source_api: 'pyronear_french',
  platform_alert_id: 170000,
  camera_name: 'CAM_01',
  organisation_name: 'Pyronear',
  azimuth: 143,
  recorded_at: '2026-07-27T10:00:00Z',
  lanes: [
    {
      sequence_id: 21,
      alert_api_id: 170000,
      has_smoke: true,
      has_missed_smoke: false,
      is_unsure: false,
      processing_stage: 'annotated',
      smoke_types: ['wildfire'],
      total_detections: 4,
      annotated_detections: 4,
      auto_annotated_at: '2026-07-27T11:00:00Z',
    },
    {
      sequence_id: 22,
      alert_api_id: 170000001,
      has_smoke: false,
      has_missed_smoke: false,
      is_unsure: false,
      processing_stage: 'annotated',
      smoke_types: [],
      total_detections: 2,
      annotated_detections: 2,
      auto_annotated_at: null,
    },
  ],
};

describe('DetectionReviewPage (/localize/done)', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    mockedFilters = {};
    vi.mocked(apiClient.getLocalizeDoneQueue).mockResolvedValue({
      items: [queueItem],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
  });

  it('renders one row per alert with the objects count and outcome rollup', async () => {
    render(<DetectionReviewPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    expect(screen.getByText('Pyronear')).toBeTruthy();
    // Objects: 1 smoke lane (the FP lane is excluded from the count)
    expect(screen.getByText('1 object')).toBeTruthy();
    // Outcome rollup: dominant TP, no +N (only one lane has a derivable outcome)
    expect(screen.getByTitle('True positive — model correctly detected smoke')).toBeTruthy();
  });

  it('clicking a row navigates to the legacy done view of the first lane', async () => {
    render(<DetectionReviewPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    fireEvent.click(screen.getByText('CAM_01'));
    expect(navigateMock).toHaveBeenCalledWith('/localize/done/21');
  });

  it('wires camera/org/source/date filters through to the endpoint', async () => {
    mockedFilters = {
      camera_name: 'CAM_01',
      organisation_name: 'Pyronear',
      source_api: 'pyronear_french',
      recorded_at_gte: '2026-01-01T00:00:00',
      recorded_at_lte: '2026-01-02T23:59:59',
    };
    render(<DetectionReviewPage />, { wrapper });
    await waitFor(() => expect(apiClient.getLocalizeDoneQueue).toHaveBeenCalled());
    expect(apiClient.getLocalizeDoneQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        camera_name: 'CAM_01',
        organisation_name: 'Pyronear',
        source_api: 'pyronear_french',
        recorded_at_gte: '2026-01-01T00:00:00',
        recorded_at_lte: '2026-01-02T23:59:59',
      })
    );
  });

  it('does not show the model-accuracy or annotation-type filter controls', async () => {
    render(<DetectionReviewPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.click(screen.getByText(/More filters/));
    expect(screen.queryByText('Model Accuracy')).toBeNull();
    expect(screen.queryByText('False Positive Types')).toBeNull();
    expect(screen.queryByText('Smoke Types')).toBeNull();
  });

  it('shows an all-caught-up empty state when the queue is empty', async () => {
    vi.mocked(apiClient.getLocalizeDoneQueue).mockResolvedValue({
      items: [],
      page: 1,
      pages: 0,
      size: 50,
      total: 0,
    });
    render(<DetectionReviewPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('No localized alerts yet')).toBeTruthy());
  });
});
