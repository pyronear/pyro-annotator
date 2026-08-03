/**
 * Tests for ClassifyAlertPage: the collocated classify screen that renders
 * every object (lane) of one alert and submits them all in a single
 * classifySubmit call.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { AlertDetail, Sequence, SequenceAnnotation, ClassifySubmitRequest } from '@/types/api';

vi.mock('@/services/api', () => ({
  apiClient: {
    getSequence: vi.fn(),
    getAlertDetail: vi.fn(),
    classifySubmit: vi.fn(),
  },
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/components/annotation/FullImageSequence', () => ({
  default: () => <div data-testid="full-image-sequence" />,
}));
vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  default: () => <div data-testid="cropped-image-sequence" />,
}));

// The primary-lane player (SequenceReviewer -> SequencePlayer) fetches
// detections and renders a full playback UI unrelated to this page's own
// logic; swap it for a trivial stand-in that exposes the missed-smoke
// review callback so tests can drive it directly.
vi.mock('@/components/sequence-annotation', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/sequence-annotation')>();
  return {
    ...actual,
    MissedSmokePanel: ({
      onMissedSmokeReviewChange,
    }: {
      onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
    }) => (
      <div>
        <button onClick={() => onMissedSmokeReviewChange('no')}>Mock: No missed smoke</button>
        <button onClick={() => onMissedSmokeReviewChange('yes')}>Mock: Missed smoke</button>
      </div>
    ),
  };
});

import { apiClient } from '@/services/api';
import ClassifyAlertPage from '@/pages/ClassifyAlertPage';

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

function makeAlertDetail(): AlertDetail {
  const laneA = {
    sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
    annotation: makeAnnotation({ id: 201, sequence_id: 101 }),
  };
  const laneB = {
    sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
    annotation: makeAnnotation({
      id: 202,
      sequence_id: 102,
      annotation: {
        sequences_bbox: [
          {
            is_smoke: false,
            false_positive_types: [],
            bboxes: [{ detection_id: 2, xyxyn: [0, 0, 1, 1] }],
          },
        ],
      },
    }),
  };
  const laneC = {
    sequence: makeSequence({ id: 103, alert_api_id: 9003 }),
    annotation: makeAnnotation({
      id: 203,
      sequence_id: 103,
      processing_stage: 'annotated',
      has_smoke: true,
      annotation: {
        sequences_bbox: [
          {
            is_smoke: true,
            smoke_type: 'wildfire',
            false_positive_types: [],
            bboxes: [{ detection_id: 3, xyxyn: [0, 0, 1, 1] }],
          },
        ],
      },
    }),
  };
  return {
    source_api: 'pyronear_french',
    platform_alert_id: 500,
    camera_name: 'CAM-1',
    organisation_name: 'Org',
    recorded_at: '2026-01-01T10:00:00Z',
    lanes: [laneA, laneB, laneC],
  };
}

describe('ClassifyAlertPage', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    vi.mocked(apiClient.getSequence).mockResolvedValue(makeSequence());
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(makeAlertDetail());
    vi.mocked(apiClient.classifySubmit).mockResolvedValue({
      results: [
        {
          annotation_id: 201,
          sequence_id: 101,
          processing_stage: 'seq_annotation_done',
          group_propagation_warning: null,
        },
        {
          annotation_id: 202,
          sequence_id: 102,
          processing_stage: 'annotated',
          group_propagation_warning: null,
        },
      ],
    });
  });

  it('renders one card per lane-track for a 3-lane alert', async () => {
    render(<ClassifyAlertPage />, { wrapper });

    await waitFor(() => expect(screen.getByText('Object 1')).toBeInTheDocument());
    expect(screen.getByText('Object 2')).toBeInTheDocument();
    expect(screen.getByText('Object 3')).toBeInTheDocument();
  });

  it('renders the locked lane card read-only with a stage badge', async () => {
    render(<ClassifyAlertPage />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('object-card-103:0')).toBeInTheDocument());

    const lockedCard = within(screen.getByTestId('object-card-103:0'));
    expect(lockedCard.getByText('Fully annotated')).toBeInTheDocument();
    expect(lockedCard.getByRole('radio', { name: /This is smoke/i })).toBeDisabled();
    // Its existing (already-submitted) classification renders, not blank.
    expect(lockedCard.getByRole('radio', { name: /This is smoke/i })).toBeChecked();
    expect(lockedCard.getAllByText(/Wildfire/).length).toBeGreaterThan(0);

    const editableCard = within(screen.getByTestId('object-card-101:0'));
    expect(editableCard.getByRole('radio', { name: /This is smoke/i })).not.toBeDisabled();
  });

  it('disables submit until every editable card is classified and missed smoke is answered', async () => {
    render(<ClassifyAlertPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('object-card-101:0')).toBeInTheDocument());

    const submitButton = screen.getByRole('button', { name: /Submit alert/i });
    expect(submitButton).toBeDisabled();

    // Classify object 1 as smoke + wildfire
    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: /This is smoke/i }));
    fireEvent.click(cardA.getByRole('radio', { name: /Wildfire/i }));

    expect(submitButton).toBeDisabled();

    // Classify object 2 as false positive + a type
    const cardB = within(screen.getByTestId('object-card-102:0'));
    fireEvent.click(cardB.getByRole('radio', { name: /false positive/i }));
    fireEvent.click(cardB.getByRole('checkbox', { name: /Antenna/i }));

    // Still missing the missed-smoke review
    expect(submitButton).toBeDisabled();

    fireEvent.click(screen.getByText('Mock: No missed smoke'));

    expect(submitButton).not.toBeDisabled();
  });

  it('submits with per-lane stages: FP-only lane annotated, smoke lane seq_annotation_done, primary carries has_missed_smoke', async () => {
    render(<ClassifyAlertPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('object-card-101:0')).toBeInTheDocument());

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: /This is smoke/i }));
    fireEvent.click(cardA.getByRole('radio', { name: /Wildfire/i }));

    const cardB = within(screen.getByTestId('object-card-102:0'));
    fireEvent.click(cardB.getByRole('radio', { name: /false positive/i }));
    fireEvent.click(cardB.getByRole('checkbox', { name: /Antenna/i }));

    fireEvent.click(screen.getByText('Mock: Missed smoke'));

    const submitButton = screen.getByRole('button', { name: /Submit alert/i });
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => expect(apiClient.classifySubmit).toHaveBeenCalledTimes(1));

    const payload = vi.mocked(apiClient.classifySubmit).mock.calls[0][0] as ClassifySubmitRequest;
    expect(payload.items).toHaveLength(2); // locked lane (103) excluded

    const itemA = payload.items.find(i => i.annotation_id === 201)!;
    expect(itemA.processing_stage).toBe('seq_annotation_done');
    expect(itemA.has_missed_smoke).toBe(true);
    expect(itemA.annotation.sequences_bbox[0].is_smoke).toBe(true);
    expect(itemA.annotation.sequences_bbox[0].smoke_type).toBe('wildfire');

    const itemB = payload.items.find(i => i.annotation_id === 202)!;
    expect(itemB.processing_stage).toBe('annotated');
    expect(itemB.has_missed_smoke).toBe(false);
    expect(itemB.annotation.sequences_bbox[0].false_positive_types).toContain('antenna');
  });
});
