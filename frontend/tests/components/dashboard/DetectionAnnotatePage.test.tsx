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
    unskipAlert: vi.fn(),
  },
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { apiClient } from '@/services/api';
import DetectionAnnotatePage from '@/pages/DetectionAnnotatePage';
import { formatDateTime } from '@/utils/datetime';

// Hoisted so a test can spy on the client's invalidations; still a fresh
// client per test (assigned in beforeEach).
let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
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
      smoke_types: ['wildfire'],
      total_detections: 4,
      annotated_detections: 1,
      auto_annotated_at: '2026-07-27T11:00:00Z',
    },
    {
      sequence_id: 12,
      alert_api_id: 170000001,
      has_smoke: false,
      processing_stage: 'annotated',
      smoke_types: [],
      total_detections: 2,
      annotated_detections: 2,
      auto_annotated_at: null,
    },
  ],
};

describe('DetectionAnnotatePage (Localize queue)', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    navigateMock.mockClear();
    vi.mocked(apiClient.getLocalizationQueue).mockReset();
    // Skipped-aware default: the page also fires a skipped-count query on
    // mount, which must not leak the queue fixture into the count badge.
    vi.mocked(apiClient.getLocalizationQueue).mockImplementation(async params =>
      params?.skipped
        ? { items: [], page: 1, pages: 0, size: params.size ?? 50, total: 0 }
        : { items: [queueItem], page: 1, pages: 1, size: 50, total: 1 }
    );
    vi.mocked(apiClient.getSequenceDetections).mockResolvedValue([]);
  });

  it('renders one row per alert with source, absolute time, azimuth and frames', async () => {
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    expect(screen.getByText('Pyronear')).toBeTruthy();
    // Source as plain text
    expect(screen.getByText('pyronear_french')).toBeTruthy();
    // Absolute date-time, app-wide convention
    expect(screen.getByText(formatDateTime('2026-07-27T10:00:00Z'))).toBeTruthy();
    // Azimuth column
    expect(screen.getByText('143°')).toBeTruthy();
    // Objects / Frames = smoke lanes only (lane 11; lane 12 is FP)
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    // Smoke type from the classify phase (smoke lanes only), plain text
    expect(screen.getByText(/Wildfire/)).toBeTruthy();
    // Old cell formats are gone (the header tooltip mentions "objects to
    // localize" and the page subtitle mentions "boxes", so match the old
    // "N objects ..." / "N boxes ..." cell text specifically)
    expect(screen.queryByText(/\d+ objects to localize/)).toBeNull();
    expect(screen.queryByText(/\d+ boxes/)).toBeNull();
  });

  it('unions and dedupes smoke types across smoke lanes', async () => {
    vi.mocked(apiClient.getLocalizationQueue).mockResolvedValue({
      items: [
        {
          ...queueItem,
          lanes: [
            { ...queueItem.lanes[0], smoke_types: ['wildfire'] },
            {
              ...queueItem.lanes[1],
              has_smoke: true,
              smoke_types: ['wildfire', 'industrial'],
            },
          ],
        },
      ],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    expect(screen.getAllByText(/Wildfire/)).toHaveLength(1);
    expect(screen.getByText(/Industrial/)).toBeTruthy();
  });

  it('tolerates lanes without smoke_types (payloads from an older backend)', async () => {
    const legacyLane = { ...queueItem.lanes[0] } as Record<string, unknown>;
    delete legacyLane.smoke_types;
    vi.mocked(apiClient.getLocalizationQueue).mockResolvedValue({
      items: [{ ...queueItem, lanes: [legacyLane as unknown as (typeof queueItem.lanes)[0]] }],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    expect(screen.queryByText(/Wildfire/)).toBeNull();
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
    expect(screen.queryByText(/°/)).toBeNull();
  });

  it('clicking a row opens the first unfinished smoke lane in localize flow', async () => {
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(screen.getByText('CAM_01')).toBeTruthy());
    fireEvent.click(screen.getByText('CAM_01'));
    expect(navigateMock).toHaveBeenCalledWith('/localize/11');
  });

  it('shows an all-caught-up empty state linking to the classify queue', async () => {
    vi.mocked(apiClient.getLocalizationQueue).mockResolvedValue({
      items: [],
      page: 1,
      pages: 0,
      size: 50,
      total: 0,
    });
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Localization queue is clear')).toBeTruthy());
    expect(screen.getByText(/Classifying more alerts is what fills this queue/)).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Start classifying' });
    expect(cta.getAttribute('href')).toBe('/classify');
    // Old copy is gone
    expect(screen.queryByText(/No alerts ready for localization/)).toBeNull();
  });

  it('skipped toggle refetches with skipped=true and renders the unskip action', async () => {
    const skippedItem = {
      ...queueItem,
      skip: {
        skipped_at: '2026-08-05T10:00:00Z',
        skipped_by: 'annotator',
        note: 'cannot box this',
      },
    };
    vi.mocked(apiClient.getLocalizationQueue).mockImplementation(async params =>
      params?.skipped
        ? { items: [skippedItem], page: 1, pages: 1, size: params.size ?? 50, total: 1 }
        : { items: [queueItem], page: 1, pages: 1, size: 50, total: 1 }
    );
    render(<DetectionAnnotatePage />, { wrapper });

    const toggle = await screen.findByRole('button', { name: /Skipped/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(apiClient.getLocalizationQueue).toHaveBeenCalledWith(
        expect.objectContaining({ skipped: true, page: 1 })
      );
    });
    // The refetch remounts the header (loading spinner replaces the page),
    // so re-query the toggle instead of asserting on the stale node.
    await waitFor(() => expect(screen.getByText('cannot box this')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Skipped/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Unskip' }));
    await waitFor(() => {
      expect(apiClient.unskipAlert).toHaveBeenCalledWith('pyronear_french', 170000);
    });
    // Localize · to do on the dashboard is the same skip-excluding queue total
    // the sidebar badge reads, so it has to follow an unskip too.
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map(([arg]) => String(arg?.queryKey?.[0]));
      expect(keys).toContain('pipeline-stats');
    });
  });
});
