import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getLocalizationQueue: vi.fn(),
    getSequenceDetections: vi.fn(),
    getDetectionImageUrl: vi.fn(),
  },
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { apiClient } from '@/services/api';
import DetectionAnnotatePage from '@/pages/DetectionAnnotatePage';

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
      sequence_id: 11,
      alert_api_id: 170000,
      has_smoke: true,
      processing_stage: 'seq_annotation_done',
      total_detections: 4,
      annotated_detections: 1,
      auto_annotated_at: '2026-07-27T11:00:00Z',
    },
    {
      sequence_id: 12,
      alert_api_id: 170000001,
      has_smoke: false,
      processing_stage: 'annotated',
      total_detections: 2,
      annotated_detections: 2,
      auto_annotated_at: null,
    },
  ],
};

describe('DetectionAnnotatePage (Localize queue)', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    vi.mocked(apiClient.getLocalizationQueue).mockResolvedValue({
      items: [queueItem],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    vi.mocked(apiClient.getSequenceDetections).mockResolvedValue([]);
  });

  it('renders one row per alert with source, absolute time, azimuth and frames', async () => {
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    expect(screen.getByText('Pyronear')).toBeTruthy();
    // Source pill
    expect(screen.getByText('pyronear_french')).toBeTruthy();
    // Absolute date-time, app-wide convention
    expect(screen.getByText(new Date('2026-07-27T10:00:00Z').toLocaleString())).toBeTruthy();
    // Camera azimuth
    expect(screen.getByText(/Azimuth: 143°/)).toBeTruthy();
    // Frames = detections across smoke lanes only (4 from lane 11; lane 12 is FP)
    expect(screen.getByText(/4 frames/)).toBeTruthy();
    // Old columns are gone
    expect(screen.queryByText(/objects to localize/)).toBeNull();
    expect(screen.queryByText(/boxes/)).toBeNull();
  });

  it('omits the azimuth text when the alert has none', async () => {
    vi.mocked(apiClient.getLocalizationQueue).mockResolvedValue({
      items: [{ ...queueItem, azimuth: null }],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    expect(screen.queryByText(/Azimuth:/)).toBeNull();
  });

  it('clicking a row opens the first unfinished smoke lane in localize flow', async () => {
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    fireEvent.click(screen.getByText('CAM_01'));
    expect(navigateMock).toHaveBeenCalledWith('/localize/11');
  });

  it('shows an empty state when the queue is empty', async () => {
    vi.mocked(apiClient.getLocalizationQueue).mockResolvedValue({
      items: [],
      page: 1,
      pages: 0,
      size: 50,
      total: 0,
    });
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(screen.getByText(/No alerts ready for localization/)).toBeTruthy());
  });
});
