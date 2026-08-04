/**
 * Covers the page's auto-advance navigation path: submitting from
 * /classify/:id re-drives this same component in place — no remount — with
 * the destination alert's own sequence, lanes and seeded card state.
 *
 * Unlike ClassifyAlertPage.test.tsx, `useNavigate` is NOT mocked here, so the
 * route param really changes and the destination render is actually
 * exercised. The media players are still stubbed, so this does NOT cover the
 * stale-image-fetch race that motivated it — that lives in
 * tests/components/annotation/FullImageSequence.frameSwitch.test.tsx.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { AlertDetail, Sequence, SequenceAnnotation } from '@/types/api';

vi.mock('@/services/api', () => ({
  apiClient: {
    getSequence: vi.fn(),
    getAlertDetail: vi.fn(),
    classifySubmit: vi.fn(),
    getSequenceDetections: vi.fn(),
    updateSequenceAnnotation: vi.fn(),
    getClassifyQueue: vi.fn(),
  },
}));

vi.mock('@/components/annotation/FullImageSequence', () => ({
  default: ({ bboxes, sequenceId }: { bboxes?: unknown[]; sequenceId?: number }) => (
    <div
      data-testid="full-image-sequence"
      data-bbox-count={bboxes?.length ?? 0}
      data-sequence-id={sequenceId}
    />
  ),
}));
vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  default: () => <div data-testid="cropped-image-sequence" />,
}));
vi.mock('@/components/sequence/SequenceReviewer', () => ({
  default: () => <div data-testid="sequence-reviewer" />,
}));

import { apiClient } from '@/services/api';
import ClassifyAlertPage from '@/pages/ClassifyAlertPage';

function makeSequence(overrides: Partial<Sequence> = {}): Sequence {
  return {
    id: 101,
    source_api: 'pyronear_french',
    alert_api_id: 9001,
    created_at: '2026-01-01T09:00:00Z',
    recorded_at: '2026-01-01T10:00:00Z',
    last_seen_at: '2026-01-01T10:05:00Z',
    camera_name: 'CAM-1',
    camera_id: 1,
    lat: 45,
    lon: 5,
    azimuth: 90,
    is_wildfire_alertapi: null,
    organisation_name: 'Org',
    organisation_id: 1,
    platform_alert_id: 500,
    sequence_group_id: null,
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<SequenceAnnotation> = {}): SequenceAnnotation {
  return {
    id: 201,
    sequence_id: 101,
    has_smoke: false,
    has_false_positives: false,
    false_positive_types: '[]',
    smoke_types: [],
    has_missed_smoke: false,
    is_unsure: false,
    annotation: {
      sequences_bbox: [
        {
          is_smoke: false,
          false_positive_types: [],
          bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
        },
      ],
    },
    processing_stage: 'ready_to_annotate',
    created_at: '2026-01-01T09:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

/** Single-lane alert, so the entry sequence is the only object. */
function makeAlertDetail(sequenceId: number, platformAlertId: number): AlertDetail {
  return {
    source_api: 'pyronear_french',
    platform_alert_id: platformAlertId,
    camera_name: `CAM-${platformAlertId}`,
    organisation_name: 'Org',
    recorded_at: '2026-01-01T10:00:00Z',
    lanes: [
      {
        sequence: makeSequence({ id: sequenceId, platform_alert_id: platformAlertId }),
        annotation: makeAnnotation({
          id: sequenceId + 100,
          sequence_id: sequenceId,
          annotation: {
            sequences_bbox: [
              {
                is_smoke: false,
                false_positive_types: [],
                bboxes: [{ detection_id: sequenceId, xyxyn: [0, 0, 1, 1] }],
              },
            ],
          },
        }),
      },
    ],
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/classify/101']}>
        <Routes>
          <Route path="/classify/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ClassifyAlertPage auto-advance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();

    vi.mocked(apiClient.getSequence).mockImplementation(async (id: number) =>
      id === 101
        ? makeSequence({ id: 101, platform_alert_id: 500 })
        : makeSequence({ id: 301, platform_alert_id: 700 })
    );
    vi.mocked(apiClient.getAlertDetail).mockImplementation(
      async (_source: string, platformAlertId: number) =>
        platformAlertId === 500 ? makeAlertDetail(101, 500) : makeAlertDetail(301, 700)
    );
    vi.mocked(apiClient.getSequenceDetections).mockResolvedValue([]);
    vi.mocked(apiClient.getClassifyQueue).mockResolvedValue({
      items: [
        {
          source_api: 'pyronear_french',
          platform_alert_id: 700,
          camera_name: 'CAM-700',
          organisation_name: 'Org',
          azimuth: null,
          recorded_at: '2026-01-01T11:00:00Z',
          is_wildfire_alertapi: null,
          primary_sequence_id: 301,
          total_objects: 1,
          classified_objects: 0,
        },
      ],
      page: 1,
      pages: 1,
      size: 2,
      total: 1,
    });
    vi.mocked(apiClient.classifySubmit).mockResolvedValue({
      results: [
        {
          annotation_id: 201,
          sequence_id: 101,
          processing_stage: 'seq_annotation_done',
          group_propagation_warning: null,
        },
      ],
    });
  });

  it('renders the destination alert’s objects after auto-advancing', async () => {
    render(<ClassifyAlertPage />, { wrapper });

    // Entry alert settled: its object is active and seeded.
    await waitFor(() => {
      expect(screen.getByTestId('full-image-sequence').getAttribute('data-bbox-count')).not.toBe(
        '0'
      );
    });

    // Classify the only object, answer missed smoke, submit.
    fireEvent.click(screen.getByTestId('object-card-101:0'));
    const card = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(card.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(card.getByRole('radio', { name: 'Wildfire' }));
    fireEvent.click(
      within(screen.getByTestId('missed-smoke-row')).getByRole('radio', { name: 'No' })
    );

    await waitFor(() => {
      expect((screen.getByTestId('rail-submit') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('rail-submit'));
    await waitFor(() => expect(apiClient.classifySubmit).toHaveBeenCalledTimes(1));

    // Auto-advance fires 1s after a successful submit.
    await waitFor(
      () => {
        expect(screen.getByTestId('object-card-301:0')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    // The destination alert's object must be active with its own seeded data —
    // not a skeleton, and not the previous alert's sequence.
    await waitFor(() => {
      expect(screen.queryByTestId('media-panel-skeleton')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('full-image-sequence').getAttribute('data-sequence-id')).toBe('301');
    expect(screen.getByTestId('full-image-sequence').getAttribute('data-bbox-count')).not.toBe('0');
  }, 15000);
});
